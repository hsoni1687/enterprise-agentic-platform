package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/agent-platform/bash-executor/pkg/executor"
)

const defaultPort = "8092"

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	maxMemoryMB, _ := strconv.Atoi(os.Getenv("MAX_MEMORY_MB"))
	if maxMemoryMB == 0 {
		maxMemoryMB = 512
	}

	maxCPUCores, _ := strconv.Atoi(os.Getenv("MAX_CPU_CORES"))
	if maxCPUCores == 0 {
		maxCPUCores = 2
	}

	maxTimeoutSeconds, _ := strconv.Atoi(os.Getenv("MAX_TIMEOUT_SECONDS"))
	if maxTimeoutSeconds == 0 {
		maxTimeoutSeconds = 3600
	}

	maxOutputBytes, _ := strconv.Atoi(os.Getenv("MAX_OUTPUT_BYTES"))
	if maxOutputBytes == 0 {
		maxOutputBytes = 64 * 1024 * 1024 // 64MB
	}

	exec := &executor.BashExecutor{
		MaxMemoryMB:       maxMemoryMB,
		MaxCPUCores:       maxCPUCores,
		MaxTimeoutSeconds: maxTimeoutSeconds,
		MaxOutputBytes:    maxOutputBytes,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/api/v1/execute", handleExecute(exec))

	addr := ":" + port
	log.Printf("Starting Bash Executor on %s (memory: %dMB, cpu: %d cores, timeout: %ds)",
		addr, maxMemoryMB, maxCPUCores, maxTimeoutSeconds)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok"}`))
}

func handleExecute(exec *executor.BashExecutor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req struct {
			Script      string            `json:"script"`
			TimeoutSec  int               `json:"timeout_seconds"`
			Environment map[string]string `json:"environment"`
			WorkingDir  string            `json:"working_dir"`
			ExecutionID string            `json:"execution_id"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
			return
		}

		if req.Script == "" {
			http.Error(w, "script is required", http.StatusBadRequest)
			return
		}

		// Validate timeout
		if req.TimeoutSec <= 0 {
			req.TimeoutSec = 300 // default 5 min
		}
		if req.TimeoutSec > exec.MaxTimeoutSeconds {
			http.Error(w, fmt.Sprintf("timeout exceeds limit: %d > %d", req.TimeoutSec, exec.MaxTimeoutSeconds), http.StatusBadRequest)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), time.Duration(req.TimeoutSec)*time.Second)
		defer cancel()

		result, err := exec.Execute(ctx, &executor.ExecuteRequest{
			Script:      req.Script,
			TimeoutSec:  req.TimeoutSec,
			Environment: req.Environment,
			WorkingDir:  req.WorkingDir,
			ExecutionID: req.ExecutionID,
		})

		if err != nil {
			http.Error(w, fmt.Sprintf("Execution error: %v", err), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(result)
	}
}
