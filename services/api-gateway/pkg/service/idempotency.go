package service

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/agent-platform/go-shared/pkg/models"
	_ "github.com/lib/pq" // postgres driver
)

// IdempotencyStore deduplicates inbound trigger requests by idempotency key
// (NFR9). The contract is reserve-then-complete rather than a naive get/set,
// because a check-then-act sequence has a race: two concurrent requests with
// the same key both observe "absent" and both start a workflow.
//
//   Reserve atomically claims the key. Exactly one concurrent caller gets
//   claimed=true and is responsible for doing the work and then calling
//   Complete. Every other caller gets claimed=false plus the existing entry
//   (whose WorkflowID is empty while the first caller is still in-flight).
//
//   Release drops a reservation whose work failed, so a later retry can re-claim
//   the key instead of being permanently wedged behind a dead "pending" row.
type IdempotencyStore interface {
	Reserve(ctx context.Context, tenantID, key string) (existing *models.IdempotencyEntry, claimed bool, err error)
	Complete(ctx context.Context, tenantID, key, workflowID, runID string) error
	Release(ctx context.Context, tenantID, key string) error
}

// ── In-memory implementation ──────────────────────────────────────────────────

// inMemEntry is the stored value; the mutex guards the result fields so a reader
// in Reserve cannot race the writer in Complete.
type inMemEntry struct {
	mu        sync.RWMutex
	completed bool
	entry     models.IdempotencyEntry
}

// InMemoryIdempotencyStore is a thread-safe, sync.Map-backed fallback used when
// no Postgres URL is configured. It is per-replica only: it does NOT deduplicate
// across horizontally-scaled gateway instances. Use the Postgres store in any
// multi-replica deployment.
type InMemoryIdempotencyStore struct {
	m sync.Map // key string -> *inMemEntry
}

func NewInMemoryIdempotencyStore() *InMemoryIdempotencyStore {
	return &InMemoryIdempotencyStore{}
}

func memKey(tenantID, key string) string { return tenantID + "\x00" + key }

func (s *InMemoryIdempotencyStore) Reserve(_ context.Context, tenantID, key string) (*models.IdempotencyEntry, bool, error) {
	// LoadOrStore is the atomic claim: only the goroutine that actually stores
	// the new value gets loaded=false, i.e. wins the race.
	actual, loaded := s.m.LoadOrStore(memKey(tenantID, key), &inMemEntry{})
	if !loaded {
		return nil, true, nil
	}
	e := actual.(*inMemEntry)
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := e.entry // copy; zero-valued (empty WorkflowID) while still in-flight
	return &out, false, nil
}

func (s *InMemoryIdempotencyStore) Complete(_ context.Context, tenantID, key, workflowID, runID string) error {
	v, ok := s.m.Load(memKey(tenantID, key))
	if !ok {
		return fmt.Errorf("idempotency key not reserved: %s", key)
	}
	e := v.(*inMemEntry)
	e.mu.Lock()
	defer e.mu.Unlock()
	e.completed = true
	e.entry = models.IdempotencyEntry{WorkflowID: workflowID, RunID: runID, CreatedAt: time.Now()}
	return nil
}

func (s *InMemoryIdempotencyStore) Release(_ context.Context, tenantID, key string) error {
	s.m.Delete(memKey(tenantID, key))
	return nil
}

// ── Postgres implementation ───────────────────────────────────────────────────

// PostgresIdempotencyStore persists reservations so deduplication holds across
// gateway replicas and survives restarts.
type PostgresIdempotencyStore struct {
	db *sql.DB
}

func NewPostgresIdempotencyStore(db *sql.DB) *PostgresIdempotencyStore {
	return &PostgresIdempotencyStore{db: db}
}

// NewPostgresIdempotencyStoreFromEnv builds a Postgres-backed store from
// POSTGRES_URL. Returns (nil, nil) when POSTGRES_URL is unset so the caller can
// fall back to the in-memory store; returns an error if the URL is set but the
// database can't be reached.
func NewPostgresIdempotencyStoreFromEnv() (*PostgresIdempotencyStore, error) {
	dsn := os.Getenv("POSTGRES_URL")
	if dsn == "" {
		return nil, nil
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(3)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return &PostgresIdempotencyStore{db: db}, nil
}

func (s *PostgresIdempotencyStore) Reserve(ctx context.Context, tenantID, key string) (*models.IdempotencyEntry, bool, error) {
	// Atomic claim: INSERT ... ON CONFLICT DO NOTHING. RowsAffected == 1 means we
	// inserted the row (won the race); 0 means it already existed.
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO idempotency_keys (tenant_id, key) VALUES ($1, $2)
		 ON CONFLICT (tenant_id, key) DO NOTHING`,
		tenantID, key,
	)
	if err != nil {
		return nil, false, fmt.Errorf("reserve idempotency key: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 1 {
		return nil, true, nil
	}

	// Someone else already holds it — return what they've recorded so far.
	var e models.IdempotencyEntry
	err = s.db.QueryRowContext(ctx,
		`SELECT workflow_id, run_id, created_at FROM idempotency_keys
		 WHERE tenant_id = $1 AND key = $2`,
		tenantID, key,
	).Scan(&e.WorkflowID, &e.RunID, &e.CreatedAt)
	if err == sql.ErrNoRows {
		// Race: the holder released between our INSERT and SELECT. Treat as in-flight.
		return &models.IdempotencyEntry{}, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("load idempotency key: %w", err)
	}
	return &e, false, nil
}

func (s *PostgresIdempotencyStore) Complete(ctx context.Context, tenantID, key, workflowID, runID string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE idempotency_keys
		 SET workflow_id = $3, run_id = $4, status = 'completed'
		 WHERE tenant_id = $1 AND key = $2`,
		tenantID, key, workflowID, runID,
	)
	return err
}

func (s *PostgresIdempotencyStore) Release(ctx context.Context, tenantID, key string) error {
	// Only drop the reservation if it's still pending — never delete a completed
	// result that another request may already have returned to a client.
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM idempotency_keys
		 WHERE tenant_id = $1 AND key = $2 AND status = 'pending'`,
		tenantID, key,
	)
	return err
}
