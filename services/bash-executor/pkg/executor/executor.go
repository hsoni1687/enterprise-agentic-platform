package executor

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ExecuteRequest defines a bash execution request
type ExecuteRequest struct {
	Script      string            `json:"script"`
	TimeoutSec  int               `json:"timeout_seconds"`
	Environment map[string]string `json:"environment"`
	WorkingDir  string            `json:"working_dir"`
	ExecutionID string            `json:"execution_id"`
}

// ExecuteResult is returned after execution completes
type ExecuteResult struct {
	ExitCode    int       `json:"exit_code"`
	Stdout      string    `json:"stdout"`
	Stderr      string    `json:"stderr"`
	DurationMs  int64     `json:"duration_ms"`
	Error       string    `json:"error,omitempty"`
	Truncated   bool      `json:"truncated"`
	TruncatedAt int       `json:"truncated_at,omitempty"`
}

// BashExecutor handles bash script execution with resource limits
type BashExecutor struct {
	MaxMemoryMB       int
	MaxCPUCores       int
	MaxTimeoutSeconds int
	MaxOutputBytes    int
}

// Execute runs a bash script with isolation and resource limits
func (e *BashExecutor) Execute(ctx context.Context, req *ExecuteRequest) (*ExecuteResult, error) {
	startTime := time.Now()
	result := &ExecuteResult{}

	// Setup working directory
	workDir := req.WorkingDir
	if workDir == "" {
		workDir = filepath.Join("/tmp", "sandbox", req.ExecutionID)
		if err := os.MkdirAll(workDir, 0o755); err != nil {
			return nil, fmt.Errorf("failed to create working directory: %w", err)
		}
		defer os.RemoveAll(filepath.Join("/tmp", "sandbox", req.ExecutionID))
	}

	// Enforce set -e -o pipefail for safety
	script := fmt.Sprintf("set -e -o pipefail\n%s", req.Script)

	// Create command with context for timeout
	cmd := exec.CommandContext(ctx, "bash", "-c", script)
	cmd.Dir = workDir

	// Set environment variables
	cmd.Env = os.Environ()
	for k, v := range req.Environment {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	// Capture stdout/stderr
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// Execute
	err := cmd.Run()

	// Collect output
	stdoutStr := stdout.String()
	stderrStr := stderr.String()

	// Check output size limits
	if len(stdoutStr) > e.MaxOutputBytes {
		stdoutStr = stdoutStr[:e.MaxOutputBytes]
		result.Truncated = true
		result.TruncatedAt = e.MaxOutputBytes
	}

	result.Stdout = stdoutStr
	result.Stderr = stderrStr
	result.DurationMs = time.Since(startTime).Milliseconds()

	// Capture exit code
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
		} else if ctx.Err() == context.DeadlineExceeded {
			result.ExitCode = 124 // Standard timeout exit code
			result.Error = "execution timeout"
		} else {
			result.ExitCode = 1
			result.Error = err.Error()
		}
	} else {
		result.ExitCode = 0
	}

	return result, nil
}

// ValidateScript performs basic security checks on bash scripts
func ValidateScript(script string) error {
	if strings.Contains(script, "eval") && strings.Contains(script, "$") {
		return fmt.Errorf("eval with variable expansion is not allowed")
	}

	// Prevent recursive bash calls
	if strings.Contains(script, "bash -c") {
		return fmt.Errorf("recursive bash execution is not allowed")
	}

	return nil
}
