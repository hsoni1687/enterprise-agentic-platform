package store

// Callers must register a postgres driver before using NewPostgresStore.
// In main.go: import _ "github.com/lib/pq" or _ "github.com/jackc/pgx/v5/stdlib".

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	shareddb "github.com/agent-platform/go-shared/pkg/db"
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

// withTenant runs fn inside a transaction with app.tenant_id set, so row-level
// security on skills/lifecycle_events is enforced for this tenant.
func (s *PostgresStore) withTenant(ctx context.Context, tenantID string, fn func(tx *sql.Tx) error) error {
	return shareddb.WithTenant(ctx, s.db, tenantID, fn)
}

func (s *PostgresStore) Create(ctx context.Context, sk *models.SkillManifest) error {
	tools, _ := json.Marshal(sk.Tools)
	hooks, _ := json.Marshal(sk.Hooks)
	scope := sk.Scope
	if scope == "" {
		scope = "tenant"
	}
	visibility := sk.Visibility
	if visibility == "" {
		visibility = "private"
	}
	return s.withTenant(ctx, sk.TenantID, func(tx *sql.Tx) error {
		if exists, err := nameVersionExistsTx(ctx, tx, sk.Name, sk.Version, ""); err != nil {
			return err
		} else if exists {
			return ErrConflict
		}
		_, err := tx.ExecContext(ctx, `
			INSERT INTO skills
				(id, tenant_id, name, version, description, tools, sop, mutating,
				 approval_required, hooks, status, published_by, created_at, scope, visibility, team_id)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
			sk.ID, sk.TenantID, sk.Name, sk.Version, sk.Description, tools,
			sk.SOP, sk.Mutating, sk.ApprovalRequired, hooks,
			string(sk.Status), sk.PublishedBy, sk.CreatedAt, scope, visibility, sk.TeamID,
		)
		return err
	})
}

func (s *PostgresStore) GetByID(ctx context.Context, id, tenantID string) (*models.SkillManifest, error) {
	var sk *models.SkillManifest
	err := s.withTenant(ctx, tenantID, func(tx *sql.Tx) error {
		row := tx.QueryRowContext(ctx, `
			SELECT id, tenant_id, name, version, description, tools, sop, mutating,
			       approval_required, hooks, status, published_by, created_at, scope, visibility, team_id
			FROM skills
			WHERE id = $1
			  AND (tenant_id = $2 OR scope = 'system' OR visibility = 'public')`, id, tenantID)
		var e error
		sk, e = scanSkill(row)
		return e
	})
	if err != nil {
		return nil, err
	}
	return sk, nil
}

func (s *PostgresStore) GetByName(ctx context.Context, name, version, tenantID string) (*models.SkillManifest, error) {
	var sk *models.SkillManifest
	err := s.withTenant(ctx, tenantID, func(tx *sql.Tx) error {
		row := tx.QueryRowContext(ctx, `
			SELECT id, tenant_id, name, version, description, tools, sop, mutating,
			       approval_required, hooks, status, published_by, created_at, scope, visibility, team_id
			FROM skills
			WHERE name = $1 AND version = $2
			  AND (tenant_id = $3 OR scope = 'system' OR visibility = 'public')
			ORDER BY
			  CASE WHEN tenant_id = $3 THEN 0 WHEN scope = 'system' THEN 1 ELSE 2 END,
			  created_at DESC
			LIMIT 1`, name, version, tenantID)
		var e error
		sk, e = scanSkill(row)
		return e
	})
	if err != nil {
		return nil, err
	}
	return sk, nil
}

func (s *PostgresStore) List(ctx context.Context, f ListFilter) ([]*models.SkillManifest, error) {
	q := `SELECT id, tenant_id, name, version, description, tools, sop, mutating,
		            approval_required, hooks, status, published_by, created_at, scope, visibility, team_id
		     FROM skills WHERE (tenant_id = $1`
	args := []any{f.TenantID}
	if f.IncludeSystem {
		q += ` OR scope = 'system'`
	}
	if f.IncludePublic {
		q += ` OR (scope = 'tenant' AND visibility = 'public')`
	}
	q += `)`
	if f.Available && f.TeamID != "" {
		q += ` AND (visibility <> 'private' OR team_id IS NULL OR team_id = '' OR team_id = $2 OR tenant_id <> $1)`
		args = append(args, f.TeamID)
	}
	if f.Status != "" {
		q += fmt.Sprintf(" AND status = $%d", len(args)+1)
		args = append(args, f.Status)
	}
	q += ` ORDER BY scope DESC, visibility DESC, created_at DESC`

	var out []*models.SkillManifest
	err := s.withTenant(ctx, f.TenantID, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, q, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			sk, err := scanSkill(rows)
			if err != nil {
				return err
			}
			out = append(out, sk)
		}
		return rows.Err()
	})
	return out, err
}

func (s *PostgresStore) Update(ctx context.Context, sk *models.SkillManifest) error {
	existing, err := s.GetByID(ctx, sk.ID, sk.TenantID)
	if err != nil {
		return err
	}
	if existing.Scope == "system" {
		return ErrForbidden
	}
	if sk.Visibility == "" {
		sk.Visibility = "private"
	}
	tools, _ := json.Marshal(sk.Tools)
	hooks, _ := json.Marshal(sk.Hooks)
	return s.withTenant(ctx, sk.TenantID, func(tx *sql.Tx) error {
		if exists, err := nameVersionExistsTx(ctx, tx, sk.Name, sk.Version, sk.ID); err != nil {
			return err
		} else if exists {
			return ErrConflict
		}
		res, err := tx.ExecContext(ctx, `
			UPDATE skills
			SET name=$1, version=$2, description=$3, tools=$4, sop=$5, mutating=$6,
			    approval_required=$7, hooks=$8, status=$9, published_by=$10, visibility=$11, team_id=$12
			WHERE id=$13 AND tenant_id=$14`,
			sk.Name, sk.Version, sk.Description, tools, sk.SOP, sk.Mutating,
			sk.ApprovalRequired, hooks, string(sk.Status), sk.PublishedBy,
			sk.Visibility, sk.TeamID, sk.ID, sk.TenantID,
		)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// nameVersionExistsTx checks name/version uniqueness within the current tenant
// transaction. Under RLS this is scoped to rows the tenant can see (its own plus
// system/public), which is the correct tenant-scoped uniqueness semantics.
func nameVersionExistsTx(ctx context.Context, tx *sql.Tx, name, version, exceptID string) (bool, error) {
	var exists bool
	err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM skills
			WHERE lower(name) = lower($1)
			  AND version = $2
			  AND ($3 = '' OR id <> $3)
		)`, name, version, exceptID).Scan(&exists)
	return exists, err
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
	return s.withTenant(ctx, tenantID, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx,
			`UPDATE skills SET status=$1 WHERE id=$2 AND tenant_id=$3`,
			string(target), id, tenantID,
		)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO lifecycle_events (resource_type, resource_id, tenant_id, from_state, to_state, actor, reason)
			VALUES ('skill', $1, $2, $3, $4, $5, $6)`,
			id, tenantID, string(sk.Status), string(target), actor, reason,
		)
		return err
	})
}

type scanner interface {
	Scan(dest ...any) error
}

func scanSkill(s scanner) (*models.SkillManifest, error) {
	var sk models.SkillManifest
	var tools, hooks []byte
	var teamID sql.NullString
	err := s.Scan(
		&sk.ID, &sk.TenantID, &sk.Name, &sk.Version, &sk.Description, &tools,
		&sk.SOP, &sk.Mutating, &sk.ApprovalRequired, &hooks,
		&sk.Status, &sk.PublishedBy, &sk.CreatedAt, &sk.Scope, &sk.Visibility, &teamID,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	json.Unmarshal(tools, &sk.Tools)
	json.Unmarshal(hooks, &sk.Hooks)
	if sk.Visibility == "" {
		sk.Visibility = "private"
	}
	if teamID.Valid {
		sk.TeamID = teamID.String
	}
	return &sk, nil
}
