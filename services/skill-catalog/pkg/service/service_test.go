package service_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/agent-platform/go-shared/pkg/models"
	"github.com/agent-platform/skill-catalog/pkg/service"
	"github.com/agent-platform/skill-catalog/pkg/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testTenant = "tenant-abc"

func baseSkill() *models.SkillManifest {
	return &models.SkillManifest{
		ID:          "skill-001",
		TenantID:    testTenant,
		Name:        "query-slow-logs",
		Version:     "1.2.0",
		Description: "Queries slow query logs from the database",
		Tools: []models.ToolRef{
			{Name: "query-db", Version: "1.0.0"},
		},
		SOP:         "1. Connect to DB. 2. Run SHOW SLOW QUERY LOG.",
		Mutating:    false,
		Status:      models.StatusDraft,
		PublishedBy: "platform-admin",
		CreatedAt:   time.Now(),
	}
}

func newHandler(t *testing.T) (http.Handler, *store.InMemoryStore) {
	t.Helper()
	s := store.NewInMemoryStore()
	h := service.NewHandler(s)
	return service.BuildMux(h), s
}

// POST /api/v1/skills

func TestCreateSkill_Returns201(t *testing.T) {
	mux, _ := newHandler(t)

	body, _ := json.Marshal(baseSkill())
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/skills", bytes.NewReader(body))
	req.Header.Set("X-Tenant-ID", testTenant)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
	var resp models.SkillManifest
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Equal(t, "skill-001", resp.ID)
	assert.Equal(t, models.StatusDraft, resp.Status)
}

func TestCreateSkill_MissingTenantHeader_Returns400(t *testing.T) {
	mux, _ := newHandler(t)

	body, _ := json.Marshal(baseSkill())
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/skills", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestCreateSkill_DuplicateNameVersion_Returns409(t *testing.T) {
	mux, s := newHandler(t)
	require.NoError(t, s.Create(nil, baseSkill()))

	duplicate := baseSkill()
	duplicate.ID = "skill-duplicate"
	body, _ := json.Marshal(duplicate)
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/skills", bytes.NewReader(body))
	req.Header.Set("X-Tenant-ID", "tenant-other")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusConflict, rr.Code)
}

// GET /api/v1/skills/{id}

func TestGetSkill_Returns200(t *testing.T) {
	mux, s := newHandler(t)
	require.NoError(t, s.Create(nil, baseSkill()))

	req, _ := http.NewRequest(http.MethodGet, "/api/v1/skills/skill-001", nil)
	req.Header.Set("X-Tenant-ID", testTenant)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp models.SkillManifest
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Equal(t, "query-slow-logs", resp.Name)
}

func TestGetSkill_NotFound_Returns404(t *testing.T) {
	mux, _ := newHandler(t)

	req, _ := http.NewRequest(http.MethodGet, "/api/v1/skills/does-not-exist", nil)
	req.Header.Set("X-Tenant-ID", testTenant)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusNotFound, rr.Code)
}

// GET /api/v1/skills

func TestListSkills_StatusFilter(t *testing.T) {
	mux, s := newHandler(t)

	draft := baseSkill()
	require.NoError(t, s.Create(nil, draft))

	active := baseSkill()
	active.ID = "skill-002"
	active.Name = "analyze-errors"
	active.Status = models.StatusActive
	require.NoError(t, s.Create(nil, active))

	req, _ := http.NewRequest(http.MethodGet, "/api/v1/skills?status=active", nil)
	req.Header.Set("X-Tenant-ID", testTenant)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp []*models.SkillManifest
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Len(t, resp, 1)
	assert.Equal(t, "skill-002", resp[0].ID)
}

func TestListSkills_AvailableIncludesSystemPublicAndTeamPrivate(t *testing.T) {
	mux, s := newHandler(t)

	system := baseSkill()
	system.ID = "system-skill"
	system.TenantID = "platform-system"
	system.Name = "system-skill"
	system.Scope = "system"
	system.Status = models.StatusActive
	require.NoError(t, s.Create(nil, system))

	public := baseSkill()
	public.ID = "public-skill"
	public.TenantID = "tenant-other"
	public.Name = "public-skill"
	public.Visibility = "public"
	public.Status = models.StatusActive
	require.NoError(t, s.Create(nil, public))

	teamPrivate := baseSkill()
	teamPrivate.ID = "team-private"
	teamPrivate.Name = "team-private"
	teamPrivate.TeamID = "team-a"
	teamPrivate.Status = models.StatusActive
	require.NoError(t, s.Create(nil, teamPrivate))

	otherTeamPrivate := baseSkill()
	otherTeamPrivate.ID = "other-team-private"
	otherTeamPrivate.Name = "other-team-private"
	otherTeamPrivate.TeamID = "team-b"
	otherTeamPrivate.Status = models.StatusActive
	require.NoError(t, s.Create(nil, otherTeamPrivate))

	req, _ := http.NewRequest(http.MethodGet, "/api/v1/skills?available=true&include_system=true&include_public=true&status=active", nil)
	req.Header.Set("X-Tenant-ID", testTenant)
	req.Header.Set("X-Team-ID", "team-a")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp []*models.SkillManifest
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Len(t, resp, 3)
}

func TestRenderSkill_ReturnsVirtualSkillMarkdown(t *testing.T) {
	mux, s := newHandler(t)
	require.NoError(t, s.Create(nil, baseSkill()))

	req, _ := http.NewRequest(http.MethodGet, "/api/v1/skills/skill-001/render", nil)
	req.Header.Set("X-Tenant-ID", testTenant)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp map[string]string
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Contains(t, resp["markdown"], "# query-slow-logs")
	assert.Contains(t, resp["markdown"], "Standard Operating Procedure")
}

// PUT /api/v1/skills/{id}

func TestUpdateSkill_Returns200(t *testing.T) {
	mux, s := newHandler(t)
	require.NoError(t, s.Create(nil, baseSkill()))

	updated := baseSkill()
	updated.SOP = "Updated SOP"
	body, _ := json.Marshal(updated)

	req, _ := http.NewRequest(http.MethodPut, "/api/v1/skills/skill-001", bytes.NewReader(body))
	req.Header.Set("X-Tenant-ID", testTenant)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp models.SkillManifest
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Equal(t, "Updated SOP", resp.SOP)
}

// POST /api/v1/skills/{id}/transition

func TestTransitionSkill_ValidTransition_Returns200(t *testing.T) {
	mux, s := newHandler(t)
	require.NoError(t, s.Create(nil, baseSkill())) // starts as Draft

	body, _ := json.Marshal(models.TransitionRequest{
		TargetState: "staged",
		Actor:       "platform-admin",
	})
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/skills/skill-001/transition", bytes.NewReader(body))
	req.Header.Set("X-Tenant-ID", testTenant)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	updated, _ := s.GetByID(nil, "skill-001", testTenant)
	assert.Equal(t, models.StatusStaged, updated.Status)
}

func TestTransitionSkill_InvalidTransition_Returns422(t *testing.T) {
	mux, s := newHandler(t)
	require.NoError(t, s.Create(nil, baseSkill())) // Draft

	body, _ := json.Marshal(models.TransitionRequest{
		TargetState: "active", // Draft → Active is not a valid edge
		Actor:       "platform-admin",
	})
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/skills/skill-001/transition", bytes.NewReader(body))
	req.Header.Set("X-Tenant-ID", testTenant)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnprocessableEntity, rr.Code)
}
