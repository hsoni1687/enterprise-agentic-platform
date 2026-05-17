package store

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/agent-platform/go-shared/pkg/models"
)

var ErrNotFound = errors.New("agent not found")

// AgentRecord wraps AgentManifest with lifecycle fields not yet on the shared model.
type AgentRecord struct {
	models.AgentManifest
	Status    models.ResourceStatus `json:"status"`
	CreatedAt time.Time             `json:"created_at"`
}

type ListFilter struct {
	TenantID string
	Status   string
	Tier     string // optional: "lite" | "workflow" | "deep"
}

type Store interface {
	Create(ctx context.Context, rec *AgentRecord) error
	GetByID(ctx context.Context, id, tenantID string) (*AgentRecord, error)
	List(ctx context.Context, f ListFilter) ([]*AgentRecord, error)
	Update(ctx context.Context, rec *AgentRecord) error
	Transition(ctx context.Context, id, tenantID string, target models.ResourceStatus, actor string) error
}

var validTransitions = map[models.ResourceStatus][]models.ResourceStatus{
	models.StatusDraft:    {models.StatusStaged},
	models.StatusStaged:   {models.StatusActive, models.StatusDraft},
	models.StatusActive:   {models.StatusPaused, models.StatusArchived},
	models.StatusPaused:   {models.StatusActive, models.StatusArchived},
	models.StatusArchived: {},
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
	records map[string]*AgentRecord
}

func NewInMemoryStore() *InMemoryStore {
	return &InMemoryStore{records: make(map[string]*AgentRecord)}
}

func (s *InMemoryStore) Create(_ context.Context, rec *AgentRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := *rec
	s.records[rec.ID] = &cp
	return nil
}

func (s *InMemoryStore) GetByID(_ context.Context, id, tenantID string) (*AgentRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rec, ok := s.records[id]
	if !ok || rec.TenantID != tenantID {
		return nil, ErrNotFound
	}
	cp := *rec
	return &cp, nil
}

func (s *InMemoryStore) List(_ context.Context, f ListFilter) ([]*AgentRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []*AgentRecord
	for _, rec := range s.records {
		if rec.TenantID != f.TenantID {
			continue
		}
		if f.Status != "" && string(rec.Status) != f.Status {
			continue
		}
		cp := *rec
		out = append(out, &cp)
	}
	return out, nil
}

func (s *InMemoryStore) Update(_ context.Context, rec *AgentRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, ok := s.records[rec.ID]
	if !ok || existing.TenantID != rec.TenantID {
		return ErrNotFound
	}
	cp := *rec
	s.records[rec.ID] = &cp
	return nil
}

func (s *InMemoryStore) Transition(_ context.Context, id, tenantID string, target models.ResourceStatus, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.records[id]
	if !ok || rec.TenantID != tenantID {
		return ErrNotFound
	}
	if err := validateTransition(rec.Status, target); err != nil {
		return err
	}
	rec.Status = target
	return nil
}
