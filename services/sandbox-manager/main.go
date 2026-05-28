package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/agent-platform/sandbox-manager/pkg/sandbox"
)

func main() {
	executor, err := sandbox.NewExecutor()
	if err != nil {
		log.Fatalf("Failed to initialize Docker executor: %v", err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("POST /api/v1/execute", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Code string `json:"code"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		result, err := executor.ExecutePython(r.Context(), req.Code)
		if err != nil {
			http.Error(w, fmt.Sprintf("Execution failed: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"result": result})
	})

	mux.HandleFunc("POST /api/v1/web-search", handleWebSearch())
	mux.HandleFunc("POST /api/v1/web-fetch", handleWebFetch())

	log.Println("Starting Sandbox Manager on :8082")
	if err := http.ListenAndServe(":8082", mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "Sandbox Manager is healthy\n")
}

// handleWebSearch scrapes DuckDuckGo HTML results — works for any query,
// unlike the JSON instant-answer API which only returns factual lookups.
func handleWebSearch() http.HandlerFunc {
	// Pre-compiled regex patterns
	linkRe    := regexp.MustCompile(`class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>`)
	snippetRe := regexp.MustCompile(`class="result__snippet"[^>]*>([\s\S]*?)</div>`)
	tagRe     := regexp.MustCompile(`<[^>]+>`)

	stripTags := func(s string) string {
		s = tagRe.ReplaceAllString(s, "")
		s = strings.ReplaceAll(s, "&amp;", "&")
		s = strings.ReplaceAll(s, "&lt;", "<")
		s = strings.ReplaceAll(s, "&gt;", ">")
		s = strings.ReplaceAll(s, "&quot;", `"`)
		s = strings.ReplaceAll(s, "&#x27;", "'")
		return strings.TrimSpace(s)
	}

	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req struct {
			Args struct {
				Query      string `json:"query"`
				MaxResults int    `json:"max_results"`
			} `json:"args"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Args.Query == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "query is required", "results": []interface{}{}})
			return
		}
		if req.Args.MaxResults <= 0 || req.Args.MaxResults > 10 {
			req.Args.MaxResults = 5
		}

		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()

		// POST to DuckDuckGo HTML endpoint — same as a real browser form submit
		formData := url.Values{"q": {req.Args.Query}, "b": {""}}
		httpReq, _ := http.NewRequestWithContext(ctx, http.MethodPost,
			"https://html.duckduckgo.com/html/",
			strings.NewReader(formData.Encode()))
		httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		httpReq.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")
		httpReq.Header.Set("Accept-Language", "en-US,en;q=0.9")

		client := &http.Client{
			Timeout: 15 * time.Second,
			// Follow redirects
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 5 {
					return fmt.Errorf("too many redirects")
				}
				return nil
			},
		}

		resp, err := client.Do(httpReq)
		if err != nil {
			log.Printf("[web-search] HTTP error: %v", err)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "results": []interface{}{}})
			return
		}
		defer resp.Body.Close()

		body, _ := io.ReadAll(resp.Body)
		html := string(body)

		links    := linkRe.FindAllStringSubmatch(html, -1)
		snippets := snippetRe.FindAllStringSubmatch(html, -1)

		type Result struct {
			Rank    int    `json:"rank"`
			Title   string `json:"title"`
			URL     string `json:"url"`
			Snippet string `json:"snippet"`
			Domain  string `json:"domain"`
		}

		results := make([]Result, 0, req.Args.MaxResults)
		for i, m := range links {
			if i >= req.Args.MaxResults {
				break
			}
			rawURL := m[1]
			title  := stripTags(m[2])
			snippet := ""
			if i < len(snippets) {
				snippet = stripTags(snippets[i][1])
			}
			domain := extractDomain(rawURL)
			results = append(results, Result{
				Rank:    i + 1,
				Title:   title,
				URL:     rawURL,
				Snippet: snippet,
				Domain:  domain,
			})
		}

		log.Printf("[web-search] query=%q results=%d", req.Args.Query, len(results))
		json.NewEncoder(w).Encode(map[string]interface{}{
			"query":   req.Args.Query,
			"results": results,
			"total":   len(results),
		})
	}
}

func handleWebFetch() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Args struct {
				URL      string `json:"url"`
				Query    string `json:"query"`
				MaxChars int    `json:"max_chars"`
			} `json:"args"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		if req.Args.URL == "" {
			http.Error(w, "url is required", http.StatusBadRequest)
			return
		}

		if req.Args.MaxChars == 0 {
			req.Args.MaxChars = 4000
		}

		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()

		client := &http.Client{
			Timeout: 15 * time.Second,
		}

		httpReq, _ := http.NewRequestWithContext(ctx, "GET", req.Args.URL, nil)
		httpReq.Header.Set("User-Agent", "A1-Agent-Engine/1.0")

		resp, err := client.Do(httpReq)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error": fmt.Sprintf("Fetch failed: %v", err),
			})
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error": fmt.Sprintf("HTTP %d", resp.StatusCode),
			})
			return
		}

		body, err := io.ReadAll(io.LimitReader(resp.Body, 100*1024))
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error": fmt.Sprintf("Read failed: %v", err),
			})
			return
		}

		htmlContent := string(body)
		title := extractTitle(htmlContent)
		textContent := stripHTML(htmlContent)

		if len(textContent) > req.Args.MaxChars {
			textContent = textContent[:req.Args.MaxChars]
		}

		summary := textContent
		llmGatewayURL := os.Getenv("LLM_GATEWAY_URL")
		if llmGatewayURL != "" && req.Args.Query != "" {
			summaryModel := os.Getenv("LLM_SUMMARY_MODEL")
			if summaryModel == "" {
				summaryModel = "local-chat"
			}
			summaryReq := map[string]interface{}{
				"model": summaryModel,
				"messages": []map[string]string{
					{
						"role": "user",
						"content": fmt.Sprintf(`You are a search result summarizer. Return the most relevant information in 200 words or fewer, focused on facts. End with 'Source: %s'. Query: %s. Content: %s`,
							req.Args.URL, req.Args.Query, textContent[:minInt(3000, len(textContent))]),
					},
				},
				"max_tokens": 400,
			}

			summaryBody, _ := json.Marshal(summaryReq)
			summaryHTTPReq, _ := http.NewRequestWithContext(ctx, "POST", llmGatewayURL+"/chat/completions", bytes.NewReader(summaryBody))
			summaryHTTPReq.Header.Set("Content-Type", "application/json")
			litellmMasterKey := os.Getenv("LITELLM_MASTER_KEY")
			if litellmMasterKey == "" {
				litellmMasterKey = "sk-litellm-dev"
			}
			summaryHTTPReq.Header.Set("Authorization", "Bearer "+litellmMasterKey)

			if summaryResp, err := client.Do(summaryHTTPReq); err == nil && summaryResp.StatusCode == http.StatusOK {
				defer summaryResp.Body.Close()
				var summaryResult map[string]interface{}
				if json.NewDecoder(summaryResp.Body).Decode(&summaryResult) == nil {
					if choices, ok := summaryResult["choices"].([]interface{}); ok && len(choices) > 0 {
						if choice, ok := choices[0].(map[string]interface{}); ok {
							if message, ok := choice["message"].(map[string]interface{}); ok {
								if content, ok := message["content"].(string); ok {
									summary = content
								}
							}
						}
					}
				}
			}
		}

		output := map[string]interface{}{
			"url":            req.Args.URL,
			"title":          title,
			"summary":        summary,
			"content_length": len(textContent),
			"truncated":      len(textContent) > req.Args.MaxChars,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(output)
	}
}

func extractDomain(urlStr string) string {
	u, err := url.Parse(urlStr)
	if err != nil {
		return ""
	}
	host := u.Host
	host = strings.TrimPrefix(host, "www.")
	return host
}

func extractTitle(html string) string {
	re := regexp.MustCompile(`(?i)<title[^>]*>([^<]+)</title>`)
	matches := re.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	return ""
}

func stripHTML(html string) string {
	re := regexp.MustCompile(`<[^>]+>`)
	text := re.ReplaceAllString(html, " ")
	text = regexp.MustCompile(`\s+`).ReplaceAllString(text, " ")
	return strings.TrimSpace(text)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
