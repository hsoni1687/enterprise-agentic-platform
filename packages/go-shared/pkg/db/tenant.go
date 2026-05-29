// Package db holds shared database helpers for the platform's Go services.
//
// The central helper here, WithTenant, is the mechanism that activates
// PostgreSQL row-level security (RLS). RLS policies on tenant-scoped tables are
// keyed on current_setting('app.tenant_id'); unless that setting is populated
// on the connection running the query, the policies match nothing (fail-closed)
// — or, for a superuser connection, are bypassed entirely. WithTenant sets it
// correctly and safely for the duration of a single transaction.
package db

import (
	"context"
	"database/sql"
	"errors"
)

// ErrNoTenant is returned when a tenant-scoped operation is attempted without a
// tenant id. Callers should treat this as a programming error: every query that
// touches a tenant-scoped table must carry a tenant.
var ErrNoTenant = errors.New("tenant id required for tenant-scoped query")

// WithTenant runs fn inside a transaction that has the Postgres session variable
// app.tenant_id set (transaction-local) to tenantID, so that RLS policies keyed
// on current_setting('app.tenant_id') are evaluated against the right tenant.
//
// Why a transaction with SET LOCAL (rather than a plain SET on a pooled conn):
// database/sql hands out connections from a shared pool and does NOT reset
// session state when a connection is returned. A session-level SET would leak
// the tenant id to whichever caller next reuses that connection — a cross-tenant
// data-leak waiting to happen. set_config(..., is_local => true) is exactly
// SET LOCAL: it is scoped to this transaction and automatically cleared on
// commit or rollback, so leakage is structurally impossible.
//
// fn must perform all of its reads and writes via the provided *sql.Tx. Any rows
// it opens must be fully consumed before fn returns, because the transaction
// commits (closing them) as soon as fn does.
func WithTenant(ctx context.Context, database *sql.DB, tenantID string, fn func(tx *sql.Tx) error) error {
	if tenantID == "" {
		return ErrNoTenant
	}

	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	// Safe to call after Commit too: it returns sql.ErrTxDone, which we ignore.
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, "SELECT set_config('app.tenant_id', $1, true)", tenantID); err != nil {
		return err
	}

	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}
