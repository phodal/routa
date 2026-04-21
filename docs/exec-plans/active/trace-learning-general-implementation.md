# Trace Learning - General Implementation Plan

**Status**: Active
**Created**: 2026-04-21
**Related Issues**: #294 (parent), #344 (GATE-first digest), #466 (Kanban flow learning)

## Context

Issue #294 requests a comprehensive **Trace Learning** capability that turns successful and failed runs into learned playbooks, preflight guidance, and executable gates. This is the general implementation plan that extends beyond the existing harness evolution trace learning.

### What Already Exists

1. **Harness Evolution Trace Learning (Phase 1 ✅)**
   - `docs/fitness/evolution/history.jsonl` - JSONL append-only history
   - `docs/fitness/playbooks/*.json` - Generated playbook storage
   - `crates/routa-cli/src/commands/harness/engineering/learning.rs` - Pattern detection
   - Learning pipeline: history → pattern detection → playbook generation
   - CLI commands: `routa harness evolve --learn`

2. **Generic Session Normalization (✅)**
   - `crates/trace-parser/` - Provider-agnostic transcript parsing
   - `crates/feature-trace/` - Feature surface attribution
   - `NormalizedSession`, provider adapters, `AdapterRegistry`
   - Codex transcript parsing via `CodexSessionAdapter`

3. **Trace Run Digest (#344 ✅)**
   - `src/core/trace/trace-run-digest.ts` - Single-run state digest
   - File operations, tool usage, verification signals, churn markers
   - Used for specialist prompt injection (GATE, CRAFTER)

4. **Trace Storage Infrastructure**
   - `src/core/trace/writer.ts` & `reader.ts` - TypeScript trace I/O
   - `crates/routa-core/src/trace/` - Rust trace storage
   - `src/core/storage/local-trace-provider.ts` & `remote-trace-provider.ts`
   - JSONL-based persistence with session-scoped records

### What's Missing for General Trace Learning

1. **Normalized Trace Ledger for All Task Types**
   - Current: Only harness evolution writes to structured history
   - Need: Kanban tasks, general sessions, review flows write normalized outcomes

2. **Task-Type-Aware Learning Pipeline**
   - Current: Learning is hardcoded for `harness_evolution` task type
   - Need: Support for task types like `kanban_card`, `review_flow`, `general_session`

3. **Runtime Playbook Loading Beyond Harness**
   - Current: Playbook loading only in harness evolve command
   - Need: Session start hooks that inject playbooks for any task type

4. **Kanban Flow Pattern Analysis**
   - Current: Lane history exists but not analyzed for learning
   - Need: Lane bounce patterns, review loops, common failures → playbooks

5. **Anti-pattern Library & Failure Learning**
   - Current: Only successful runs generate playbooks
   - Need: Failure pattern detection and anti-pattern storage

6. **Guardrail Promotion (Future)**
   - Current: Playbooks are guidance only
   - Need: High-confidence playbooks → executable fitness rules

## Implementation Phases

### Phase 1: Normalized Trace Ledger Schema

**Goal**: Extend existing trace infrastructure to record normalized run outcomes for all task types.

**Tasks**:
1. Define `RunOutcome` schema that extends `TraceRecord`:
   ```typescript
   interface RunOutcome {
     sessionId: string;
     taskType: 'kanban_card' | 'harness_evolution' | 'review_flow' | 'general_session';
     workspaceId: string;
     cardFingerprint?: {
       boardId?: string;
       columnId?: string;
       taskId?: string;
       labels?: string[];
     };
     changedFiles: string[];
     toolSequence: string[];
     evidenceBundle: {
       testsRan: boolean;
       testsPassed: boolean;
       lintPassed: boolean;
       buildSucceeded: boolean;
       reviewApproved?: boolean;
     };
     outcome: 'success' | 'failure' | 'partial' | 'cancelled';
     failureMode?: string;
     recoveryActions?: string[];
     timestamp: string;
     duration?: number;
   }
   ```

2. Add trace writer method `recordRunOutcome(outcome: RunOutcome)` in:
   - `src/core/trace/writer.ts`
   - `crates/routa-core/src/trace/writer.rs`

3. Create `docs/fitness/trace-learning/outcomes.jsonl` as append-only ledger

**Acceptance**:
- [x] Schema defined in TypeScript and Rust
- [ ] Writer methods implemented in both runtimes
- [ ] Test writes to `outcomes.jsonl` from a sample session

### Phase 2: Task-Type-Aware Recording Hooks

**Goal**: Integrate run outcome recording into existing session completion flows.

**Integration Points**:
1. **Kanban Lane Completion** (`src/core/kanban/workflow-orchestrator.ts`):
   - On lane session completion, extract outcome from `TaskLaneSession`
   - Record with `taskType: 'kanban_card'` and card fingerprint

2. **Session End** (`src/core/session/session-manager.ts`):
   - Hook into session cleanup/finalization
   - For non-Kanban sessions, use `taskType: 'general_session'`

3. **Review Flow** (`src/core/review/review-workflow.ts`):
   - Record outcome when review reaches final verdict
   - Include findings, severity, approval status

**Acceptance**:
- [ ] Kanban lane completions write outcomes
- [ ] General sessions write outcomes on cleanup
- [ ] Review flows write outcomes with verdict info
- [ ] No duplicate outcome records for same session

### Phase 3: Pattern Detection & Learning Pipeline

**Goal**: Reuse harness learning algorithm for all task types.

**Tasks**:
1. Extract task-type-agnostic learning functions:
   - Move from `harness/engineering/learning.rs` to new `crates/trace-learning/`
   - Generalize `detect_common_patterns` to work with `RunOutcome` schema
   - Support multiple fingerprint types (gap patterns, card columns, file patterns)

2. Create CLI command: `routa trace learn --task-type <type>`
   - Load from `outcomes.jsonl` instead of `evolution/history.jsonl`
   - Filter by task type
   - Generate playbooks in `docs/fitness/playbooks/<task-type>/`

3. Add learning triggers:
   - Manual: `routa trace learn --task-type kanban_card`
   - Scheduled: Background job after N new outcomes
   - On-demand: Via API endpoint for workspace admins

**Acceptance**:
- [ ] `crates/trace-learning/` crate exists with generalized learning
- [ ] CLI command generates playbooks for any task type
- [ ] Minimum 3 successful runs with same pattern required
- [ ] Confidence scores and provenance tracked

### Phase 4: Runtime Playbook Loading & Injection

**Goal**: Load relevant playbooks at session start and inject as preflight guidance.

**Tasks**:
1. Create `PlaybookLoader` service:
   ```typescript
   interface PlaybookLoader {
     loadForTask(taskType: string, fingerprint: object): Playbook | null;
     findMatching(playbooks: Playbook[], currentContext: object): Playbook | null;
   }
   ```

2. Add session start hook in `src/core/session/session-manager.ts`:
   - Extract task fingerprint (card ID, column, labels, etc.)
   - Load matching playbooks
   - Inject into session context as `additionalContext`

3. Display in UI:
   - Session detail page shows loaded playbook
   - Card automation UI shows preflight guidance
   - Include provenance: "Based on 3 similar runs (95% success rate)"

**Acceptance**:
- [ ] Playbooks loaded automatically at session start
- [ ] Fuzzy matching works (50% overlap threshold)
- [ ] Preflight guidance visible in session UI
- [ ] Source runs/evidence shown for transparency

### Phase 5: Kanban Flow Learning (Issue #466)

**Goal**: Learn from lane transition patterns and common failure modes.

**Tasks**:
1. Extend outcome schema with Kanban-specific fields:
   - `laneTransitions: Array<{from: string, to: string, reason?: string}>`
   - `loopDetected: boolean`
   - `bouncePattern: string[]` (e.g., `['dev', 'review', 'dev', 'review']`)

2. Create flow pattern analyzer:
   - Detect common bounce patterns (dev ↔ review, backlog ↔ todo)
   - Identify systemic vs. isolated failures
   - Group by root cause category

3. Generate flow-specific playbooks:
   - "Cards with label X often bounce between dev and review"
   - "Review failures commonly due to missing tests"
   - "Column Y has 80% success with these verification commands"

**Acceptance**:
- [ ] Lane transition history analyzed for patterns
- [ ] Bounce/loop patterns detected and categorized
- [ ] Flow-specific playbooks generated
- [ ] Playbooks injected into lane automation preflight

### Phase 6: Anti-pattern Library & Failure Learning

**Goal**: Learn from failures, not just successes.

**Tasks**:
1. Add failure pattern detection to learning pipeline:
   - Cluster failed runs by failure mode
   - Extract common anti-patterns (e.g., "edited generated file directly")
   - Require minimum occurrence threshold (3+)

2. Store anti-patterns separately:
   - `docs/fitness/anti-patterns/<task-type>/*.json`
   - Include: what NOT to do, why it fails, evidence

3. Runtime anti-pattern checking:
   - Before session starts, check for anti-pattern risk
   - Warn agent: "Similar runs failed when X was done before Y"
   - Display in UI as yellow warning banner

**Acceptance**:
- [ ] Failed runs generate anti-pattern candidates
- [ ] Anti-patterns stored with provenance
- [ ] Runtime checks warn before risky patterns
- [ ] UI displays anti-pattern warnings

## Storage Layout

```
docs/fitness/
├── trace-learning/
│   └── outcomes.jsonl              # Normalized run outcomes (all task types)
├── playbooks/
│   ├── harness_evolution/          # Existing harness playbooks
│   ├── kanban_card/                # Kanban-specific playbooks
│   │   ├── review-loop-pattern.json
│   │   └── test-failure-recovery.json
│   ├── general_session/            # General session playbooks
│   └── review_flow/                # Review-specific playbooks
└── anti-patterns/
    ├── kanban_card/
    │   └── direct-edit-of-generated-file.json
    └── general_session/
```

## Acceptance Criteria (from Issue #294)

- [ ] A run can emit a normalized trace document with card fingerprint + evidence + outcome
- [ ] Similar runs can be clustered into a task pattern and produce a reviewable playbook candidate
- [ ] The planner can retrieve playbooks before execution and surface them in UI / logs
- [ ] At least one playbook can be promoted into an executable fitness rule (Phase 7, future)
- [ ] Users can inspect provenance for each learned playbook

## Testing Strategy

### Unit Tests
- Outcome recording logic (writer, schema validation)
- Pattern detection algorithms (clustering, confidence scoring)
- Playbook matching (exact and fuzzy)
- Anti-pattern detection

### Integration Tests
- End-to-end: run task → record outcome → generate playbook → load at next run
- Kanban flow: card transitions → lane history → flow playbook
- Cross-task-type: ensure learning pipelines don't interfere

### Manual Validation
1. Run 3+ similar Kanban cards
2. Generate playbooks with CLI
3. Start new card, verify playbook loads
4. Check UI displays guidance and provenance

## Migration Notes

- Existing harness evolution history remains in `docs/fitness/evolution/history.jsonl`
- New general outcomes go to `docs/fitness/trace-learning/outcomes.jsonl`
- Harness learning can optionally migrate to new system in future
- No breaking changes to existing trace APIs

## Related Files

- `docs/features/harness-trace-learning.md` - Existing harness learning doc
- `docs/references/harness-trace-learning-technical.md` - Technical reference
- `docs/design-docs/harness-trace-learning-phase2.md` - Runtime integration design
- `docs/issues/2026-04-16-global-kanban-flow-learning-via-agent-specialist.md` - Issue #466
- `docs/issues/2026-04-17-generic-trace-learning-session-analysis-foundation.md` - Issue #478

## Implementation Order

1. Phase 1: Normalized schema and writers (current priority)
2. Phase 2: Recording hooks in Kanban/session flows
3. Phase 3: Learning pipeline generalization
4. Phase 4: Runtime loading and injection
5. Phase 5: Kanban-specific flow analysis
6. Phase 6: Anti-pattern library

**Total Estimate**: 3-4 weeks of focused development

## Open Questions

1. Should playbooks be workspace-scoped or global?
   - **Recommendation**: Start with workspace-scoped, add cross-workspace sharing later

2. How to handle playbook versioning/staleness?
   - **Recommendation**: Add `validUntil` timestamp, regenerate monthly

3. Should learning be automatic or manual?
   - **Recommendation**: Manual via CLI initially, add auto-trigger after validation

4. How to handle playbook conflicts (multiple matches)?
   - **Recommendation**: Use weighted scoring (overlap × confidence), pick highest

5. Privacy concerns with evidence/provenance?
   - **Recommendation**: Strip sensitive file paths/content, keep structure only
