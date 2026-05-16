package dispatch_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agent-platform/go-shared/pkg/models"
	"github.com/agent-platform/hook-engine/pkg/hooks"
	"github.com/agent-platform/skill-dispatcher/pkg/dispatch"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- fixtures ---

func readSkill() *models.SkillManifest {
	return &models.SkillManifest{
		ID:               "skill-001",
		TenantID:         "tenant-x",
		Name:             "query-logs",
		Version:          "1.0.0",
		SOP:              "Query slow logs within the given time window.",
		Tools:            []models.ToolRef{{Name: "query_slow_logs", Version: "1.2.0"}},
		Mutating:         false,
		ApprovalRequired: false,
		Status:           models.StatusActive,
	}
}

func mutatingSkill() *models.SkillManifest {
	s := readSkill()
	s.Name = "restart-pod"
	s.Mutating = true
	s.ApprovalRequired = true
	s.Tools = []models.ToolRef{{Name: "restart_k8s_pod", Version: "2.0.0"}}
	return s
}

func newDispatcher(t *testing.T, skills ...*models.SkillManifest) (*dispatch.Dispatcher, *dispatch.InMemoryCatalog, *dispatch.MockToolRouter) {
	t.Helper()
	catalog := dispatch.NewInMemoryCatalog()
	for _, s := range skills {
		catalog.Register(s)
	}
	router := dispatch.NewMockToolRouter("tool-output-ok")
	engine := hooks.New()
	workflows := dispatch.NewMockWorkflowStarter("agent-result")
	d := dispatch.New(catalog, engine, router, workflows)
	return d, catalog, router
}

func invoke(t *testing.T, d *dispatch.Dispatcher, skillName, tenantID string, args map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	req := dispatch.InvokeRequest{
		Version:  "1.0.0",
		Args:     args,
		AgentID:  "agent-001",
		TenantID: tenantID,
		TraceID:  "trace-abc",
	}
	body, _ := json.Marshal(req)
	r, _ := http.NewRequest(http.MethodPost, "/api/v1/skills/"+skillName+"/invoke", bytes.NewReader(body))
	r.Header.Set("X-Tenant-ID", tenantID)

	mux := dispatch.BuildMux(d)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, r)
	return rr
}

func invokeByID(t *testing.T, d *dispatch.Dispatcher, skillID, tenantID string, args map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	req := dispatch.InvokeRequest{
		SkillID: skillID,
		Version: "1.0.0",
		Args:    args,
		AgentID: "agent-001",
		TraceID: "trace-abc",
	}
	body, _ := json.Marshal(req)
	r, _ := http.NewRequest(http.MethodPost, "/api/v1/skills/legacy-name/invoke", bytes.NewReader(body))
	r.Header.Set("X-Tenant-ID", tenantID)

	mux := dispatch.BuildMux(d)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, r)
	return rr
}

// --- tests ---

func TestInvokeSkill_HappyPath_ReturnsCompleted(t *testing.T) {
	d, _, _ := newDispatcher(t, readSkill())

	rr := invoke(t, d, "query-logs", "tenant-x", map[string]any{"window": "1h"})

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp dispatch.InvokeResponse
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Equal(t, dispatch.StatusCompleted, resp.Status)
	assert.Equal(t, "tool-output-ok", resp.Result)
}

func TestInvokeSkill_PrefersSkillID(t *testing.T) {
	d, _, _ := newDispatcher(t, readSkill())

	rr := invokeByID(t, d, "skill-001", "tenant-x", map[string]any{"window": "1h"})

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp dispatch.InvokeResponse
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Equal(t, dispatch.StatusCompleted, resp.Status)
}

func TestInvokeSkill_UnknownSkill_Returns404(t *testing.T) {
	d, _, _ := newDispatcher(t) // no skills registered

	rr := invoke(t, d, "no-such-skill", "tenant-x", nil)
	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestInvokeSkill_WrongTenant_Returns404(t *testing.T) {
	d, _, _ := newDispatcher(t, readSkill()) // skill is for "tenant-x"

	rr := invoke(t, d, "query-logs", "tenant-other", nil)
	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestInvokeSkill_MutatingSkill_HITLHalt_Returns202(t *testing.T) {
	// Register a HITL pre-hook that always halts mutating skills.
	engine := hooks.New()
	engine.Register(hooks.HookRegistration{
		SkillName: "*",
		Phase:     hooks.PhasePre,
		Type:      hooks.HookTypeHITLIntercept,
		Priority:  0,
		Handler: func(_ context.Context, hctx hooks.HookContext) (hooks.HookResult, error) {
			if skill, ok := hctx.Args["__mutating"].(bool); ok && skill {
				return hooks.HookResult{Halt: true, Message: "approval required"}, nil
			}
			return hooks.HookResult{}, nil
		},
	})
	catalog := dispatch.NewInMemoryCatalog()
	catalog.Register(mutatingSkill())
	router := dispatch.NewMockToolRouter("ok")
	workflows := dispatch.NewMockWorkflowStarter("ok")
	d2 := dispatch.New(catalog, engine, router, workflows)

	rr := invoke(t, d2, "restart-pod", "tenant-x", map[string]any{"pod": "my-pod"})
	assert.Equal(t, http.StatusAccepted, rr.Code)

	var resp dispatch.InvokeResponse
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Equal(t, dispatch.StatusAwaitingHITL, resp.Status)
}

func TestInvokeSkill_PreHookError_ToolStillExecutes(t *testing.T) {
	engine := hooks.New()
	engine.Register(hooks.HookRegistration{
		SkillName: "*",
		Phase:     hooks.PhasePre,
		Type:      hooks.HookTypeAuditLog,
		Priority:  0,
		Handler: func(_ context.Context, _ hooks.HookContext) (hooks.HookResult, error) {
			return hooks.HookResult{}, assert.AnError // audit log backend unavailable
		},
	})
	catalog := dispatch.NewInMemoryCatalog()
	catalog.Register(readSkill())
	router := dispatch.NewMockToolRouter("result-despite-hook-error")
	workflows := dispatch.NewMockWorkflowStarter("ok")
	d := dispatch.New(catalog, engine, router, workflows)

	rr := invoke(t, d, "query-logs", "tenant-x", nil)
	// Non-halting hook error must not block execution.
	assert.Equal(t, http.StatusOK, rr.Code)
	var resp dispatch.InvokeResponse
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Equal(t, "result-despite-hook-error", resp.Result)
}

func TestInvokeSkill_PostHookFires(t *testing.T) {
	postFired := false
	engine := hooks.New()
	engine.Register(hooks.HookRegistration{
		SkillName: "*",
		Phase:     hooks.PhasePost,
		Type:      hooks.HookTypeAuditLog,
		Priority:  0,
		Handler: func(_ context.Context, _ hooks.HookContext) (hooks.HookResult, error) {
			postFired = true
			return hooks.HookResult{}, nil
		},
	})
	catalog := dispatch.NewInMemoryCatalog()
	catalog.Register(readSkill())
	router := dispatch.NewMockToolRouter("post-hook-result")
	workflows := dispatch.NewMockWorkflowStarter("ok")
	d := dispatch.New(catalog, engine, router, workflows)

	rr := invoke(t, d, "query-logs", "tenant-x", nil)
	assert.Equal(t, http.StatusOK, rr.Code)
	assert.True(t, postFired, "post-hook must fire after successful tool execution")
}

func TestInvokeSkill_MissingTenantHeader_Returns400(t *testing.T) {
	d, _, _ := newDispatcher(t, readSkill())

	body, _ := json.Marshal(dispatch.InvokeRequest{Version: "1.0.0"})
	r, _ := http.NewRequest(http.MethodPost, "/api/v1/skills/query-logs/invoke", bytes.NewReader(body))
	// No X-Tenant-ID header

	mux := dispatch.BuildMux(d)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, r)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}
