package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/a1-agent-engine/mcp-registry/pkg/mcpclient"
)

// Service handles MCP registry operations
type Service struct {
	db *sql.DB
}

// NewService creates a new registry service
func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

// MCPServer represents a registered MCP server
type MCPServer struct {
	ID        string    `json:"id"`
	TenantID  string    `json:"tenant_id"`
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	Enabled   bool      `json:"enabled"`
	Scope     string    `json:"scope"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Tool represents a cached MCP tool
type Tool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"inputSchema"`
	ServerName  string                 `json:"server_name"`
}

// RegisterServer registers a new MCP server for a tenant
func (s *Service) RegisterServer(ctx context.Context, tenantID string, name string, url string) (*MCPServer, error) {
	id := uuid.New().String()
	now := time.Now()

	_, err := s.db.ExecContext(ctx,
		`INSERT INTO mcp_servers (id, tenant_id, name, url, enabled, scope, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		id, tenantID, name, url, true, "tenant", now, now)

	if err != nil {
		return nil, fmt.Errorf("failed to register MCP server: %w", err)
	}

	return &MCPServer{
		ID:        id,
		TenantID:  tenantID,
		Name:      name,
		URL:       url,
		Enabled:   true,
		Scope:     "tenant",
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}

// RegisterGlobalServer registers a global MCP server accessible to all tenants
func (s *Service) RegisterGlobalServer(ctx context.Context, name string, url string) (*MCPServer, error) {
	id := uuid.New().String()
	now := time.Now()

	_, err := s.db.ExecContext(ctx,
		`INSERT INTO mcp_servers (id, tenant_id, name, url, enabled, scope, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		id, "platform-system", name, url, true, "global", now, now)

	if err != nil {
		return nil, fmt.Errorf("failed to register global MCP server: %w", err)
	}

	return &MCPServer{
		ID:        id,
		TenantID:  "platform-system",
		Name:      name,
		URL:       url,
		Enabled:   true,
		Scope:     "global",
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}

// ListServers returns all MCP servers for a tenant (both tenant-specific and global)
func (s *Service) ListServers(ctx context.Context, tenantID string) ([]MCPServer, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, tenant_id, name, url, enabled, scope, created_at, updated_at
		 FROM mcp_servers WHERE (tenant_id = $1 OR scope = 'global') AND enabled = true
		 ORDER BY created_at DESC`,
		tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var servers []MCPServer
	for rows.Next() {
		var srv MCPServer
		if err := rows.Scan(&srv.ID, &srv.TenantID, &srv.Name, &srv.URL, &srv.Enabled, &srv.Scope, &srv.CreatedAt, &srv.UpdatedAt); err != nil {
			return nil, err
		}
		servers = append(servers, srv)
	}

	return servers, rows.Err()
}

// ListGlobalServers returns all global MCP servers
func (s *Service) ListGlobalServers(ctx context.Context) ([]MCPServer, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, tenant_id, name, url, enabled, scope, created_at, updated_at
		 FROM mcp_servers WHERE scope = 'global' AND enabled = true
		 ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var servers []MCPServer
	for rows.Next() {
		var srv MCPServer
		if err := rows.Scan(&srv.ID, &srv.TenantID, &srv.Name, &srv.URL, &srv.Enabled, &srv.Scope, &srv.CreatedAt, &srv.UpdatedAt); err != nil {
			return nil, err
		}
		servers = append(servers, srv)
	}

	return servers, rows.Err()
}

// DeleteServer removes a tenant-scoped MCP server
func (s *Service) DeleteServer(ctx context.Context, serverID string) error {
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM mcp_servers WHERE id = $1 AND scope = 'tenant'`,
		serverID)
	return err
}

// DeleteGlobalServer removes a global MCP server (admin only)
func (s *Service) DeleteGlobalServer(ctx context.Context, serverID string) error {
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM mcp_servers WHERE id = $1 AND scope = 'global'`,
		serverID)
	return err
}

// DiscoverTools queries an MCP server for available tools and caches them
func (s *Service) DiscoverTools(ctx context.Context, serverID string) ([]Tool, error) {
	// Get server details
	var url, tenantID, name string
	err := s.db.QueryRowContext(ctx,
		`SELECT url, tenant_id, name FROM mcp_servers WHERE id = $1`,
		serverID).Scan(&url, &tenantID, &name)
	if err != nil {
		return nil, fmt.Errorf("MCP server not found: %w", err)
	}

	// Create MCP client and list tools
	client := mcpclient.NewClient(url)
	if err := client.Initialize(ctx); err != nil {
		return nil, fmt.Errorf("failed to initialize MCP client: %w", err)
	}

	mcpTools, err := client.ListTools(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list tools: %w", err)
	}

	// Cache tools and convert to Tool format
	var tools []Tool
	for _, mcpTool := range mcpTools {
		toolID := uuid.New().String()
		schema, _ := json.Marshal(mcpTool.InputSchema)

		_, err := s.db.ExecContext(ctx,
			`INSERT INTO mcp_tool_cache (id, mcp_server_id, tenant_id, tool_name, description, input_schema, cached_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 ON CONFLICT (mcp_server_id, tool_name) DO UPDATE SET
			 input_schema = EXCLUDED.input_schema,
			 cached_at = EXCLUDED.cached_at`,
			toolID, serverID, tenantID, mcpTool.Name, mcpTool.Description, string(schema), time.Now())

		if err != nil {
			return nil, fmt.Errorf("failed to cache tool: %w", err)
		}

		tools = append(tools, Tool{
			Name:        mcpTool.Name,
			Description: mcpTool.Description,
			InputSchema: mcpTool.InputSchema,
			ServerName:  name,
		})
	}

	return tools, nil
}

// InvokeTool calls a tool on the MCP server
func (s *Service) InvokeTool(ctx context.Context, serverID string, toolName string, args map[string]interface{}) (string, error) {
	// Get server URL
	var url string
	err := s.db.QueryRowContext(ctx,
		`SELECT url FROM mcp_servers WHERE id = $1`,
		serverID).Scan(&url)
	if err != nil {
		return "", fmt.Errorf("MCP server not found: %w", err)
	}

	client := mcpclient.NewClient(url)
	result, err := client.CallTool(ctx, toolName, args)
	if err != nil {
		return "", fmt.Errorf("failed to invoke tool: %w", err)
	}

	return result, nil
}

// HTTP Handlers

// HandleHealth returns health status
func (s *Service) HandleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// HandleRegisterServer registers a new MCP server
func (s *Service) HandleRegisterServer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "Missing X-Tenant-ID header", http.StatusBadRequest)
		return
	}

	var req struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	server, err := s.RegisterServer(r.Context(), tenantID, req.Name, req.URL)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(server)
}

// HandleListServers lists MCP servers for a tenant
func (s *Service) HandleListServers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "Missing X-Tenant-ID header", http.StatusBadRequest)
		return
	}

	servers, err := s.ListServers(r.Context(), tenantID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"servers": servers,
		"count":   len(servers),
	})
}

// HandleDeleteServer deletes an MCP server
func (s *Service) HandleDeleteServer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	serverID := r.PathValue("id")
	if serverID == "" {
		http.Error(w, "Missing server ID", http.StatusBadRequest)
		return
	}

	if err := s.DeleteServer(r.Context(), serverID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

// HandleDiscoverTools discovers tools from an MCP server
func (s *Service) HandleDiscoverTools(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	serverID := r.PathValue("id")
	if serverID == "" {
		http.Error(w, "Missing server ID", http.StatusBadRequest)
		return
	}

	tools, err := s.DiscoverTools(r.Context(), serverID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tools": tools,
		"count": len(tools),
	})
}

// HandleInvokeTool invokes a tool on an MCP server
func (s *Service) HandleInvokeTool(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	serverID := r.PathValue("id")
	if serverID == "" {
		http.Error(w, "Missing server ID", http.StatusBadRequest)
		return
	}

	var req struct {
		ToolName string                 `json:"tool_name"`
		Args     map[string]interface{} `json:"args"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	result, err := s.InvokeTool(r.Context(), serverID, req.ToolName, req.Args)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"result": result,
	})
}
