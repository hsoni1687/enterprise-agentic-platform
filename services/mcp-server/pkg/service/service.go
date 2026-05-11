package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// Service handles MCP server operations
type Service struct {
	db                 *sql.DB
	skillCatalogURL    string
	skillDispatcherURL string
	kgServiceURL       string
}

// NewService creates a new MCP server service
func NewService(db *sql.DB, skillCatalogURL, skillDispatcherURL string) *Service {
	kgServiceURL := os.Getenv("KG_SERVICE_URL")
	if kgServiceURL == "" {
		kgServiceURL = "http://localhost:8093"
	}
	return &Service{
		db:                 db,
		skillCatalogURL:    skillCatalogURL,
		skillDispatcherURL: skillDispatcherURL,
		kgServiceURL:       kgServiceURL,
	}
}

// SkillRef represents a skill from the catalog
type SkillRef struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"inputSchema"`
}

// MCPToolDefinition represents a tool in MCP format
type MCPToolDefinition struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"inputSchema"`
}

// getTokenTenant retrieves the tenant_id associated with a token hash
func (s *Service) getTokenTenant(ctx context.Context, tokenHash string) (string, error) {
	var tenantID string
	err := s.db.QueryRowContext(ctx,
		`SELECT tenant_id FROM mcp_tokens WHERE token_hash = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
		tokenHash).Scan(&tenantID)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("token not found or expired")
	}
	if err != nil {
		return "", err
	}
	return tenantID, nil
}

// hashToken returns SHA-256 hash of a token
func hashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

// extractToken extracts the bearer token from Authorization header
func extractToken(authHeader string) (string, error) {
	if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
		return "", fmt.Errorf("invalid authorization header")
	}
	return authHeader[7:], nil
}

// getSkills fetches skills from the skill-catalog for a tenant
func (s *Service) getSkills(ctx context.Context, tenantID string) ([]SkillRef, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", s.skillCatalogURL+"/api/v1/skills?tenant_id="+tenantID, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Tenant-ID", tenantID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("skill catalog returned %d", resp.StatusCode)
	}

	var result struct {
		Skills []SkillRef `json:"skills"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return result.Skills, nil
}

// invokeSkill invokes a skill via the skill-dispatcher
func (s *Service) invokeSkill(ctx context.Context, tenantID string, skillName string, args map[string]interface{}) (string, error) {
	body, err := json.Marshal(map[string]interface{}{
		"skill_name": skillName,
		"args":       args,
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", s.skillDispatcherURL+"/api/v1/skills/"+skillName+"/invoke", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-ID", tenantID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("skill dispatcher returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Result string `json:"result"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", err
	}

	return result.Result, nil
}

// getKGTools returns built-in KG tools
func (s *Service) getKGTools() []MCPToolDefinition {
	return []MCPToolDefinition{
		{
			Name:        "kg_search_entities",
			Description: "Search for entities (nodes) in a knowledge graph by type or label",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"graph_id": map[string]interface{}{
						"type":        "string",
						"description": "The ID of the knowledge graph to search",
					},
					"node_type": map[string]interface{}{
						"type":        "string",
						"description": "Filter nodes by type (e.g., Service, Database, Team)",
					},
					"label": map[string]interface{}{
						"type":        "string",
						"description": "Optional: search nodes by label (partial match)",
					},
					"limit": map[string]interface{}{
						"type":        "integer",
						"description": "Maximum number of results (default: 100)",
					},
				},
				"required": []string{"graph_id", "node_type"},
			},
		},
		{
			Name:        "kg_get_relationships",
			Description: "Get all relationships (edges) connected to a specific node in a knowledge graph",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"graph_id": map[string]interface{}{
						"type":        "string",
						"description": "The ID of the knowledge graph",
					},
					"node_id": map[string]interface{}{
						"type":        "string",
						"description": "The ID of the node to get relationships for",
					},
					"max_depth": map[string]interface{}{
						"type":        "integer",
						"description": "Maximum depth to traverse (default: 1)",
					},
				},
				"required": []string{"graph_id", "node_id"},
			},
		},
	}
}

// invokeKGTool invokes a knowledge graph tool
func (s *Service) invokeKGTool(ctx context.Context, tenantID string, toolName string, args map[string]interface{}) (string, error) {
	graphID, ok := args["graph_id"].(string)
	if !ok {
		return "", fmt.Errorf("missing graph_id argument")
	}

	switch toolName {
	case "kg_search_entities":
		return s.invokeKGSearch(ctx, tenantID, graphID, args)
	case "kg_get_relationships":
		return s.invokeKGRelationships(ctx, tenantID, graphID, args)
	default:
		return "", fmt.Errorf("unknown KG tool: %s", toolName)
	}
}

// invokeKGSearch searches for nodes in a knowledge graph
func (s *Service) invokeKGSearch(ctx context.Context, tenantID string, graphID string, args map[string]interface{}) (string, error) {
	nodeType, ok := args["node_type"].(string)
	if !ok {
		return "", fmt.Errorf("missing node_type argument")
	}

	limit := 100
	if l, ok := args["limit"].(float64); ok {
		limit = int(l)
	}

	url := fmt.Sprintf("%s/search/nodes?graph_id=%s&node_type=%s&limit=%d",
		s.kgServiceURL, graphID, nodeType, limit)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("X-Tenant-ID", tenantID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("KG service returned %d: %s", resp.StatusCode, string(body))
	}

	return string(body), nil
}

// invokeKGRelationships gets relationships around a node
func (s *Service) invokeKGRelationships(ctx context.Context, tenantID string, graphID string, args map[string]interface{}) (string, error) {
	nodeID, ok := args["node_id"].(string)
	if !ok {
		return "", fmt.Errorf("missing node_id argument")
	}

	maxDepth := 1
	if d, ok := args["max_depth"].(float64); ok {
		maxDepth = int(d)
	}

	body, err := json.Marshal(map[string]interface{}{
		"graph_id":     graphID,
		"start_node_id": nodeID,
		"max_depth":    maxDepth,
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", s.kgServiceURL+"/query", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-ID", tenantID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("KG service returned %d: %s", resp.StatusCode, string(respBody))
	}

	return string(respBody), nil
}

// HandleMCP handles JSON-RPC 2.0 MCP requests
func (s *Service) HandleMCP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		http.Error(w, "Missing authorization header", http.StatusUnauthorized)
		return
	}

	token, err := extractToken(authHeader)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	tokenHash := hashToken(token)
	tenantID, err := s.getTokenTenant(r.Context(), tokenHash)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	var req struct {
		JSONRPC string                 `json:"jsonrpc"`
		Method  string                 `json:"method"`
		Params  map[string]interface{} `json:"params"`
		ID      int                    `json:"id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	switch req.Method {
	case "initialize":
		s.handleInitialize(w, req.ID)
	case "tools/list":
		s.handleListTools(w, r.Context(), tenantID, req.ID)
	case "tools/call":
		s.handleCallTool(w, r.Context(), tenantID, req.Params, req.ID)
	default:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"jsonrpc": "2.0",
			"error": map[string]interface{}{
				"code":    -32601,
				"message": "Method not found",
			},
			"id": req.ID,
		})
	}
}

// handleInitialize responds to initialize request
func (s *Service) handleInitialize(w http.ResponseWriter, id int) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"jsonrpc": "2.0",
		"result": map[string]interface{}{
			"serverInfo": map[string]string{
				"name":    "a1-agent-engine",
				"version": "1.0.0",
			},
			"capabilities": map[string]interface{}{
				"tools": map[string]interface{}{},
			},
		},
		"id": id,
	})
}

// handleListTools lists available skills as MCP tools plus built-in KG tools
func (s *Service) handleListTools(w http.ResponseWriter, ctx context.Context, tenantID string, id int) {
	skills, err := s.getSkills(ctx, tenantID)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"jsonrpc": "2.0",
			"error": map[string]interface{}{
				"code":    -32603,
				"message": fmt.Sprintf("Internal error: %v", err),
			},
			"id": id,
		})
		return
	}

	// Combine skill tools and KG tools
	kgTools := s.getKGTools()
	tools := make([]MCPToolDefinition, len(skills)+len(kgTools))

	for i, skill := range skills {
		tools[i] = MCPToolDefinition{
			Name:        skill.Name,
			Description: skill.Description,
			InputSchema: skill.InputSchema,
		}
	}

	for i, kgTool := range kgTools {
		tools[len(skills)+i] = kgTool
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"jsonrpc": "2.0",
		"result": map[string]interface{}{
			"tools": tools,
		},
		"id": id,
	})
}

// handleCallTool invokes a skill or KG tool
func (s *Service) handleCallTool(w http.ResponseWriter, ctx context.Context, tenantID string, params map[string]interface{}, id int) {
	name, ok := params["name"].(string)
	if !ok {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"jsonrpc": "2.0",
			"error": map[string]interface{}{
				"code":    -32602,
				"message": "Invalid params: missing 'name'",
			},
			"id": id,
		})
		return
	}

	args, ok := params["arguments"].(map[string]interface{})
	if !ok {
		args = make(map[string]interface{})
	}

	var result string
	var err error

	// Check if it's a KG tool
	if name == "kg_search_entities" || name == "kg_get_relationships" {
		result, err = s.invokeKGTool(ctx, tenantID, name, args)
	} else {
		// Otherwise, invoke as a skill
		result, err = s.invokeSkill(ctx, tenantID, name, args)
	}

	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"jsonrpc": "2.0",
			"error": map[string]interface{}{
				"code":    -32603,
				"message": fmt.Sprintf("Tool invocation failed: %v", err),
			},
			"id": id,
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"jsonrpc": "2.0",
		"result": map[string]interface{}{
			"content": []map[string]interface{}{
				{
					"type": "text",
					"text": result,
				},
			},
		},
		"id": id,
	})
}

// HandleSSE handles Server-Sent Events stream (MCP spec requirement)
func (s *Service) HandleSSE(w http.ResponseWriter, r *http.Request) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		http.Error(w, "Missing authorization header", http.StatusUnauthorized)
		return
	}

	token, err := extractToken(authHeader)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	tokenHash := hashToken(token)
	_, err = s.getTokenTenant(r.Context(), tokenHash)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

// HandleHealth returns health status
func (s *Service) HandleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
