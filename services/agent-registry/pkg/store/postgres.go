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
	// Apply tier defaults for any fields not explicitly set
	applyTierDefaults(rec)

	skills, _ := json.Marshal(rec.Skills)
	tools, _ := json.Marshal(rec.Tools)
	mcpServers, _ := json.Marshal(rec.MCPServers)
	execConfig, _ := json.Marshal(rec.ExecutionConfig)
	tags, _ := json.Marshal(rec.Tags)
	guardrailIDs, _ := json.Marshal(rec.GuardrailIDs)
	hookIDs, _ := json.Marshal(rec.HookIDs)
	kgIDs, _ := json.Marshal(rec.KnowledgeGraphIDs)

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO agents
			(id, tenant_id, name, version, description, system_prompt,
			 skills, tools, mcp_servers, model,
			 max_iterations, memory_budget_mb, status, created_at,
			 tier, autonomy_level, execution_config,
			 tags, template_id, guardrail_ids, hook_ids, knowledge_graph_ids)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
		rec.ID, rec.TenantID, rec.Name, rec.Version, rec.Description, rec.SystemPrompt,
		skills, tools, mcpServers, rec.Model,
		rec.MaxIterations, rec.MemoryBudgetMB, string(rec.Status), rec.CreatedAt,
		string(rec.Tier), string(rec.AutonomyLevel), execConfig,
		tags, nullableString(rec.TemplateID), guardrailIDs, hookIDs, kgIDs,
	)
	return err
}

func (s *PostgresStore) GetByID(ctx context.Context, id, tenantID string) (*AgentRecord, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, tenant_id, name, version, description, system_prompt,
		       skills, tools, mcp_servers, model,
		       max_iterations, memory_budget_mb, status, created_at,
		       tier, autonomy_level, execution_config,
		       tags, template_id, guardrail_ids, hook_ids, knowledge_graph_ids
		FROM agents
		WHERE id = $1 AND tenant_id = $2`, id, tenantID)
	return scanAgent(row)
}

func (s *PostgresStore) List(ctx context.Context, f ListFilter) ([]*AgentRecord, error) {
	q := `SELECT id, tenant_id, name, version, description, system_prompt,
		         skills, tools, mcp_servers, model,
		         max_iterations, memory_budget_mb, status, created_at,
		         tier, autonomy_level, execution_config,
		         tags, template_id, guardrail_ids, hook_ids, knowledge_graph_ids
		  FROM agents WHERE tenant_id = $1`
	args := []any{f.TenantID}
	if f.Status != "" {
		q += " AND status = $2"
		args = append(args, f.Status)
	}
	if f.Tier != "" {
		placeholder := fmt.Sprintf(" AND tier = $%d", len(args)+1)
		q += placeholder
		args = append(args, f.Tier)
	}
	q += " ORDER BY created_at DESC"

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
	applyTierDefaults(rec)

	skills, _ := json.Marshal(rec.Skills)
	tools, _ := json.Marshal(rec.Tools)
	mcpServers, _ := json.Marshal(rec.MCPServers)
	execConfig, _ := json.Marshal(rec.ExecutionConfig)
	tags, _ := json.Marshal(rec.Tags)
	guardrailIDs, _ := json.Marshal(rec.GuardrailIDs)
	hookIDs, _ := json.Marshal(rec.HookIDs)
	kgIDs, _ := json.Marshal(rec.KnowledgeGraphIDs)

	res, err := s.db.ExecContext(ctx, `
		UPDATE agents
		SET name=$1, version=$2, description=$3, system_prompt=$4,
		    skills=$5, tools=$6, mcp_servers=$7, model=$8,
		    max_iterations=$9, memory_budget_mb=$10, status=$11,
		    tier=$12, autonomy_level=$13, execution_config=$14,
		    tags=$15, template_id=$16, guardrail_ids=$17, hook_ids=$18,
		    knowledge_graph_ids=$19
		WHERE id=$20 AND tenant_id=$21`,
		rec.Name, rec.Version, rec.Description, rec.SystemPrompt,
		skills, tools, mcpServers, rec.Model,
		rec.MaxIterations, rec.MemoryBudgetMB, string(rec.Status),
		string(rec.Tier), string(rec.AutonomyLevel), execConfig,
		tags, nullableString(rec.TemplateID), guardrailIDs, hookIDs, kgIDs,
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

// applyTierDefaults fills in Tier-derived defaults if not already set by the caller.
func applyTierDefaults(rec *AgentRecord) {
	if rec.Tier == "" {
		rec.Tier = models.AgentTierDeep
	}
	if rec.AutonomyLevel == "" {
		rec.AutonomyLevel = models.TierAutonomy(rec.Tier)
	}
	cfg := rec.ExecutionConfig
	if cfg.MaxDurationSeconds == 0 && cfg.MaxTokens == 0 {
		rec.ExecutionConfig = models.TierDefaults(rec.Tier)
	}
	if rec.MaxIterations == 0 {
		switch rec.Tier {
		case models.AgentTierLite:
			rec.MaxIterations = 1
		case models.AgentTierWorkflow:
			rec.MaxIterations = 20
		default:
			rec.MaxIterations = 100
		}
	}
}

type scanner interface {
	Scan(dest ...any) error
}

func scanAgent(s scanner) (*AgentRecord, error) {
	var rec AgentRecord
	var (
		skills, tools, mcpServers []byte
		execConfig, tags          []byte
		guardrailIDs, hookIDs     []byte
		kgIDs                     []byte
		tier, autonomyLevel       string
		templateID                sql.NullString
		description               sql.NullString
	)

	err := s.Scan(
		&rec.ID, &rec.TenantID, &rec.Name, &rec.Version, &description, &rec.SystemPrompt,
		&skills, &tools, &mcpServers, &rec.Model,
		&rec.MaxIterations, &rec.MemoryBudgetMB, &rec.Status, &rec.CreatedAt,
		&tier, &autonomyLevel, &execConfig,
		&tags, &templateID, &guardrailIDs, &hookIDs, &kgIDs,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	rec.Tier = models.AgentTier(tier)
	rec.AutonomyLevel = models.AutonomyLevel(autonomyLevel)
	if description.Valid {
		rec.Description = description.String
	}
	if templateID.Valid {
		rec.TemplateID = templateID.String
	}

	json.Unmarshal(skills, &rec.Skills)
	json.Unmarshal(tools, &rec.Tools)
	json.Unmarshal(mcpServers, &rec.MCPServers)
	json.Unmarshal(execConfig, &rec.ExecutionConfig)
	json.Unmarshal(tags, &rec.Tags)
	json.Unmarshal(guardrailIDs, &rec.GuardrailIDs)
	json.Unmarshal(hookIDs, &rec.HookIDs)
	json.Unmarshal(kgIDs, &rec.KnowledgeGraphIDs)

	return &rec, nil
}

func nullableString(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}
