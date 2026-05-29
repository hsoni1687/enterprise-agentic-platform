package service

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
)

// TestInMemoryReserveIsAtomic fires many concurrent Reserve calls for the same
// key and asserts that exactly one wins the claim. This is the property the old
// check-then-set Get/Set pair failed to guarantee.
func TestInMemoryReserveIsAtomic(t *testing.T) {
	store := NewInMemoryIdempotencyStore()
	ctx := context.Background()

	const goroutines = 100
	var claimed int32
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			if _, won, err := store.Reserve(ctx, "tenant-a", "dup-key"); err == nil && won {
				atomic.AddInt32(&claimed, 1)
			}
		}()
	}
	wg.Wait()

	if claimed != 1 {
		t.Fatalf("expected exactly 1 winning claim, got %d", claimed)
	}
}

// TestInMemoryCompleteReplays verifies that after the winner completes, a
// duplicate request sees the recorded result instead of being told it's pending.
func TestInMemoryCompleteReplays(t *testing.T) {
	store := NewInMemoryIdempotencyStore()
	ctx := context.Background()

	if _, won, _ := store.Reserve(ctx, "t1", "k1"); !won {
		t.Fatal("first reserve should win the claim")
	}
	if err := store.Complete(ctx, "t1", "k1", "wf-123", "run-123"); err != nil {
		t.Fatalf("complete: %v", err)
	}

	existing, won, _ := store.Reserve(ctx, "t1", "k1")
	if won {
		t.Fatal("second reserve must not win after completion")
	}
	if existing == nil || existing.WorkflowID != "wf-123" {
		t.Fatalf("expected replayed workflow id wf-123, got %+v", existing)
	}
}

// TestReleaseAllowsReclaim verifies a failed reservation can be re-claimed.
func TestReleaseAllowsReclaim(t *testing.T) {
	store := NewInMemoryIdempotencyStore()
	ctx := context.Background()

	if _, won, _ := store.Reserve(ctx, "t1", "k1"); !won {
		t.Fatal("first reserve should win")
	}
	if err := store.Release(ctx, "t1", "k1"); err != nil {
		t.Fatalf("release: %v", err)
	}
	if _, won, _ := store.Reserve(ctx, "t1", "k1"); !won {
		t.Fatal("after release, the key should be re-claimable")
	}
}

// TestTenantScoping verifies the same key is independent across tenants.
func TestTenantScoping(t *testing.T) {
	store := NewInMemoryIdempotencyStore()
	ctx := context.Background()

	if _, won, _ := store.Reserve(ctx, "tenant-a", "shared-key"); !won {
		t.Fatal("tenant-a should win its own key")
	}
	if _, won, _ := store.Reserve(ctx, "tenant-b", "shared-key"); !won {
		t.Fatal("tenant-b must independently win the same key string")
	}
}
