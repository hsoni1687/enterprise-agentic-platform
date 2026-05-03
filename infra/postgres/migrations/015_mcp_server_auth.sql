-- Migration 015: Add authentication support to MCP servers
-- Adds auth_config JSONB column to store encrypted credentials for different auth types

ALTER TABLE mcp_servers
    ADD COLUMN auth_config JSONB;

-- auth_config schema supports three types:
-- 1. Bearer Token:
--    {
--      "type": "bearer_token",
--      "token": "encrypted_token_here",
--      "header_name": "Authorization"  // Optional, defaults to Authorization
--    }
--
-- 2. API Key:
--    {
--      "type": "api_key",
--      "key": "encrypted_key_here",
--      "header_name": "X-API-Key",  // Which header to send the key in
--      "key_in": "header"  // header or query
--    }
--
-- 3. OAuth 2.0:
--    {
--      "type": "oauth2",
--      "client_id": "client_id",
--      "client_secret": "encrypted_client_secret",
--      "token_url": "https://...",
--      "scope": "read write"  // Optional
--    }
--
-- All sensitive fields (token, key, client_secret) are encrypted at the application layer
-- and stored as encrypted strings.

CREATE INDEX IF NOT EXISTS idx_mcp_servers_auth_config ON mcp_servers USING GIN (auth_config);
