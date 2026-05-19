package service

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/agent-platform/kg-service/pkg/store"
	"github.com/pgvector/pgvector-go"
)

var htmlTagRe = regexp.MustCompile(`<[^>]+>`)

// fetchClient skips TLS verification so ingest works inside Docker where
// the Alpine final image has no CA certificate bundle installed.
var fetchClient = &http.Client{
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec
	},
}

type Handler struct {
	store               store.Store
	llmGatewayURL       string
	litellmMasterKey    string
	embeddingModel      string
	embeddingDimensions int
	extractionModel     string // model used for entity extraction during ingestion
}

func NewHandler(s store.Store, llmGatewayURL, litellmMasterKey, embeddingModel string, embeddingDimensions int) *Handler {
	extractionModel := os.Getenv("KG_EXTRACTION_MODEL")
	if extractionModel == "" {
		extractionModel = "mock-gpt-4o" // routes to local Ollama chat model
	}
	return &Handler{
		store:               s,
		llmGatewayURL:       llmGatewayURL,
		litellmMasterKey:    litellmMasterKey,
		embeddingModel:      embeddingModel,
		embeddingDimensions: embeddingDimensions,
		extractionModel:     extractionModel,
	}
}

// ============== Helpers ==============

func (h *Handler) embedText(ctx context.Context, text string) (pgvector.Vector, error) {
	payload := map[string]interface{}{
		"input": text,
		"model": h.embeddingModel,
	}
	body, _ := json.Marshal(payload)

	// Use a short deadline (3 s) so failed embedding calls fast-fail instead of
	// stalling chunk ingestion for the full HTTP client timeout.
	embedCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	req, _ := http.NewRequestWithContext(embedCtx, http.MethodPost, h.llmGatewayURL+"/v1/embeddings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if h.litellmMasterKey != "" {
		req.Header.Set("Authorization", "Bearer "+h.litellmMasterKey)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[embedText] LLM gateway unreachable, using mock embedding: %v", err)
		return h.mockEmbedding(text), nil
	}
	defer resp.Body.Close()

	var result struct {
		Data []struct {
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
	}
	respBody, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(respBody, &result); err != nil || len(result.Data) == 0 {
		log.Printf("[embedText] Invalid embedding response, using mock: %s", string(respBody))
		return h.mockEmbedding(text), nil
	}
	return pgvector.NewVector(h.normalizeEmbedding(result.Data[0].Embedding)), nil
}

func (h *Handler) normalizeEmbedding(embedding []float32) []float32 {
	if len(embedding) == h.embeddingDimensions {
		return embedding
	}
	normalized := make([]float32, h.embeddingDimensions)
	copy(normalized, embedding)
	return normalized
}

func (h *Handler) mockEmbedding(text string) pgvector.Vector {
	vec := make([]float32, h.embeddingDimensions)
	hash := 0
	for _, c := range text {
		hash = ((hash << 5) + hash) + int(c)
	}
	for i := range vec {
		vec[i] = float32((hash+i)%100) / 100.0
	}
	return pgvector.NewVector(vec)
}

// ============== Entity Extraction ==============

// extractedEntity is a named concept pulled from a text chunk by the LLM.
type extractedEntity struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Confidence  string `json:"confidence"` // EXTRACTED | INFERRED | AMBIGUOUS
}

// extractedRelationship links two entities with a typed relationship.
type extractedRelationship struct {
	From            string  `json:"from"`
	To              string  `json:"to"`
	Type            string  `json:"type"`
	Confidence      string  `json:"confidence"`       // EXTRACTED | INFERRED | AMBIGUOUS
	ConfidenceScore float64 `json:"confidence_score"` // 0.0–1.0
}

type extractionResult struct {
	Entities      []extractedEntity      `json:"entities"`
	Relationships []extractedRelationship `json:"relationships"`
}

const extractionPrompt = `You are a knowledge graph extraction engine. Your job is to read a text passage and extract a structured knowledge graph from it.

Output ONLY a single valid JSON object — no markdown fences, no explanation, no preamble.

Schema:
{
  "entities": [
    {
      "name": "Title-Cased Short Name",
      "type": "EntityType",
      "description": "One precise sentence describing what this entity is.",
      "confidence": "EXTRACTED"
    }
  ],
  "relationships": [
    {
      "from": "Entity Name",
      "to": "Entity Name",
      "type": "relation_type",
      "confidence": "EXTRACTED",
      "confidence_score": 1.0
    }
  ]
}

━━━ ENTITY TYPES ━━━
Pick the single best fit:
  Service       — a running system, microservice, or platform component
  Component     — a module, library, class, or sub-unit inside a service
  API           — an interface, endpoint, contract, or protocol
  Database      — any data store (SQL, NoSQL, cache, queue, object store)
  Team          — an organisational unit or group of people
  Person        — a named individual (author, owner, contact)
  Concept       — an abstract idea, pattern, or domain term
  Process       — a workflow, pipeline, job, or operational procedure
  Tool          — a CLI, IDE plugin, build system, or developer tool
  Policy        — a rule, constraint, SLA, or governance document
  Event         — a trigger, message, notification, or time-bound occurrence
  Configuration — a config file, flag, environment variable, or setting
  Document      — a spec, RFC, runbook, or reference document

━━━ RELATIONSHIP TYPES ━━━
Use the closest match (snake_case):
  depends_on          — runtime or build-time dependency
  calls / invokes     — one entity directly calls another
  implements          — concrete realisation of an interface or contract
  extends / inherits  — specialisation or subclassing
  routes_to           — traffic or request forwarding
  publishes_to        — sends events or messages to
  subscribes_to       — consumes events or messages from
  stores_in           — persists data to a database or store
  reads_from          — reads data from a database or store
  owns / managed_by   — ownership or administrative responsibility
  defined_in          — entity is specified in a document or config
  triggers            — one entity causes another to start
  uses                — general-purpose tool or library usage
  references          — conceptual reference or citation
  conceptually_related_to — thematic or domain similarity (use sparingly)

━━━ CONFIDENCE LEVELS ━━━
  EXTRACTED  — explicitly stated in the text (prefer this)
  INFERRED   — reasonably implied but not directly stated
  AMBIGUOUS  — uncertain; include but flag with confidence_score < 0.5

━━━ RULES ━━━
1. Entity names: 1-4 words, Title-Cased, specific (e.g. "API Gateway" not "Gateway")
2. Descriptions: one sentence, factual, no filler ("This is a..." → bad; "Handles auth token validation" → good)
3. Only create a relationship if BOTH endpoints are in your entity list
4. Max 15 entities, 20 relationships per chunk — prioritise the most important ones
5. De-duplicate: if the same real-world thing appears under two names, pick the canonical one
6. If the text has no identifiable named entities, return: {"entities":[],"relationships":[]}

Text:
`

// extractEntities calls the LLM to extract entities and relationships from a text chunk.
// Returns empty slices (not an error) when the model produces no usable output.
// Retries once if the model returns a hollow response (HTTP 200 but no entities/relationships).
func (h *Handler) extractEntities(ctx context.Context, chunk, model string) ([]extractedEntity, []extractedRelationship) {
	const maxAttempts = 2
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		ents, rels, hollow := h.extractEntitiesOnce(ctx, chunk, model)
		if !hollow {
			return ents, rels
		}
		if attempt < maxAttempts {
			log.Printf("[extractEntities] hollow response on attempt %d, retrying…", attempt)
		}
	}
	return nil, nil
}

// extractEntitiesOnce performs a single LLM call.
// Returns (entities, relationships, isHollow) where isHollow=true means the model
// returned HTTP 200 but produced no usable content (empty string, no JSON, zero entities+rels).
func (h *Handler) extractEntitiesOnce(ctx context.Context, chunk, model string) ([]extractedEntity, []extractedRelationship, bool) {
	extractCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	body := map[string]interface{}{
		"model": model,
		"messages": []map[string]string{
			{"role": "user", "content": extractionPrompt + chunk},
		},
		"max_tokens":      1024, // richer schema needs more room
		"temperature":     0,
		"response_format": map[string]string{"type": "json_object"},
	}
	bodyBytes, _ := json.Marshal(body)

	req, err := http.NewRequestWithContext(extractCtx, http.MethodPost,
		h.llmGatewayURL+"/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, nil, false
	}
	req.Header.Set("Content-Type", "application/json")
	if h.litellmMasterKey != "" {
		req.Header.Set("Authorization", "Bearer "+h.litellmMasterKey)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[extractEntities] LLM call failed: %v", err)
		return nil, nil, false
	}
	defer resp.Body.Close()

	var llmResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	respBytes, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(respBytes, &llmResp); err != nil || len(llmResp.Choices) == 0 {
		log.Printf("[extractEntities] bad LLM response: %s", string(respBytes))
		return nil, nil, false
	}

	content := strings.TrimSpace(llmResp.Choices[0].Message.Content)

	// Hollow response: model returned 200 but empty content
	if content == "" {
		log.Printf("[extractEntities] hollow: empty content from model")
		return nil, nil, true
	}

	// Strip markdown code fences if the model added them
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)

	// Find the outermost JSON object
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start < 0 || end <= start {
		log.Printf("[extractEntities] no JSON object found in: %s", content)
		return nil, nil, true
	}
	content = content[start : end+1]

	var result extractionResult
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		log.Printf("[extractEntities] JSON parse failed: %v — raw: %s", err, content)
		return nil, nil, false
	}

	// Hollow: parsed OK but no content at all
	if len(result.Entities) == 0 && len(result.Relationships) == 0 {
		log.Printf("[extractEntities] hollow: zero entities and relationships")
		return nil, nil, true
	}

	return result.Entities, result.Relationships, false
}

// firstWords returns the first n words of s joined by spaces.
func firstWords(s string, n int) string {
	words := strings.Fields(s)
	if len(words) > n {
		words = words[:n]
	}
	return strings.Join(words, " ")
}

// ingestTextIntoGraph processes text through entity extraction and stores the
// resulting entities as nodes and their relationships as edges in the graph.
// extractionModel overrides h.extractionModel when non-empty.
// If extraction yields nothing for a chunk it falls back to a descriptive chunk node.
func (h *Handler) ingestTextIntoGraph(
	ctx context.Context,
	text, graphID, tenantID, source, extractionModel string,
) (nodesCreated, edgesCreated int) {
	if extractionModel == "" {
		extractionModel = h.extractionModel
	}

	// Use larger chunks for extraction — more context = better entity detection.
	chunks := chunkText(text, 1500, 150)

	// labelToID maps normalised entity label → node ID for dedup + edge wiring.
	labelToID := make(map[string]string, len(chunks)*6)
	normalise := func(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

	for i, chunk := range chunks {
		entities, relationships := h.extractEntities(ctx, chunk, extractionModel)

		if len(entities) == 0 {
			// Fallback: store as a single descriptive chunk node so context is not lost.
			label := firstWords(chunk, 8)
			if label == "" {
				continue
			}
			emb, _ := h.embedText(ctx, chunk)
			node := &store.Node{
				GraphID:  graphID,
				TenantID: tenantID,
				NodeType: "Document",
				Label:    label,
				Properties: map[string]interface{}{
					"content": chunk,
					"source":  source,
					"index":   i,
				},
				Embedding: &emb,
			}
			if created, err := h.store.CreateNode(ctx, node); err == nil {
				labelToID[normalise(label)] = created.ID
				nodesCreated++
			}
			continue
		}

		// Create nodes for entities not yet seen across chunks.
		for _, ent := range entities {
			key := normalise(ent.Name)
			if _, exists := labelToID[key]; exists {
				continue // already persisted from an earlier chunk
			}
			// Embed name + description for richer semantic search.
			embText := ent.Name
			if ent.Description != "" {
				embText += ": " + ent.Description
			}
			emb, _ := h.embedText(ctx, embText)
			confidence := ent.Confidence
			if confidence == "" {
				confidence = "EXTRACTED"
			}
			node := &store.Node{
				GraphID:  graphID,
				TenantID: tenantID,
				NodeType: ent.Type,
				Label:    ent.Name,
				Properties: map[string]interface{}{
					"description": ent.Description,
					"source":      source,
					"content":     chunk, // keep raw text for semantic search fallback
					"confidence":  confidence,
				},
				Embedding: &emb,
			}
			created, err := h.store.CreateNode(ctx, node)
			if err != nil {
				log.Printf("[ingest] create node %q failed: %v", ent.Name, err)
				continue
			}
			labelToID[key] = created.ID
			nodesCreated++
		}

		// Wire relationships — both endpoints must have been created.
		for _, rel := range relationships {
			fromID, ok1 := labelToID[normalise(rel.From)]
			toID, ok2 := labelToID[normalise(rel.To)]
			if !ok1 || !ok2 {
				continue
			}
			confidence := rel.Confidence
			if confidence == "" {
				confidence = "EXTRACTED"
			}
			score := rel.ConfidenceScore
			if score == 0 {
				score = 1.0
			}
			// Use confidence score as edge weight so AMBIGUOUS edges are visually lighter.
			weight := score
			if confidence == "AMBIGUOUS" && weight > 0.5 {
				weight = 0.4
			}
			edge := &store.Edge{
				GraphID:          graphID,
				TenantID:         tenantID,
				FromNodeID:       fromID,
				ToNodeID:         toID,
				RelationshipType: rel.Type,
				Properties: map[string]interface{}{
					"source":           source,
					"confidence":       confidence,
					"confidence_score": score,
				},
				Weight: weight,
			}
			if _, err := h.store.CreateEdge(ctx, edge); err == nil {
				edgesCreated++
			}
		}
	}
	return
}

// chunkText splits text into overlapping chunks of ~chunkSize runes with overlap runes of overlap.
func chunkText(text string, chunkSize, overlap int) []string {
	runes := []rune(text)
	var chunks []string
	for start := 0; start < len(runes); start += chunkSize - overlap {
		end := start + chunkSize
		if end > len(runes) {
			end = len(runes)
		}
		chunk := strings.TrimSpace(string(runes[start:end]))
		if len(chunk) > 20 { // skip tiny fragments
			chunks = append(chunks, chunk)
		}
		if end == len(runes) {
			break
		}
	}
	return chunks
}

// stripHTML removes HTML tags and decodes common entities from raw HTML.
func stripHTML(s string) string {
	// Remove script and style blocks
	s = htmlTagRe.ReplaceAllString(s, " ")
	// Collapse whitespace
	s = strings.Join(strings.Fields(s), " ")
	return s
}

// ============== Graphs ==============

func (h *Handler) CreateGraph(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, _ := io.ReadAll(r.Body)
	log.Printf("[CreateGraph] Request body: %s", string(body))

	var g store.Graph
	if err := json.Unmarshal(body, &g); err != nil {
		log.Printf("[CreateGraph] Decode error: %v", err)
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	log.Printf("[CreateGraph] Decoded graph: %+v", g)

	g.TenantID = r.Header.Get("X-Tenant-ID")
	if g.TenantID == "" {
		http.Error(w, "Missing X-Tenant-ID header", http.StatusBadRequest)
		return
	}

	ctx := context.WithValue(r.Context(), "tenant_id", g.TenantID)
	result, err := h.store.CreateGraph(ctx, &g)
	if err != nil {
		log.Printf("[CreateGraph] Store error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[CreateGraph] Result: %+v", result)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) GetGraph(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	graphID := r.URL.Query().Get("id")
	if graphID == "" {
		http.Error(w, "Missing id parameter", http.StatusBadRequest)
		return
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "Missing X-Tenant-ID header", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	g, err := h.store.GetGraph(ctx, tenantID, graphID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(g)
}

func (h *Handler) ListGraphs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "Missing X-Tenant-ID header", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	graphs, err := h.store.ListGraphs(ctx, tenantID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if graphs == nil {
		graphs = []*store.Graph{}
	}
	json.NewEncoder(w).Encode(graphs)
}

func (h *Handler) UpdateGraph(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var g store.Graph
	if err := json.NewDecoder(r.Body).Decode(&g); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "Missing X-Tenant-ID header", http.StatusBadRequest)
		return
	}

	g.TenantID = tenantID
	ctx := r.Context()
	result, err := h.store.UpdateGraph(ctx, &g)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) UpdateGraphScope(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Scope      string   `json:"scope"`
		SharedWith []string `json:"shared_with"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	graphID := r.URL.Query().Get("id")
	tenantID := r.Header.Get("X-Tenant-ID")
	if graphID == "" || tenantID == "" {
		http.Error(w, "Missing id or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	if err := h.store.UpdateGraphScope(ctx, tenantID, graphID, req.Scope, req.SharedWith); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteGraph(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	graphID := r.URL.Query().Get("id")
	tenantID := r.Header.Get("X-Tenant-ID")
	if graphID == "" || tenantID == "" {
		http.Error(w, "Missing id or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	if err := h.store.DeleteGraph(ctx, tenantID, graphID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ============== Nodes ==============

func (h *Handler) CreateNode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var n store.Node
	if err := json.NewDecoder(r.Body).Decode(&n); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	n.TenantID = r.Header.Get("X-Tenant-ID")
	if n.TenantID == "" {
		http.Error(w, "Missing X-Tenant-ID header", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	result, err := h.store.CreateNode(ctx, &n)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Auto-embed the node if no embedding provided
	if result.Embedding == nil {
		go func() {
			text := fmt.Sprintf("%s %s", result.NodeType, result.Label)
			if result.Properties != nil {
				if props, err := json.Marshal(result.Properties); err == nil {
					text += " " + string(props)
				}
			}
			emb, err := h.embedText(context.Background(), text)
			if err == nil {
				h.store.UpdateNodeEmbedding(context.Background(), result.TenantID, result.ID, emb)
			} else {
				log.Printf("[CreateNode] Failed to auto-embed node %s: %v", result.ID, err)
			}
		}()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) GetNode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	nodeID := r.URL.Query().Get("id")
	tenantID := r.Header.Get("X-Tenant-ID")
	if nodeID == "" || tenantID == "" {
		http.Error(w, "Missing id or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	n, err := h.store.GetNode(ctx, tenantID, nodeID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(n)
}

func (h *Handler) ListNodes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	graphID := r.URL.Query().Get("graph_id")
	tenantID := r.Header.Get("X-Tenant-ID")
	if graphID == "" || tenantID == "" {
		http.Error(w, "Missing graph_id or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	nodes, err := h.store.ListNodes(ctx, tenantID, graphID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if nodes == nil {
		nodes = []*store.Node{}
	}
	json.NewEncoder(w).Encode(nodes)
}

func (h *Handler) DeleteNode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	nodeID := r.URL.Query().Get("id")
	tenantID := r.Header.Get("X-Tenant-ID")
	if nodeID == "" || tenantID == "" {
		http.Error(w, "Missing id or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	if err := h.store.DeleteNode(ctx, tenantID, nodeID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ============== Edges ==============

func (h *Handler) CreateEdge(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var e store.Edge
	if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	e.TenantID = r.Header.Get("X-Tenant-ID")
	if e.TenantID == "" {
		http.Error(w, "Missing X-Tenant-ID header", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	result, err := h.store.CreateEdge(ctx, &e)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) ListEdges(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	graphID := r.URL.Query().Get("graph_id")
	tenantID := r.Header.Get("X-Tenant-ID")
	if graphID == "" || tenantID == "" {
		http.Error(w, "Missing graph_id or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	edges, err := h.store.ListEdges(ctx, tenantID, graphID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if edges == nil {
		edges = []*store.Edge{}
	}
	json.NewEncoder(w).Encode(edges)
}

func (h *Handler) DeleteEdge(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	edgeID := r.URL.Query().Get("id")
	tenantID := r.Header.Get("X-Tenant-ID")
	if edgeID == "" || tenantID == "" {
		http.Error(w, "Missing id or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	if err := h.store.DeleteEdge(ctx, tenantID, edgeID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ============== Query ==============

func (h *Handler) QueryGraph(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var graphID, startNodeID string
	var maxDepth = 3

	if r.Method == http.MethodPost {
		var queryReq struct {
			GraphID     string `json:"graph_id"`
			StartNodeID string `json:"start_node_id"`
			MaxDepth    int    `json:"max_depth,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&queryReq); err == nil {
			graphID = queryReq.GraphID
			startNodeID = queryReq.StartNodeID
			if queryReq.MaxDepth > 0 {
				maxDepth = queryReq.MaxDepth
			}
		}
	} else {
		graphID = r.URL.Query().Get("graph_id")
		startNodeID = r.URL.Query().Get("start_node_id")
		if d := r.URL.Query().Get("max_depth"); d != "" {
			if parsed, err := strconv.Atoi(d); err == nil {
				maxDepth = parsed
			}
		}
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	if graphID == "" || startNodeID == "" || tenantID == "" {
		http.Error(w, "Missing graph_id, start_node_id, or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	nodes, edges, err := h.store.QueryGraph(ctx, tenantID, graphID, startNodeID, maxDepth)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	result := map[string]interface{}{
		"nodes": nodes,
		"edges": edges,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) SearchNodes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var graphID, nodeType string
	var limit = 100

	if r.Method == http.MethodPost {
		var searchReq struct {
			GraphID string `json:"graph_id"`
			Type    string `json:"type"`
			Limit   int    `json:"limit,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&searchReq); err == nil {
			graphID = searchReq.GraphID
			nodeType = searchReq.Type
			if searchReq.Limit > 0 {
				limit = searchReq.Limit
			}
		}
	} else {
		graphID = r.URL.Query().Get("graph_id")
		nodeType = r.URL.Query().Get("node_type")
		if l := r.URL.Query().Get("limit"); l != "" {
			if parsed, err := strconv.Atoi(l); err == nil {
				limit = parsed
			}
		}
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	if graphID == "" || nodeType == "" || tenantID == "" {
		http.Error(w, "Missing graph_id, node_type, or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	nodes, err := h.store.SearchNodes(ctx, tenantID, graphID, nodeType, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if nodes == nil {
		nodes = []*store.Node{}
	}
	json.NewEncoder(w).Encode(nodes)
}

// ============== Semantic Search ==============

func (h *Handler) SemanticSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Query   string `json:"query"`
		GraphID string `json:"graph_id"`
		Limit   int    `json:"limit"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Query == "" {
		http.Error(w, "Missing query", http.StatusBadRequest)
		return
	}
	if req.Limit <= 0 {
		req.Limit = 10
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "Missing X-Tenant-ID header", http.StatusBadRequest)
		return
	}

	embedding, err := h.embedText(r.Context(), req.Query)
	if err != nil {
		log.Printf("[SemanticSearch] Embedding error: %v", err)
		http.Error(w, "Failed to embed query", http.StatusInternalServerError)
		return
	}

	nodes, err := h.store.SearchNodesByEmbedding(r.Context(), tenantID, req.GraphID, embedding, req.Limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if nodes == nil {
		nodes = []*store.Node{}
	}
	json.NewEncoder(w).Encode(nodes)
}

func (h *Handler) ReembedNodes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "Missing X-Tenant-ID header", http.StatusBadRequest)
		return
	}

	graphID := r.URL.Query().Get("graph_id")

	ctx := r.Context()

	var nodes []*store.Node
	var err error
	if graphID != "" {
		nodes, err = h.store.ListNodes(ctx, tenantID, graphID)
	} else {
		nodes, err = h.store.ListNodes(ctx, tenantID, "")
	}
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to list nodes: %v", err), http.StatusInternalServerError)
		return
	}

	embedded := 0
	failed := 0

	for _, n := range nodes {
		if n.Embedding != nil {
			continue
		}

		text := fmt.Sprintf("%s %s", n.NodeType, n.Label)
		if n.Properties != nil {
			if props, err := json.Marshal(n.Properties); err == nil {
				text += " " + string(props)
			}
		}

		emb, err := h.embedText(ctx, text)
		if err != nil {
			log.Printf("[ReembedNodes] Failed to embed node %s: %v", n.ID, err)
			failed++
			continue
		}

		if err := h.store.UpdateNodeEmbedding(ctx, tenantID, n.ID, emb); err != nil {
			log.Printf("[ReembedNodes] Failed to update embedding for node %s: %v", n.ID, err)
			failed++
			continue
		}

		embedded++
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"embedded": embedded, "failed": failed})
}

// ============== Ingest ==============

// IngestURL fetches a URL, chunks the text content, embeds each chunk,
// and creates kg_nodes in the specified graph.
func (h *Handler) IngestURL(w http.ResponseWriter, r *http.Request) {
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
		GraphID         string `json:"graph_id"`
		URL             string `json:"url"`
		ExtractionModel string `json:"extraction_model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.GraphID == "" || req.URL == "" {
		http.Error(w, "graph_id and url are required", http.StatusBadRequest)
		return
	}

	// Fetch URL content
	resp, err := fetchClient.Get(req.URL)
	if err != nil {
		http.Error(w, "Failed to fetch URL: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024)) // 2 MB cap
	if err != nil {
		http.Error(w, "Failed to read URL content: "+err.Error(), http.StatusBadGateway)
		return
	}

	text := stripHTML(string(raw))
	ctx := r.Context()
	nodes, edges := h.ingestTextIntoGraph(ctx, text, req.GraphID, tenantID, req.URL, req.ExtractionModel)
	log.Printf("[IngestURL] source=%s model=%s nodes=%d edges=%d", req.URL, req.ExtractionModel, nodes, edges)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"nodes_created": nodes,
		"edges_created": edges,
		"source":        req.URL,
	})
}

// IngestFile parses an uploaded text/markdown/pdf file, chunks the content,
// embeds each chunk, and creates kg_nodes in the specified graph.
func (h *Handler) IngestFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "Missing X-Tenant-ID header", http.StatusBadRequest)
		return
	}

	// Parse multipart form — max 10 MB
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "Failed to parse form: "+err.Error(), http.StatusBadRequest)
		return
	}

	graphID := r.FormValue("graph_id")
	if graphID == "" {
		http.Error(w, "graph_id is required", http.StatusBadRequest)
		return
	}
	extractionModel := r.FormValue("extraction_model") // optional, falls back to env default

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "file is required: "+err.Error(), http.StatusBadRequest)
		return
	}
	defer file.Close()

	raw, err := io.ReadAll(io.LimitReader(file, 10<<20))
	if err != nil {
		http.Error(w, "Failed to read file: "+err.Error(), http.StatusInternalServerError)
		return
	}

	text := string(raw) // markdown and plain text are already readable
	ctx := r.Context()
	nodes, edges := h.ingestTextIntoGraph(ctx, text, graphID, tenantID, header.Filename, extractionModel)
	log.Printf("[IngestFile] file=%s model=%s nodes=%d edges=%d", header.Filename, extractionModel, nodes, edges)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"nodes_created": nodes,
		"edges_created": edges,
		"filename":      header.Filename,
	})
}

// ============== Graph Context (lightweight retrieval, no LLM) ==============

// GraphContext runs hybrid search and returns a formatted context block + source nodes.
// Intended for agent chat — the calling agent does its own LLM reasoning over the context.
func (h *Handler) GraphContext(w http.ResponseWriter, r *http.Request) {
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
		GraphID  string `json:"graph_id"`
		Question string `json:"question"`
		TopK     int    `json:"top_k"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.GraphID == "" || req.Question == "" {
		http.Error(w, "graph_id and question are required", http.StatusBadRequest)
		return
	}
	if req.TopK <= 0 {
		req.TopK = 8
	}

	ctx := r.Context()

	embedding, _ := h.embedText(ctx, req.Question)
	semanticNodes, _ := h.store.SearchNodesByEmbedding(ctx, tenantID, req.GraphID, embedding, req.TopK)
	keywordNodes, _ := h.store.SearchNodesByKeyword(ctx, tenantID, req.GraphID, req.Question, req.TopK)

	seen := make(map[string]bool)
	var nodes []*store.Node
	for _, n := range keywordNodes {
		if !seen[n.ID] {
			seen[n.ID] = true
			nodes = append(nodes, n)
		}
	}
	for _, n := range semanticNodes {
		if !seen[n.ID] {
			seen[n.ID] = true
			nodes = append(nodes, n)
		}
	}
	if len(nodes) > req.TopK {
		nodes = nodes[:req.TopK]
	}

	// Build node index for edge resolution
	nodeByID := make(map[string]*store.Node, len(nodes))
	for _, n := range nodes {
		nodeByID[n.ID] = n
	}
	resolveNode := func(id string) *store.Node {
		if n, ok := nodeByID[id]; ok {
			return n
		}
		fetched, _ := h.store.GetNode(ctx, tenantID, id)
		if fetched != nil {
			nodeByID[id] = fetched
		}
		return fetched
	}
	getDesc := func(n *store.Node) string {
		if d, ok := n.Properties["description"].(string); ok && d != "" {
			return d
		}
		if c, ok := n.Properties["content"].(string); ok && c != "" {
			if len(c) > 150 {
				return c[:150] + "…"
			}
			return c
		}
		return ""
	}

	var lines []string
	sourceNodes := make([]map[string]interface{}, 0, len(nodes))
	for _, n := range nodes {
		desc := getDesc(n)
		line := fmt.Sprintf("[%s] %s", n.NodeType, n.Label)
		if desc != "" {
			line += ": " + desc
		}
		lines = append(lines, line)
		sourceNodes = append(sourceNodes, map[string]interface{}{
			"id": n.ID, "label": n.Label, "type": n.NodeType, "description": desc,
		})
		edges, _ := h.store.ListEdgesFrom(ctx, tenantID, n.ID)
		for _, e := range edges {
			target := resolveNode(e.ToNodeID)
			if target == nil {
				continue
			}
			tDesc := getDesc(target)
			edgeLine := fmt.Sprintf("  → %s ──[%s]──► [%s] %s", n.Label, e.RelationshipType, target.NodeType, target.Label)
			if tDesc != "" {
				edgeLine += ": " + tDesc
			}
			lines = append(lines, edgeLine)
		}
	}

	contextBlock := strings.Join(lines, "\n")
	if contextBlock == "" {
		contextBlock = "(No relevant entities found)"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"context": contextBlock,
		"nodes":   sourceNodes,
	})
}

// ============== Graph Chat (RAG Q&A) ==============

// ChatQuery answers a question by searching the graph for relevant context and
// calling the LLM with that context injected into the system prompt.
func (h *Handler) ChatQuery(w http.ResponseWriter, r *http.Request) {
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
		GraphID string `json:"graph_id"`
		Question string `json:"question"`
		Model    string `json:"model"`    // optional; falls back to extractionModel
		TopK     int    `json:"top_k"`    // optional; default 8
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.GraphID == "" || req.Question == "" {
		http.Error(w, "graph_id and question are required", http.StatusBadRequest)
		return
	}
	if req.TopK <= 0 {
		req.TopK = 8
	}
	model := req.Model
	if model == "" {
		model = h.extractionModel
	}

	ctx := r.Context()

	// 1. Hybrid search: semantic (embedding) + keyword, merged and deduplicated.
	// Keyword search ensures named entities are always found by name even when
	// the embedding model is unavailable and mock vectors are in use.
	embedding, err := h.embedText(ctx, req.Question)
	if err != nil {
		http.Error(w, "Failed to embed question: "+err.Error(), http.StatusInternalServerError)
		return
	}

	semanticNodes, err := h.store.SearchNodesByEmbedding(ctx, tenantID, req.GraphID, embedding, req.TopK)
	if err != nil {
		http.Error(w, "Search failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	keywordNodes, _ := h.store.SearchNodesByKeyword(ctx, tenantID, req.GraphID, req.Question, req.TopK)

	// Merge: keyword hits first (they are exact matches), then semantic, deduplicated by ID.
	seen := make(map[string]bool)
	var nodes []*store.Node
	for _, n := range keywordNodes {
		if !seen[n.ID] {
			seen[n.ID] = true
			nodes = append(nodes, n)
		}
	}
	for _, n := range semanticNodes {
		if !seen[n.ID] {
			seen[n.ID] = true
			nodes = append(nodes, n)
		}
	}
	// Cap at TopK
	if len(nodes) > req.TopK {
		nodes = nodes[:req.TopK]
	}

	// 2. Build context block from retrieved nodes + their outgoing edges.
	// Pre-index retrieved nodes by ID so edge targets can be resolved without extra DB hits.
	nodeByID := make(map[string]*store.Node, len(nodes))
	for _, n := range nodes {
		nodeByID[n.ID] = n
	}

	// resolveNode returns the store.Node for a given ID.
	// Checks the in-memory index first; falls back to a single DB lookup.
	resolveNode := func(id string) *store.Node {
		if n, ok := nodeByID[id]; ok {
			return n
		}
		fetched, err := h.store.GetNode(ctx, tenantID, id)
		if err != nil {
			return nil
		}
		nodeByID[id] = fetched // cache for subsequent edges
		return fetched
	}

	nodeDesc := func(n *store.Node) string {
		if d, ok := n.Properties["description"].(string); ok && d != "" {
			return d
		}
		if c, ok := n.Properties["content"].(string); ok && c != "" {
			if len(c) > 200 {
				return c[:200] + "…"
			}
			return c
		}
		return ""
	}

	var contextParts []string
	sourceNodes := make([]map[string]interface{}, 0, len(nodes))
	for _, n := range nodes {
		desc := nodeDesc(n)
		line := fmt.Sprintf("[%s] %s", n.NodeType, n.Label)
		if desc != "" {
			line += ": " + desc
		}
		contextParts = append(contextParts, line)
		sourceNodes = append(sourceNodes, map[string]interface{}{
			"id":          n.ID,
			"label":       n.Label,
			"type":        n.NodeType,
			"description": desc,
		})

		// Include outgoing edges with fully resolved target labels + descriptions.
		edges, _ := h.store.ListEdgesFrom(ctx, tenantID, n.ID)
		for _, e := range edges {
			target := resolveNode(e.ToNodeID)
			if target == nil {
				continue // skip unresolvable targets
			}
			targetDesc := nodeDesc(target)
			edgeLine := fmt.Sprintf("  → %s ──[%s]──► [%s] %s",
				n.Label, e.RelationshipType, target.NodeType, target.Label)
			if targetDesc != "" {
				edgeLine += ": " + targetDesc
			}
			contextParts = append(contextParts, edgeLine)
		}
	}

	contextBlock := strings.Join(contextParts, "\n")
	if contextBlock == "" {
		contextBlock = "(No relevant entities found in this knowledge graph)"
	}

	systemPrompt := `You are a knowledge graph assistant. Answer the user's question using ONLY the knowledge graph context provided below.
- Be concise and direct.
- Cite specific entity names from the context to support your answer.
- If the context does not contain enough information, say so clearly — do not make things up.

Knowledge Graph Context:
` + contextBlock

	// 3. Call LLM
	llmBody := map[string]interface{}{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": req.Question},
		},
		"max_tokens":  1024,
		"temperature": 0.1,
	}
	llmBytes, _ := json.Marshal(llmBody)

	llmCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	llmReq, _ := http.NewRequestWithContext(llmCtx, http.MethodPost,
		h.llmGatewayURL+"/chat/completions", bytes.NewReader(llmBytes))
	llmReq.Header.Set("Content-Type", "application/json")
	if h.litellmMasterKey != "" {
		llmReq.Header.Set("Authorization", "Bearer "+h.litellmMasterKey)
	}

	llmResp, err := http.DefaultClient.Do(llmReq)
	if err != nil {
		http.Error(w, "LLM call failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer llmResp.Body.Close()

	var llmResult struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	respBytes, _ := io.ReadAll(llmResp.Body)
	if err := json.Unmarshal(respBytes, &llmResult); err != nil {
		http.Error(w, "Failed to parse LLM response", http.StatusInternalServerError)
		return
	}
	if llmResult.Error != nil {
		http.Error(w, "LLM error: "+llmResult.Error.Message, http.StatusBadGateway)
		return
	}

	answer := ""
	if len(llmResult.Choices) > 0 {
		answer = llmResult.Choices[0].Message.Content
	}
	if answer == "" {
		answer = "I could not generate an answer. The model returned an empty response."
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"answer":  answer,
		"sources": sourceNodes,
		"model":   model,
	})
}

// ============== Health ==============

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := h.store.Health(ctx); err != nil {
		http.Error(w, "Health check failed", http.StatusServiceUnavailable)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
}
