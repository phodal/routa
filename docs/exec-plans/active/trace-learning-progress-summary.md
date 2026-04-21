# Trace Learning Implementation - Progress Summary

## Completed Work

### Phase 1: Normalized Trace Ledger Schema ✅

**Files Created:**
- `src/core/trace-learning/types.ts` - RunOutcome schema with task fingerprints
- `src/core/trace-learning/writer.ts` - JSONL append-only writer
- `src/core/trace-learning/index.ts` - Module exports
- `src/core/trace-learning/__tests__/writer.test.ts` - Comprehensive test suite (14 tests)
- `docs/exec-plans/active/trace-learning-general-implementation.md` - Full implementation plan

**Key Features:**
1. **RunOutcome Type** - Normalized session outcome with:
   - Task type classification (kanban_card, harness_evolution, review_flow, general_session)
   - Card fingerprint for Kanban pattern detection
   - Evidence bundle (tests, lint, build, review status)
   - Tool sequence and changed files
   - Lane transitions and bounce patterns
   - Failure modes and recovery actions

2. **RunOutcomeWriter** - Storage in `docs/fitness/trace-learning/outcomes.jsonl`:
   - Append-only JSONL format
   - Type and status filtering
   - Safe error handling

3. **Builder Pattern** - Fluent API for outcome construction:
   - `withCardFingerprint()`, `withRepoContext()`
   - `withChangedFiles()`, `withToolSequence()`
   - `withEvidence()`, `withFailureMode()`
   - `withBouncePattern()`, `withDuration()`

**Test Coverage:**
- ✅ 14 tests passing
- ✅ All TypeScript lint checks pass
- ✅ All TypeScript type checks pass
- ✅ Full test suite passes (vitest)

**Storage Location:**
```
docs/fitness/trace-learning/outcomes.jsonl  (new)
```

## Next Steps

### Phase 2: Recording Hooks (In Progress)

**Remaining Tasks:**
1. Add outcome recording in Kanban lane completion (`src/core/kanban/workflow-orchestrator.ts`)
2. Add outcome recording in session cleanup (`src/core/session/session-manager.ts`)
3. Add outcome recording in review flows (`src/core/review/review-workflow.ts`)
4. Extract evidence from trace records (tests, lint, build results)

### Phase 3: Pattern Detection & Learning Pipeline

**Plan:**
1. Create `crates/trace-learning/` Rust crate
2. Generalize harness learning algorithm for all task types
3. CLI command: `routa trace learn --task-type <type>`
4. Generate playbooks in `docs/fitness/playbooks/<task-type>/`

### Phase 4: Runtime Playbook Loading

**Plan:**
1. Create `PlaybookLoader` service
2. Session start hook for preflight guidance
3. UI display of loaded playbooks with provenance

### Phase 5: Kanban Flow Learning (Issue #466)

**Plan:**
1. Analyze lane transition patterns
2. Detect bounce/loop patterns
3. Generate flow-specific playbooks

### Phase 6: Anti-pattern Library

**Plan:**
1. Failure pattern detection
2. Anti-pattern storage
3. Runtime warnings before risky actions

## Architecture Notes

The implementation follows Routa's architecture principles:
- **Workspace-first**: All outcomes scoped to workspace
- **Dual-backend ready**: TypeScript foundation, Rust learning pipeline to follow
- **Storage convention**: Learning data in `docs/fitness/` for version control
- **Test-first**: Comprehensive test coverage before integration

## Known Issues

- Rust clippy failures in CI due to missing GTK/Tauri system dependencies (unrelated to this PR)
- Desktop app frontend glob pattern issue (pre-existing, unrelated to this PR)

All TypeScript changes are clean and tested.

## Related Issues

- #294 - Parent issue: Trace learning for self-improving agents
- #344 - GATE-first trace state digest (completed)
- #466 - Kanban flow learning (planned for Phase 5)
- #478 - Generic session analysis foundation (completed)
