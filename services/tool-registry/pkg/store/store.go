package store

import (
	"context"
	"errors"
	"sync"

	"github.com/agent-platform/go-shared/pkg/models"
)

var ErrNotFound = errors.New("tool not found")
var ErrForbidden = errors.New("forbidden: system resource is immutable")

type ListFilter struct {
	TenantID      string
	Status        string
	IncludeSystem bool
}

type Store interface {
	Create(ctx context.Context, tool *models.ToolSpec) error
	GetByID(ctx context.Context, id, tenantID string) (*models.ToolSpec, error)
	List(ctx context.Context, f ListFilter) ([]*models.ToolSpec, error)
	Update(ctx context.Context, tool *models.ToolSpec) error
	Transition(ctx context.Context, id, tenantID string, target models.ResourceStatus, actor string) error
}

var validTransitions = map[models.ResourceStatus][]models.ResourceStatus{
	models.StatusPendingReview: {models.StatusApproved},
	models.StatusApproved:      {models.StatusDeprecated},
	models.StatusDeprecated:    {},
}

func validateTransition(from, to models.ResourceStatus) error {
	allowed, ok := validTransitions[from]
	if !ok {
		return errors.New("unknown source state: " + string(from))
	}
	for _, a := range allowed {
		if a == to {
			return nil
		}
	}
	return errors.New("invalid transition: " + string(from) + " → " + string(to))
}

type InMemoryStore struct {
	mu      sync.RWMutex
	records map[string]*models.ToolSpec
}

func NewInMemoryStore() *InMemoryStore {
	return &InMemoryStore{records: make(map[string]*models.ToolSpec)}
}

func (s *InMemoryStore) Create(_ context.Context, t *models.ToolSpec) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := *t
	s.records[t.ID] = &cp
	return nil
}

func (s *InMemoryStore) GetByID(_ context.Context, id, tenantID string) (*models.ToolSpec, error) {
	s.mu.RLock()
	defer s.mu.Unlock()
	t, ok := s.records[id]
	if !ok {
		return nil, ErrNotFound
	}
	if t.Scope == "system" || t.TenantID == tenantID {
		cp := *t
		return &cp, nil
	}
	return nil, ErrNotFound
}

func (s *InMemoryStore) List(_ context.Context, f ListFilter) ([]*models.ToolSpec, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []*models.ToolSpec
	for _, t := range s.records {
		if f.IncludeSystem {
			if t.TenantID != f.TenantID && t.Scope != "system" {
				continue
			}
		} else {
			if t.TenantID != f.TenantID {
				continue
			}
		}
		if f.Status != "" && string(t.Status) != f.Status {
			continue
		}
		cp := *t
		out = append(out, &cp)
	}
	return out, nil
}

func (s *InMemoryStore) Update(_ context.Context, t *models.ToolSpec) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, ok := s.records[t.ID]
	if !ok || existing.TenantID != t.TenantID {
		return ErrNotFound
	}
	if existing.Scope == "system" {
		return ErrForbidden
	}
	cp := *t
	s.records[t.ID] = &cp
	return nil
}

func (s *InMemoryStore) Transition(_ context.Context, id, tenantID string, target models.ResourceStatus, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.records[id]
	if !ok || t.TenantID != tenantID {
		return ErrNotFound
	}
	if t.Scope == "system" {
		return ErrForbidden
	}
	if err := validateTransition(t.Status, target); err != nil {
		return err
	}
	t.Status = target
	return nil
}
