package mcpclient

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// AuthConfig represents authentication configuration
type AuthConfig struct {
	Type string `json:"type"` // bearer_token, api_key, oauth2

	// Bearer Token auth
	Token      string `json:"token,omitempty"`
	HeaderName string `json:"header_name,omitempty"`

	// API Key auth
	Key     string `json:"key,omitempty"`
	KeyName string `json:"key_name,omitempty"`
	KeyIn   string `json:"key_in,omitempty"`

	// OAuth 2.0 auth (tokens would be obtained separately)
	ClientID string `json:"client_id,omitempty"`
	TokenURL string `json:"token_url,omitempty"`
}

// Client implements JSON-RPC 2.0 HTTP client for MCP servers
type Client struct {
	URL        string
	HTTPClient *http.Client
	AuthConfig *AuthConfig
	sessionID  string // Mcp-Session-Id returned by initialize (Streamable HTTP)
}

// MCPTool represents a tool definition from an MCP server
type MCPTool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"inputSchema"`
}

// jsonRPCRequest is a JSON-RPC 2.0 request
type jsonRPCRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params,omitempty"`
	ID      int         `json:"id"`
}

// jsonRPCResponse is a JSON-RPC 2.0 response.
// ID is json.RawMessage because servers may send it as an int OR a string
// (e.g. "server-error") depending on the error path.
type jsonRPCResponse struct {
	JSONRPC string                 `json:"jsonrpc"`
	Result  map[string]interface{} `json:"result"`
	Error   *jsonRPCError          `json:"error"`
	ID      json.RawMessage        `json:"id"`
}

// jsonRPCError is a JSON-RPC 2.0 error object
type jsonRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// NewClient creates a new MCP client
func NewClient(url string) *Client {
	return &Client{
		URL:        url,
		HTTPClient: &http.Client{},
	}
}

// mcpEndpoint normalises the registered URL so the /mcp/ path is never doubled.
// Registered URLs may be:
//   - bare:            http://host:port           → http://host:port/mcp/
//   - with path:       http://host:port/mcp       → http://host:port/mcp/
//   - already correct: http://host:port/mcp/      → http://host:port/mcp/
func (c *Client) mcpEndpoint() string {
	u := strings.TrimRight(c.URL, "/")
	if !strings.HasSuffix(u, "/mcp") {
		u = u + "/mcp"
	}
	return u + "/"
}

// SetAuth sets authentication configuration for the client
func (c *Client) SetAuth(auth *AuthConfig) {
	c.AuthConfig = auth
}

// Initialize sends the initialize request to the MCP server.
// For servers using the Streamable HTTP transport the response includes an
// Mcp-Session-Id header; subsequent requests must echo it back.
func (c *Client) Initialize(ctx context.Context) error {
	req := jsonRPCRequest{
		JSONRPC: "2.0",
		Method:  "initialize",
		Params: map[string]interface{}{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]interface{}{},
			"clientInfo": map[string]string{
				"name":    "a1-agent-engine",
				"version": "1.0.0",
			},
		},
		ID: 1,
	}

	_, sessionID, err := c.sendWithHeaders(ctx, req)
	if err != nil {
		return err
	}
	if sessionID != "" {
		c.sessionID = sessionID
	}
	return nil
}

// ListTools returns the list of available tools from the MCP server
func (c *Client) ListTools(ctx context.Context) ([]MCPTool, error) {
	req := jsonRPCRequest{
		JSONRPC: "2.0",
		Method:  "tools/list",
		ID:      2,
	}

	resp, err := c.send(ctx, req)
	if err != nil {
		return nil, err
	}

	tools := []MCPTool{}
	if toolsData, ok := resp["tools"]; ok {
		if toolsSlice, ok := toolsData.([]interface{}); ok {
			for _, t := range toolsSlice {
				if toolMap, ok := t.(map[string]interface{}); ok {
					tool := MCPTool{
						Name:        toString(toolMap["name"]),
						Description: toString(toolMap["description"]),
					}
					if schema, ok := toolMap["inputSchema"].(map[string]interface{}); ok {
						tool.InputSchema = schema
					}
					tools = append(tools, tool)
				}
			}
		}
	}

	return tools, nil
}

// CallTool invokes a tool on the MCP server
func (c *Client) CallTool(ctx context.Context, name string, args map[string]interface{}) (string, error) {
	req := jsonRPCRequest{
		JSONRPC: "2.0",
		Method:  "tools/call",
		Params: map[string]interface{}{
			"name":      name,
			"arguments": args,
		},
		ID: 3,
	}

	resp, err := c.send(ctx, req)
	if err != nil {
		return "", err
	}

	if content, ok := resp["content"]; ok {
		if contentSlice, ok := content.([]interface{}); ok && len(contentSlice) > 0 {
			if contentMap, ok := contentSlice[0].(map[string]interface{}); ok {
				return toString(contentMap["text"]), nil
			}
		}
	}

	return "", fmt.Errorf("unexpected tool call response format")
}

// send sends a JSON-RPC 2.0 request and returns the result.
func (c *Client) send(ctx context.Context, req jsonRPCRequest) (map[string]interface{}, error) {
	result, _, err := c.sendWithHeaders(ctx, req)
	return result, err
}

// sendWithHeaders sends a JSON-RPC 2.0 request and returns the result plus the
// Mcp-Session-Id response header (empty string if not present).
// It supports both the classic HTTP transport (application/json response) and
// the newer Streamable HTTP / SSE transport (text/event-stream response).
func (c *Client) sendWithHeaders(ctx context.Context, req jsonRPCRequest) (map[string]interface{}, string, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, "", err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.mcpEndpoint(), bytes.NewReader(body))
	if err != nil {
		return nil, "", err
	}
	// Accept both classic JSON and SSE (Streamable HTTP) responses so that
	// servers using either MCP transport variant will work.
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json, text/event-stream")

	// Echo session ID back to the server for Streamable HTTP transport.
	if c.sessionID != "" {
		httpReq.Header.Set("Mcp-Session-Id", c.sessionID)
	}

	// Inject authentication headers if configured
	if c.AuthConfig != nil {
		c.injectAuth(httpReq)
	}

	httpResp, err := c.HTTPClient.Do(httpReq)
	if err != nil {
		return nil, "", err
	}
	defer httpResp.Body.Close()

	ct := httpResp.Header.Get("Content-Type")
	sessionID := httpResp.Header.Get("Mcp-Session-Id")

	// ── SSE / Streamable HTTP transport ──────────────────────────────────────
	// The server responds with text/event-stream; read the first "data:" line
	// that contains a complete JSON-RPC response object.
	if strings.Contains(ct, "text/event-stream") {
		result, err := c.readSSEResponse(httpResp.Body)
		return result, sessionID, err
	}

	// ── Classic JSON transport ────────────────────────────────────────────────
	respBody, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return nil, sessionID, err
	}

	var jsonResp jsonRPCResponse
	if err := json.Unmarshal(respBody, &jsonResp); err != nil {
		return nil, sessionID, fmt.Errorf("parse MCP response: %w (body: %s)", err, string(respBody))
	}

	if jsonResp.Error != nil {
		return nil, sessionID, fmt.Errorf("MCP error: %s", jsonResp.Error.Message)
	}

	return jsonResp.Result, sessionID, nil
}

// readSSEResponse reads a text/event-stream body and returns the first
// JSON-RPC result found in a "data:" line.
func (c *Client) readSSEResponse(body io.Reader) (map[string]interface{}, error) {
	scanner := bufio.NewScanner(body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}

		var jsonResp jsonRPCResponse
		if err := json.Unmarshal([]byte(data), &jsonResp); err != nil {
			// Not a JSON-RPC envelope — skip non-JSON lines
			continue
		}
		if jsonResp.Error != nil {
			return nil, fmt.Errorf("MCP error: %s", jsonResp.Error.Message)
		}
		return jsonResp.Result, nil
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read SSE stream: %w", err)
	}
	return nil, fmt.Errorf("no JSON-RPC response found in SSE stream")
}

// helper to safely convert interface{} to string
func toString(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// injectAuth injects authentication headers into the HTTP request based on auth config
func (c *Client) injectAuth(req *http.Request) {
	if c.AuthConfig == nil {
		return
	}

	switch c.AuthConfig.Type {
	case "bearer_token":
		headerName := c.AuthConfig.HeaderName
		if headerName == "" {
			headerName = "Authorization"
		}
		req.Header.Set(headerName, "Bearer "+c.AuthConfig.Token)

	case "api_key":
		keyName := c.AuthConfig.KeyName
		if keyName == "" {
			keyName = "X-API-Key"
		}
		keyIn := c.AuthConfig.KeyIn
		if keyIn == "" {
			keyIn = "header"
		}

		if keyIn == "header" {
			req.Header.Set(keyName, c.AuthConfig.Key)
		} else if keyIn == "query" {
			q := req.URL.Query()
			q.Add(keyName, c.AuthConfig.Key)
			req.URL.RawQuery = q.Encode()
		}

	case "oauth2":
		// OAuth2 token should be obtained separately and set as bearer token
		if c.AuthConfig.Token != "" {
			req.Header.Set("Authorization", "Bearer "+c.AuthConfig.Token)
		}
	}
}
