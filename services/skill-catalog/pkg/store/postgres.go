package store

// Callers must register a postgres driver before using NewPostgresStore.
// In main.go: import _ "github.com/lib/pq" or _ "github.com/jackc/pgx/v5/stdlib".

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/agent-platform/go-shared/pkg/models"
)

type PostgresStore struct {
	db *sql.DB
}

func NewPostgresStore(db *sql.DB) (*PostgresStore, error) {
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return &PostgresStore{db: db}, nil
}

func (s *PostgresStore) Create(ctx context.Context, sk *models.SkillManifest) error {
	tools, _ := json.Marshal(sk.Tools)
	hooks, _ := json.Marshal(sk.Hooks)
	scope := sk.Scope
	if scope == "" {
		scope = "tenant"
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO skills
			(id, tenant_id, name, version, description, tools, sop, mutating,
			 approval_required, hooks, status, published_by, created_at, scope)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
		sk.ID, sk.TenantID, sk.Name, sk.Version, sk.Description, tools,
		sk.SOP, sk.Mutating, sk.ApprovalRequired, hooks,
		string(sk.Status), sk.PublishedBy, sk.CreatedAt, scope,
	)
	return err
}

func (s *PostgresStore) GetByID(ctx context.Context, id, tenantID string) (*models.SkillManifest, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, tenant_id, name, version, description, tools, sop, mutating,
		       approval_required, hooks, status, published_by, created_at, scope
		FROM skills
		WHERE id = $1 AND (tenant_id = $2 OR scope = 'system')`, id, tenantID)
	return scanSkill(row)
}

func (s *PostgresStore) GetByName(ctx context.Context, name, version, tenantID string) (*models.SkillManifest, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, tenant_id, name, version, description, tools, sop, mutating,
		       approval_required, hooks, status, published_by, created_at, scope
		FROM skills
		WHERE name = $1 AND version = $2 AND (tenant_id = $3 OR scope = 'system')`, name, version, tenantID)
	return scanSkill(row)
}

func (s *PostgresStore) List(ctx context.Context, f ListFilter) ([]*models.SkillManifest, error) {
	var q string
	args := []any{f.TenantID}
	if f.IncludeSystem {
		q = `SELECT id, tenant_id, name, version, description, tools, sop, mutating,
		            approval_required, hooks, status, published_by, created_at, scope
		     FROM skills WHERE tenant_id = $1 OR scope = 'system'`
	} else {
		q = `SELECT id, tenant_id, name, version, description, tools, sop, mutating,
		            approval_required, hooks, status, published_by, created_at, scope
		     FROM skills WHERE tenant_id = $1`
	}
	if f.Status != "" {
		q += " AND status = $2"
		args = append(args, f.Status)
	}
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.SkillManifest
	for rows.Next() {
		sk, err := scanSkill(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sk)
	}
	return out, rows.Err()
}

func (s *PostgresStore) Update(ctx context.Context, sk *models.SkillManifest) error {
	existing, err := s.GetByID(ctx, sk.ID, sk.TenantID)
	if err != nil {
		return err
	}
	if existing.Scope == "system" {
		return ErrForbidden
	}
	tools, _ := json.Marshal(sk.Tools)
	hooks, _ := json.Marshal(sk.Hooks)
	res, err := s.db.ExecContext(ctx, `
		UPDATE skills
		SET name=$1, version=$2, description=$3, tools=$4, sop=$5, mutating=$6,
		    approval_required=$7, hooks=$8, status=$9, published_by=$10
		WHERE id=$11 AND tenant_id=$12`,
		sk.Name, sk.Version, sk.Description, tools, sk.SOP, sk.Mutating,
		sk.ApprovalRequired, hooks, string(sk.Status), sk.PublishedBy,
		sk.ID, sk.TenantID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) Transition(ctx context.Context, id, tenantID string, target models.ResourceStatus, actor, reason string) error {
	sk, err := s.GetByID(ctx, id, tenantID)
	if err != nil {
		return err
	}
	if sk.Scope == "system" {
		return ErrForbidden
	}
	if err := validateTransition(sk.Status, target); err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE skills SET status=$1 WHERE id=$2 AND tenant_id=$3`,
		string(target), id, tenantID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	s.db.ExecContext(ctx, `
		INSERT INTO lifecycle_events (resource_type, resource_id, tenant_id, from_state, to_state, actor, reason)
		VALUES ('skill', $1, $2, $3, $4, $5, $6)`,
		id, tenantID, string(sk.Status), string(target), actor, reason,
	)
	return nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanSkill(s scanner) (*models.SkillManifest, error) {
	var sk models.SkillManifest
	var tools, hooks []byte
	err := s.Scan(
		&sk.ID, &sk.TenantID, &sk.Name, &sk.Version, &sk.Description, &tools,
		&sk.SOP, &sk.Mutating, &sk.ApprovalRequired, &hooks,
		&sk.Status, &sk.PublishedBy, &sk.CreatedAt, &sk.Scope,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	json.Unmarshal(tools, &sk.Tools)
	json.Unmarshal(hooks, &sk.Hooks)
	return &sk, nil
}
