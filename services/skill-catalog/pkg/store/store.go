package store

import (
	"context"
	"errors"
	"sync"

	"github.com/agent-platform/go-shared/pkg/models"
)

var ErrNotFound = errors.New("skill not found")
var ErrForbidden = errors.New("forbidden: system resource is immutable")

type ListFilter struct {
	TenantID      string
	Status        string
	IncludeSystem bool
}

type Store interface {
	Create(ctx context.Context, skill *models.SkillManifest) error
	GetByID(ctx context.Context, id, tenantID string) (*models.SkillManifest, error)
	GetByName(ctx context.Context, name, version, tenantID string) (*models.SkillManifest, error)
	List(ctx context.Context, f ListFilter) ([]*models.SkillManifest, error)
	Update(ctx context.Context, skill *models.SkillManifest) error
	Transition(ctx context.Context, id, tenantID string, target models.ResourceStatus, actor, reason string) error
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
	records map[string]*models.SkillManifest
}

func NewInMemoryStore() *InMemoryStore {
	return &InMemoryStore{records: make(map[string]*models.SkillManifest)}
}

func (s *InMemoryStore) Create(_ context.Context, sk *models.SkillManifest) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := *sk
	s.records[sk.ID] = &cp
	return nil
}

func (s *InMemoryStore) GetByID(_ context.Context, id, tenantID string) (*models.SkillManifest, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sk, ok := s.records[id]
	if !ok {
		return nil, ErrNotFound
	}
	if sk.Scope == "system" || sk.TenantID == tenantID {
		cp := *sk
		return &cp, nil
	}
	return nil, ErrNotFound
}

func (s *InMemoryStore) GetByName(_ context.Context, name, version, tenantID string) (*models.SkillManifest, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, sk := range s.records {
		if sk.TenantID == tenantID && sk.Name == name && sk.Version == version {
			cp := *sk
			return &cp, nil
		}
	}
	return nil, ErrNotFound
}

func (s *InMemoryStore) List(_ context.Context, f ListFilter) ([]*models.SkillManifest, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []*models.SkillManifest
	for _, sk := range s.records {
		if f.IncludeSystem {
			if sk.TenantID != f.TenantID && sk.Scope != "system" {
				continue
			}
		} else {
			if sk.TenantID != f.TenantID {
				continue
			}
		}
		if f.Status != "" && string(sk.Status) != f.Status {
			continue
		}
		cp := *sk
		out = append(out, &cp)
	}
	return out, nil
}

func (s *InMemoryStore) Update(_ context.Context, sk *models.SkillManifest) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, ok := s.records[sk.ID]
	if !ok || existing.TenantID != sk.TenantID {
		return ErrNotFound
	}
	if existing.Scope == "system" {
		return ErrForbidden
	}
	cp := *sk
	s.records[sk.ID] = &cp
	return nil
}

func (s *InMemoryStore) Transition(_ context.Context, id, tenantID string, target models.ResourceStatus, _, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sk, ok := s.records[id]
	if !ok || sk.TenantID != tenantID {
		return ErrNotFound
	}
	if sk.Scope == "system" {
		return ErrForbidden
	}
	if err := validateTransition(sk.Status, target); err != nil {
		return err
	}
	sk.Status = target
	return nil
}
