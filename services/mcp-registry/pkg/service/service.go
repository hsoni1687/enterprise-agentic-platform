package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/a1-agent-engine/go-shared"
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

// encryptAuthConfig encrypts sensitive fields in auth config
func encryptAuthConfig(auth *AuthConfig) (*AuthConfig, error) {
	if auth == nil {
		return nil, nil
	}

	encrypted := *auth

	// Encrypt sensitive fields based on auth type
	switch auth.Type {
	case "bearer_token":
		if auth.Token != "" {
			token, err := shared.EncryptString(auth.Token)
			if err != nil {
				return nil, fmt.Errorf("failed to encrypt token: %w", err)
			}
			encrypted.Token = token
		}
	case "api_key":
		if auth.Key != "" {
			key, err := shared.EncryptString(auth.Key)
			if err != nil {
				return nil, fmt.Errorf("failed to encrypt key: %w", err)
			}
			encrypted.Key = key
		}
	case "oauth2":
		if auth.ClientSecret != "" {
			secret, err := shared.EncryptString(auth.ClientSecret)
			if err != nil {
				return nil, fmt.Errorf("failed to encrypt client_secret: %w", err)
			}
			encrypted.ClientSecret = secret
		}
	}

	return &encrypted, nil
}

// decryptAuthConfig decrypts sensitive fields in auth config
func decryptAuthConfig(auth *AuthConfig) (*AuthConfig, error) {
	if auth == nil {
		return nil, nil
	}

	decrypted := *auth

	// Decrypt sensitive fields based on auth type
	switch auth.Type {
	case "bearer_token":
		if auth.Token != "" {
			token, err := shared.DecryptString(auth.Token)
			if err != nil {
				return nil, fmt.Errorf("failed to decrypt token: %w", err)
			}
			decrypted.Token = token
		}
	case "api_key":
		if auth.Key != "" {
			key, err := shared.DecryptString(auth.Key)
			if err != nil {
				return nil, fmt.Errorf("failed to decrypt key: %w", err)
			}
			decrypted.Key = key
		}
	case "oauth2":
		if auth.ClientSecret != "" {
			secret, err := shared.DecryptString(auth.ClientSecret)
			if err != nil {
				return nil, fmt.Errorf("failed to decrypt client_secret: %w", err)
			}
			decrypted.ClientSecret = secret
		}
	}

	return &decrypted, nil
}

// maskAuthConfig masks sensitive fields for API responses
func maskAuthConfig(auth *AuthConfig) *AuthConfig {
	if auth == nil {
		return nil
	}

	masked := *auth

	// Mask sensitive fields
	switch auth.Type {
	case "bearer_token":
		if masked.Token != "" {
			masked.Token = "***"
		}
	case "api_key":
		if masked.Key != "" {
			masked.Key = "***"
		}
	case "oauth2":
		if masked.ClientSecret != "" {
			masked.ClientSecret = "***"
		}
	}

	return &masked
}

// AuthConfig stores authentication configuration for MCP servers
type AuthConfig struct {
	Type string `json:"type"` // bearer_token, api_key, oauth2

	// Bearer Token auth
	Token      string `json:"token,omitempty"`      // Encrypted bearer token
	HeaderName string `json:"header_name,omitempty"` // Defaults to "Authorization"

	// API Key auth
	Key        string `json:"key,omitempty"`         // Encrypted API key
	KeyName    string `json:"key_name,omitempty"`    // Header or query param name
	KeyIn      string `json:"key_in,omitempty"`      // "header" or "query"

	// OAuth 2.0 auth
	ClientID     string `json:"client_id,omitempty"`      // OAuth client ID
	ClientSecret string `json:"client_secret,omitempty"`  // Encrypted OAuth client secret
	TokenURL     string `json:"token_url,omitempty"`      // OAuth token endpoint
	Scope        string `json:"scope,omitempty"`          // OAuth scope
}

// MCPServer represents a registered MCP server
type MCPServer struct {
	ID         string     `json:"id"`
	TenantID   string     `json:"tenant_id"`
	Name       string     `json:"name"`
	URL        string     `json:"url"`
	Enabled    bool       `json:"enabled"`
	Scope      string     `json:"scope"`
	AuthConfig *AuthConfig `json:"auth_config,omitempty"` // Decrypted auth config (sensitive fields masked in API)
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

// Tool represents a cached MCP tool
type Tool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"inputSchema"`
	ServerName  string                 `json:"server_name"`
}

// RegisterServer registers a new MCP server for a tenant
func (s *Service) RegisterServer(ctx context.Context, tenantID string, name string, url string, authConfig *AuthConfig) (*MCPServer, error) {
	id := uuid.New().String()
	now := time.Now()

	// Encrypt auth config before storing
	var encryptedAuth *AuthConfig
	var err error
	if authConfig != nil {
		encryptedAuth, err = encryptAuthConfig(authConfig)
		if err != nil {
			return nil, fmt.Errorf("failed to process auth config: %w", err)
		}
	}

	authJSON, _ := json.Marshal(encryptedAuth)

	_, err = s.db.ExecContext(ctx,
		`INSERT INTO mcp_servers (id, tenant_id, name, url, enabled, scope, auth_config, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		id, tenantID, name, url, true, "tenant", authJSON, now, now)

	if err != nil {
		return nil, fmt.Errorf("failed to register MCP server: %w", err)
	}

	return &MCPServer{
		ID:         id,
		TenantID:   tenantID,
		Name:       name,
		URL:        url,
		Enabled:    true,
		Scope:      "tenant",
		AuthConfig: maskAuthConfig(authConfig),
		CreatedAt:  now,
		UpdatedAt:  now,
	}, nil
}

// RegisterGlobalServer registers a global MCP server accessible to all tenants
func (s *Service) RegisterGlobalServer(ctx context.Context, name string, url string, authConfig *AuthConfig) (*MCPServer, error) {
	id := uuid.New().String()
	now := time.Now()

	// Encrypt auth config before storing
	var encryptedAuth *AuthConfig
	var err error
	if authConfig != nil {
		encryptedAuth, err = encryptAuthConfig(authConfig)
		if err != nil {
			return nil, fmt.Errorf("failed to process auth config: %w", err)
		}
	}

	authJSON, _ := json.Marshal(encryptedAuth)

	_, err = s.db.ExecContext(ctx,
		`INSERT INTO mcp_servers (id, tenant_id, name, url, enabled, scope, auth_config, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		id, "platform-system", name, url, true, "global", authJSON, now, now)

	if err != nil {
		return nil, fmt.Errorf("failed to register global MCP server: %w", err)
	}

	return &MCPServer{
		ID:         id,
		TenantID:   "platform-system",
		Name:       name,
		URL:        url,
		Enabled:    true,
		Scope:      "global",
		AuthConfig: maskAuthConfig(authConfig),
		CreatedAt:  now,
		UpdatedAt:  now,
	}, nil
}

// ListServers returns all MCP servers for a tenant (both tenant-specific and global)
func (s *Service) ListServers(ctx context.Context, tenantID string) ([]MCPServer, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, tenant_id, name, url, enabled, scope, auth_config, created_at, updated_at
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
		var authJSON sql.NullString
		if err := rows.Scan(&srv.ID, &srv.TenantID, &srv.Name, &srv.URL, &srv.Enabled, &srv.Scope, &authJSON, &srv.CreatedAt, &srv.UpdatedAt); err != nil {
			return nil, err
		}

		// Decrypt auth config if present
		if authJSON.Valid && authJSON.String != "" {
			var encryptedAuth AuthConfig
			if err := json.Unmarshal([]byte(authJSON.String), &encryptedAuth); err == nil {
				decrypted, err := decryptAuthConfig(&encryptedAuth)
				if err == nil {
					srv.AuthConfig = maskAuthConfig(decrypted)
				}
			}
		}

		servers = append(servers, srv)
	}

	return servers, rows.Err()
}

// ListGlobalServers returns all global MCP servers
func (s *Service) ListGlobalServers(ctx context.Context) ([]MCPServer, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, tenant_id, name, url, enabled, scope, auth_config, created_at, updated_at
		 FROM mcp_servers WHERE scope = 'global' AND enabled = true
		 ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var servers []MCPServer
	for rows.Next() {
		var srv MCPServer
		var authJSON sql.NullString
		if err := rows.Scan(&srv.ID, &srv.TenantID, &srv.Name, &srv.URL, &srv.Enabled, &srv.Scope, &authJSON, &srv.CreatedAt, &srv.UpdatedAt); err != nil {
			return nil, err
		}

		// Decrypt auth config if present
		if authJSON.Valid && authJSON.String != "" {
			var encryptedAuth AuthConfig
			if err := json.Unmarshal([]byte(authJSON.String), &encryptedAuth); err == nil {
				decrypted, err := decryptAuthConfig(&encryptedAuth)
				if err == nil {
					srv.AuthConfig = maskAuthConfig(decrypted)
				}
			}
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
	var authJSON sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT url, tenant_id, name, auth_config FROM mcp_servers WHERE id = $1`,
		serverID).Scan(&url, &tenantID, &name, &authJSON)
	if err != nil {
		return nil, fmt.Errorf("MCP server not found: %w", err)
	}

	// Decrypt auth config if present
	var mcpAuthConfig *mcpclient.AuthConfig
	if authJSON.Valid && authJSON.String != "" {
		var encryptedAuth AuthConfig
		if err := json.Unmarshal([]byte(authJSON.String), &encryptedAuth); err == nil {
			if decrypted, err := decryptAuthConfig(&encryptedAuth); err == nil {
				// Convert service.AuthConfig to mcpclient.AuthConfig
				mcpAuthConfig = &mcpclient.AuthConfig{
					Type:       decrypted.Type,
					Token:      decrypted.Token,
					HeaderName: decrypted.HeaderName,
					Key:        decrypted.Key,
					KeyName:    decrypted.KeyName,
					KeyIn:      decrypted.KeyIn,
					ClientID:   decrypted.ClientID,
					TokenURL:   decrypted.TokenURL,
				}
			}
		}
	}

	// Create MCP client and list tools
	client := mcpclient.NewClient(url)
	if mcpAuthConfig != nil {
		client.SetAuth(mcpAuthConfig)
	}
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
	// Get server URL and auth config
	var url string
	var authJSON sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT url, auth_config FROM mcp_servers WHERE id = $1`,
		serverID).Scan(&url, &authJSON)
	if err != nil {
		return "", fmt.Errorf("MCP server not found: %w", err)
	}

	// Decrypt auth config if present
	var authConfig *mcpclient.AuthConfig
	if authJSON.Valid && authJSON.String != "" {
		var encryptedAuth AuthConfig
		if err := json.Unmarshal([]byte(authJSON.String), &encryptedAuth); err == nil {
			if decrypted, err := decryptAuthConfig(&encryptedAuth); err == nil {
				// Convert service.AuthConfig to mcpclient.AuthConfig
				authConfig = &mcpclient.AuthConfig{
					Type:       decrypted.Type,
					Token:      decrypted.Token,
					HeaderName: decrypted.HeaderName,
					Key:        decrypted.Key,
					KeyName:    decrypted.KeyName,
					KeyIn:      decrypted.KeyIn,
					ClientID:   decrypted.ClientID,
					TokenURL:   decrypted.TokenURL,
				}
			}
		}
	}

	client := mcpclient.NewClient(url)
	if authConfig != nil {
		client.SetAuth(authConfig)
	}
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
		Name       string      `json:"name"`
		URL        string      `json:"url"`
		AuthConfig *AuthConfig `json:"auth_config,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	server, err := s.RegisterServer(r.Context(), tenantID, req.Name, req.URL, req.AuthConfig)
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
