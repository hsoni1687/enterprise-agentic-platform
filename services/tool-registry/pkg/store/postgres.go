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
// security on tools/lifecycle_events is enforced for this tenant.
func (s *PostgresStore) withTenant(ctx context.Context, tenantID string, fn func(tx *sql.Tx) error) error {
	return shareddb.WithTenant(ctx, s.db, tenantID, fn)
}

func (s *PostgresStore) Create(ctx context.Context, t *models.ToolSpec) error {
	scope := t.Scope
	if scope == "" {
		scope = "tenant"
	}
	return s.withTenant(ctx, t.TenantID, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO tools
				(id, tenant_id, name, version, description, auth_level, sandbox_required,
				 input_schema, output_schema, status, registered_by, created_at, scope)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
			t.ID, t.TenantID, t.Name, t.Version, t.Description, string(t.AuthLevel),
			t.SandboxRequired, nullJSON(t.InputSchema), nullJSON(t.OutputSchema),
			string(t.Status), t.RegisteredBy, t.CreatedAt, scope,
		)
		return err
	})
}

func (s *PostgresStore) GetByID(ctx context.Context, id, tenantID string) (*models.ToolSpec, error) {
	var t *models.ToolSpec
	err := s.withTenant(ctx, tenantID, func(tx *sql.Tx) error {
		row := tx.QueryRowContext(ctx, `
			SELECT id, tenant_id, name, version, description, auth_level, sandbox_required,
			       input_schema, output_schema, status, registered_by, created_at, scope
			FROM tools
			WHERE id = $1 AND (tenant_id = $2 OR scope = 'system')`, id, tenantID)
		var e error
		t, e = scanTool(row)
		return e
	})
	if err != nil {
		return nil, err
	}
	return t, nil
}

func (s *PostgresStore) List(ctx context.Context, f ListFilter) ([]*models.ToolSpec, error) {
	var q string
	args := []any{f.TenantID}
	if f.IncludeSystem {
		q = `SELECT id, tenant_id, name, version, description, auth_level, sandbox_required,
		            input_schema, output_schema, status, registered_by, created_at, scope
		     FROM tools WHERE tenant_id = $1 OR scope = 'system'`
	} else {
		q = `SELECT id, tenant_id, name, version, description, auth_level, sandbox_required,
		            input_schema, output_schema, status, registered_by, created_at, scope
		     FROM tools WHERE tenant_id = $1`
	}
	if f.Status != "" {
		q += " AND status = $2"
		args = append(args, f.Status)
	}

	var out []*models.ToolSpec
	err := s.withTenant(ctx, f.TenantID, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, q, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			t, err := scanTool(rows)
			if err != nil {
				return err
			}
			out = append(out, t)
		}
		return rows.Err()
	})
	return out, err
}

func (s *PostgresStore) Update(ctx context.Context, t *models.ToolSpec) error {
	existing, err := s.GetByID(ctx, t.ID, t.TenantID)
	if err != nil {
		return err
	}
	if existing.Scope == "system" {
		return ErrForbidden
	}
	return s.withTenant(ctx, t.TenantID, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `
			UPDATE tools
			SET name=$1, version=$2, description=$3, auth_level=$4, sandbox_required=$5,
			    input_schema=$6, output_schema=$7, status=$8, registered_by=$9
			WHERE id=$10 AND tenant_id=$11`,
			t.Name, t.Version, t.Description, string(t.AuthLevel), t.SandboxRequired,
			nullJSON(t.InputSchema), nullJSON(t.OutputSchema), string(t.Status), t.RegisteredBy,
			t.ID, t.TenantID,
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

func (s *PostgresStore) Transition(ctx context.Context, id, tenantID string, target models.ResourceStatus, actor string) error {
	t, err := s.GetByID(ctx, id, tenantID)
	if err != nil {
		return err
	}
	if t.Scope == "system" {
		return ErrForbidden
	}
	if err := validateTransition(t.Status, target); err != nil {
		return err
	}
	return s.withTenant(ctx, tenantID, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx,
			`UPDATE tools SET status=$1 WHERE id=$2 AND tenant_id=$3`,
			string(target), id, tenantID,
		)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO lifecycle_events (resource_type, resource_id, tenant_id, from_state, to_state, actor)
			VALUES ('tool', $1, $2, $3, $4, $5)`,
			id, tenantID, string(t.Status), string(target), actor,
		)
		return err
	})
}

type scanner interface {
	Scan(dest ...any) error
}

func scanTool(s scanner) (*models.ToolSpec, error) {
	var t models.ToolSpec
	var inputSchema, outputSchema sql.NullString
	err := s.Scan(
		&t.ID, &t.TenantID, &t.Name, &t.Version, &t.Description, &t.AuthLevel,
		&t.SandboxRequired, &inputSchema, &outputSchema, &t.Status, &t.RegisteredBy, &t.CreatedAt, &t.Scope,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if inputSchema.Valid {
		t.InputSchema = json.RawMessage(inputSchema.String)
	}
	if outputSchema.Valid {
		t.OutputSchema = json.RawMessage(outputSchema.String)
	}
	return &t, nil
}

func nullJSON(b json.RawMessage) sql.NullString {
	if len(b) == 0 {
		return sql.NullString{}
	}
	return sql.NullString{String: string(b), Valid: true}
}
