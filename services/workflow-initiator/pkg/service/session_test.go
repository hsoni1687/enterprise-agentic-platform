package service

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agent-platform/go-shared/pkg/models"
	enumspb "go.temporal.io/api/enums/v1"
	commonpb "go.temporal.io/api/common/v1"
	executionpb "go.temporal.io/api/workflow/v1"
	workflowservice "go.temporal.io/api/workflowservice/v1"
	"go.temporal.io/sdk/client"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

// MockTemporalClient is a mock of the Temporal client.
type MockTemporalClient struct {
	mock.Mock
}

func (m *MockTemporalClient) ExecuteWorkflow(ctx context.Context, options client.StartWorkflowOptions, workflow interface{}, args ...interface{}) (client.WorkflowRun, error) {
	var arg interface{}
	if len(args) > 0 {
		arg = args[0]
	}
	callArgs := m.Called(ctx, options, workflow, arg)
	if run := callArgs.Get(0); run != nil {
		return run.(client.WorkflowRun), callArgs.Error(1)
	}
	return nil, callArgs.Error(1)
}

func (m *MockTemporalClient) DescribeWorkflowExecution(ctx context.Context, workflowID, runID string) (*workflowservice.DescribeWorkflowExecutionResponse, error) {
	callArgs := m.Called(ctx, workflowID, runID)
	if resp := callArgs.Get(0); resp != nil {
		return resp.(*workflowservice.DescribeWorkflowExecutionResponse), callArgs.Error(1)
	}
	return nil, callArgs.Error(1)
}

func (m *MockTemporalClient) QueryWorkflow(ctx context.Context, workflowID, runID, queryType string, args ...interface{}) (EncodedQueryValue, error) {
	callArgs := m.Called(ctx, workflowID, runID, queryType)
	if v := callArgs.Get(0); v != nil {
		return v.(EncodedQueryValue), callArgs.Error(1)
	}
	return nil, callArgs.Error(1)
}

func (m *MockTemporalClient) SignalWorkflow(ctx context.Context, workflowID, runID, signalName string, arg interface{}) error {
	return m.Called(ctx, workflowID, runID, signalName, arg).Error(0)
}

// MockWorkflowRun mocks the result of ExecuteWorkflow.
type MockWorkflowRun struct {
	mock.Mock
}

func (m *MockWorkflowRun) GetID() string { return m.Called().String(0) }
func (m *MockWorkflowRun) GetRunID() string { return m.Called().String(0) }
func (m *MockWorkflowRun) Get(ctx context.Context, valuePtr interface{}) error {
	return m.Called(ctx, valuePtr).Error(0)
}
func (m *MockWorkflowRun) GetWithOptions(ctx context.Context, valuePtr interface{}, opts client.WorkflowRunGetOptions) error {
	return m.Called(ctx, valuePtr, opts).Error(0)
}

func TestStartSession(t *testing.T) {
	mockClient := new(MockTemporalClient)
	mockRun := new(MockWorkflowRun)

	mockRun.On("GetID").Return("agent-wf-123")
	mockRun.On("GetRunID").Return("run-123")
	mockClient.On("ExecuteWorkflow", mock.Anything, mock.Anything, "AgentWorkflow", mock.Anything).Return(mockRun, nil)

	SetTemporalClient(mockClient)

	reqBody := models.StartSessionRequest{
		AgentID:   "agent-123",
		SessionID: "session-abc",
		TenantID:  "tenant-xyz",
	}
	body, _ := json.Marshal(reqBody)

	req, _ := http.NewRequest(http.MethodPost, "/api/v1/sessions", bytes.NewBuffer(body))
	rr := httptest.NewRecorder()

	http.HandlerFunc(HandleStartSession).ServeHTTP(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)

	var resp models.SessionStatus
	json.NewDecoder(rr.Body).Decode(&resp)
	assert.Equal(t, "RUNNING", resp.Status)
	assert.Equal(t, "agent-wf-123", resp.WorkflowID)

	mockClient.AssertExpectations(t)
}

func TestStartSession_UsesDefaultTaskQueue(t *testing.T) {
	mockClient := new(MockTemporalClient)
	mockRun := new(MockWorkflowRun)

	mockRun.On("GetID").Return("wf-abc")
	mockRun.On("GetRunID").Return("run-abc")

	var capturedOptions client.StartWorkflowOptions
	mockClient.On("ExecuteWorkflow", mock.Anything, mock.MatchedBy(func(opts client.StartWorkflowOptions) bool {
		capturedOptions = opts
		return true
	}), "AgentWorkflow", mock.Anything).Return(mockRun, nil)

	SetTemporalClient(mockClient)

	reqBody := models.StartSessionRequest{AgentID: "a1", SessionID: "s1", TenantID: "tenant-abc"}
	body, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/sessions", bytes.NewBuffer(body))
	rr := httptest.NewRecorder()

	http.HandlerFunc(HandleStartSession).ServeHTTP(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
	assert.Equal(t, "default-tenant-agent-queue", capturedOptions.TaskQueue)
}

func TestGetSessionStatus_Running(t *testing.T) {
	mockClient := new(MockTemporalClient)

	descResp := &workflowservice.DescribeWorkflowExecutionResponse{
		WorkflowExecutionInfo: &executionpb.WorkflowExecutionInfo{
			Execution: &commonpb.WorkflowExecution{WorkflowId: "wf-xyz", RunId: "run-xyz"},
			Status:    enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING,
		},
	}
	mockClient.On("DescribeWorkflowExecution", mock.Anything, "wf-xyz", "").Return(descResp, nil)

	SetTemporalClient(mockClient)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/sessions/{id}", HandleGetSessionStatus)

	req, _ := http.NewRequest(http.MethodGet, "/api/v1/sessions/wf-xyz", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	var resp models.SessionStatus
	json.NewDecoder(rr.Body).Decode(&resp)
	assert.Equal(t, "RUNNING", resp.Status)
	assert.Equal(t, "wf-xyz", resp.WorkflowID)
}

func TestGetSessionStatus_Completed(t *testing.T) {
	mockClient := new(MockTemporalClient)

	descResp := &workflowservice.DescribeWorkflowExecutionResponse{
		WorkflowExecutionInfo: &executionpb.WorkflowExecutionInfo{
			Execution: &commonpb.WorkflowExecution{WorkflowId: "wf-done"},
			Status:    enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED,
		},
	}
	mockClient.On("DescribeWorkflowExecution", mock.Anything, "wf-done", "").Return(descResp, nil)

	SetTemporalClient(mockClient)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/sessions/{id}", HandleGetSessionStatus)

	req, _ := http.NewRequest(http.MethodGet, "/api/v1/sessions/wf-done", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	var resp models.SessionStatus
	json.NewDecoder(rr.Body).Decode(&resp)
	assert.Equal(t, "COMPLETED", resp.Status)
}
