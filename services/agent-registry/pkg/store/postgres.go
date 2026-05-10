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

func (s *PostgresStore) Create(ctx context.Context, rec *AgentRecord) error {
	skills, _ := json.Marshal(rec.Skills)
	tools, _ := json.Marshal(rec.Tools)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO agents
			(id, tenant_id, name, version, system_prompt, skills, tools, model,
			 max_iterations, memory_budget_mb, status, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		rec.ID, rec.TenantID, rec.Name, rec.Version, rec.SystemPrompt, skills, tools,
		rec.Model, rec.MaxIterations, rec.MemoryBudgetMB,
		string(rec.Status), rec.CreatedAt,
	)
	return err
}

func (s *PostgresStore) GetByID(ctx context.Context, id, tenantID string) (*AgentRecord, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, tenant_id, name, version, system_prompt, skills, tools, model,
		       max_iterations, memory_budget_mb, status, created_at
		FROM agents
		WHERE id = $1 AND tenant_id = $2`, id, tenantID)
	return scanAgent(row)
}

func (s *PostgresStore) List(ctx context.Context, f ListFilter) ([]*AgentRecord, error) {
	q := `SELECT id, tenant_id, name, version, system_prompt, skills, tools, model,
		         max_iterations, memory_budget_mb, status, created_at
		  FROM agents WHERE tenant_id = $1`
	args := []any{f.TenantID}
	if f.Status != "" {
		q += " AND status = $2"
		args = append(args, f.Status)
	}
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*AgentRecord
	for rows.Next() {
		rec, err := scanAgent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (s *PostgresStore) Update(ctx context.Context, rec *AgentRecord) error {
	skills, _ := json.Marshal(rec.Skills)
	tools, _ := json.Marshal(rec.Tools)
	res, err := s.db.ExecContext(ctx, `
		UPDATE agents
		SET name=$1, version=$2, system_prompt=$3, skills=$4, tools=$5, model=$6,
		    max_iterations=$7, memory_budget_mb=$8, status=$9
		WHERE id=$10 AND tenant_id=$11`,
		rec.Name, rec.Version, rec.SystemPrompt, skills, tools, rec.Model,
		rec.MaxIterations, rec.MemoryBudgetMB, string(rec.Status),
		rec.ID, rec.TenantID,
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

func (s *PostgresStore) Transition(ctx context.Context, id, tenantID string, target models.ResourceStatus, actor string) error {
	rec, err := s.GetByID(ctx, id, tenantID)
	if err != nil {
		return err
	}
	if err := validateTransition(rec.Status, target); err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE agents SET status=$1 WHERE id=$2 AND tenant_id=$3`,
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
		INSERT INTO lifecycle_events (resource_type, resource_id, tenant_id, from_state, to_state, actor)
		VALUES ('agent', $1, $2, $3, $4, $5)`,
		id, tenantID, string(rec.Status), string(target), actor,
	)
	return nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanAgent(s scanner) (*AgentRecord, error) {
	var rec AgentRecord
	var skills, tools []byte
	err := s.Scan(
		&rec.ID, &rec.TenantID, &rec.Name, &rec.Version, &rec.SystemPrompt, &skills, &tools,
		&rec.Model, &rec.MaxIterations, &rec.MemoryBudgetMB, &rec.Status, &rec.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	json.Unmarshal(skills, &rec.Skills)
	json.Unmarshal(tools, &rec.Tools)
	return &rec, nil
}
