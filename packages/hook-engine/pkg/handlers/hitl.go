package handlers

import (
	"context"
	"fmt"

	"github.com/agent-platform/hook-engine/pkg/hooks"
)

// NewHITLInterceptHandler returns a hook Handler that halts execution when the
// invoked skill is in the mutatingSkills set. Phase 3 wires the halt result to a
// Temporal workflow suspension signal.
func NewHITLInterceptHandler(mutatingSkills map[string]bool) hooks.Handler {
	return func(ctx context.Context, hctx hooks.HookContext) (hooks.HookResult, error) {
		// Check static skill map (for skills)
		if mutatingSkills[hctx.SkillName] {
			return hooks.HookResult{
				Halt:    true,
				Message: fmt.Sprintf("skill %q is mutating — HITL approval required", hctx.SkillName),
			}, nil
		}
		// Check __mutating flag in args (for direct tool invocations)
		if m, ok := hctx.Args["__mutating"].(bool); ok && m {
			return hooks.HookResult{
				Halt:    true,
				Message: fmt.Sprintf("tool %q is mutating — HITL approval required", hctx.SkillName),
			}, nil
		}
		return hooks.HookResult{}, nil
	}
}
