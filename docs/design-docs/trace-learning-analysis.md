# Trace Learning Analysis: Routa's Existing Infrastructure

**Status**: Analysis  
**Created**: 2026-04-06  
**Related**: #294, #315, #342

## Executive Summary

After analyzing the codebase, I found that **Routa already has a sophisticated trace infrastructure** that is **far richer than just `history.jsonl`**. The challenge is not building trace capture from scratch, but **connecting the dots** between:

1. **Rich agent traces** (`.routa/traces/{day}/traces-{datetime}.jsonl`)
2. **Specialized harness evolution history** (`docs/fitness/evolution/history.jsonl`)
3. **Session history persistence** (DB + localStorage)
4. **Trace replay capabilities** (already implemented!)

## 🎯 Key Finding: We Have TWO Trace Systems!

### System 1: Universal Agent Trace (`.routa/traces/`)

**Location**: `<workspace>/.routa/traces/{day}/traces-{datetime}.jsonl`

**Schema**: Full Agent Trace spec (v0.1.0)
```json
{
  "version": "0.1.0",
  "id": "uuid",
  "timestamp": "2026-03-04T12:03:26.455Z",
  "sessionId": "session-uuid",
  "workspaceId": "default",
  "contributor": {"provider": "auggie", "model": "..."},
  "eventType": "tool_call|user_message|agent_message|...",
  "tool": {"name": "read_file", "toolCallId": "...", "status": "completed"},
  "files": [{"path": "...", "operation": "write", "contentHash": "..."}],
  "conversation": {"role": "user", "contentPreview": "..."},
  "vcs": {"revision": "abc123", "branch": "main", "repoRoot": "/path"},
  "metadata": {...}
}
```

**Coverage**:
- ✅ All agent sessions (ACP protocol)
- ✅ Tool calls with file ranges
- ✅ VCS context (Git revision, branch)
- ✅ Multi-provider support (Claude, OpenCode, Codex, etc.)
- ✅ Replay capabilities (trace-replay.ts)
- ✅ Both Rust and TypeScript implementations

**Storage Paths**:
- New: `~/.routa/projects/{folder-slug}/traces/` (workspace-scoped)
- Legacy: `<workspace>/.routa/traces/` (repo-local)

### System 2: Harness Evolution History (`docs/fitness/evolution/history.jsonl`)

**Location**: `docs/fitness/evolution/history.jsonl` (repo-committed)

**Schema**: Minimal outcome tracking
```json
{
  "timestamp": "2026-04-06T01:29:43Z",
  "repo_root": "/Users/phodal/ai/routa-js",
  "mode": "auto-apply",
  "patches_applied": ["patch.normalize_automation_target"],
  "patches_failed": [],
  "success_rate": 1.0
}
```

**Coverage**:
- ⚠️  Only harness evolution outcomes
- ⚠️  No task fingerprint
- ⚠️  No evidence bundle
- ⚠️  No execution steps
- ⚠️  No link to underlying agent traces

## 💡 Integration Strategy

### Problem: The Two Systems Don't Talk

**Current gap**:
- **Agent traces** capture the HOW (tool calls, file edits, session flow)
- **Evolution history** captures the WHAT (patch success/failure)
- **No bridge** between them!

A harness evolution run generates:
1. Rich agent traces → `.routa/traces/2026-04-06/traces-20260406-033937.jsonl`
2. Minimal outcome → `docs/fitness/evolution/history.jsonl` (single line)

**The missing link**: `sessionId`!

### Proposed Solution: Add `sessionId` to Evolution History

#### Step 1: Extend `EvolutionHistory` struct

```rust
// crates/routa-cli/src/commands/harness/engineering/types.rs

#[derive(Debug, Serialize)]
pub(super) struct EvolutionHistory {
    pub timestamp: String,
    pub repo_root: String,
    pub mode: String,
    
    // NEW: Link to agent trace
    pub session_id: Option<String>,  // ← Bridge to agent traces!
    
    // NEW: Task fingerprint
    pub task_type: String,  // "harness_evolution"
    pub workflow: Option<String>,  // "weekly_maintenance", "bootstrap", etc.
    pub trigger: String,  // "manual", "automation", "ci"
    
    // NEW: Evidence bundle
    pub gaps_detected: usize,
    pub gap_categories: Vec<String>,
    pub changed_paths: Vec<String>,
    
    // Existing fields
    pub patches_applied: Vec<String>,
    pub patches_failed: Vec<String>,
    pub success_rate: f64,
    
    // NEW: Failure context
    pub rollback_reason: Option<String>,
    pub error_messages: Vec<String>,
}
```

#### Step 2: Cross-Reference Queries

With `sessionId`, we can now:

```rust
// Find all agent traces for a harness evolution run
let evolution = load_evolution_history_entry(timestamp)?;
if let Some(session_id) = evolution.session_id {
    let trace_reader = TraceReader::new(repo_root);
    let traces = trace_reader.query(TraceQuery {
        session_id: Some(session_id),
        ..Default::default()
    }).await?;
    
    // Now we have:
    // - Which files were read (gap detection phase)
    // - Which files were written (patch application)
    // - Exact tool call sequence
    // - VCS state before/after
    // - Full conversation context
}
```

#### Step 3: Generate Playbooks from Aggregated Data

```rust
fn generate_playbook_from_traces(
    evolutions: &[EvolutionHistory],
    traces: &[Vec<TraceRecord>],
) -> Option<Playbook> {
    // Aggregate successful runs (success_rate >= 0.8)
    let successful = evolutions.iter()
        .zip(traces.iter())
        .filter(|(e, _)| e.success_rate >= 0.8)
        .collect::<Vec<_>>();
    
    if successful.len() < 3 {
        return None;  // Need 3+ runs for confidence
    }
    
    // Extract common patterns:
    // 1. Gap categories that appear together
    let common_gaps = find_common_gap_patterns(&successful);
    
    // 2. Patch application order
    let patch_order = find_optimal_patch_order(&successful);
    
    // 3. File touch patterns (from traces)
    let file_patterns = extract_file_touch_patterns(&successful);
    
    // 4. Anti-patterns (from failed runs)
    let anti_patterns = find_anti_patterns(evolutions, traces);
    
    Some(Playbook {
        id: format!("harness-evolution-{}", common_gaps.hash()),
        task_type: "harness_evolution",
        confidence: calculate_confidence(&successful),
        strategy: PlaybookStrategy {
            preferred_patch_order: patch_order,
            file_patterns,
            anti_patterns,
        },
        provenance: PlaybookProvenance {
            source_runs: successful.iter().map(|(e, _)| e.timestamp.clone()).collect(),
            success_rate: calculate_aggregate_success_rate(&successful),
        },
    })
}
```

## 🔍 Trace Capabilities Already Available

### 1. Trace Reader (Both Rust + TS)

**Rust**: `crates/routa-core/src/trace/reader.rs`
- Query by session, file, workspace, date range
- Pagination support (limit/offset)
- Multi-path search (new + legacy storage)

**TypeScript**: `src/core/trace/reader.ts`
- Same capabilities as Rust
- Postgres fallback for serverless
- JSONL parsing with error recovery

**Example query**:
```rust
let reader = TraceReader::new(repo_root);
let traces = reader.query(TraceQuery {
    session_id: Some("abc123".to_string()),
    event_type: Some("tool_call".to_string()),
    start_date: Some("2026-04-01".to_string()),
    limit: Some(100),
    ..Default::default()
}).await?;
```

### 2. Trace Replay (TS only)

**File**: `src/core/trace/trace-replay.ts`

**Capability**: Convert `TraceRecord[]` → semantic events
- EventBridge replay → `WorkspaceAgentEvent[]`
- AG-UI replay → `AGUIBaseEvent[]`

**Use case for learning**: Re-run past sessions to extract patterns!

```typescript
const traces = await traceReader.query({sessionId: "..."});
const events = replayAsEventBridge(traces);
// Now analyze the event stream to detect patterns
```

### 3. File Range Extraction

**Rust**: `crates/routa-core/src/trace/file_extractor.rs`
**TypeScript**: `src/core/trace/file-range-extractor.ts`

Automatically extracts file paths + line ranges from tool calls:
- `view`, `str-replace-editor`, `save-file` → precise line ranges
- Computes content hashes for attribution
- Records operation type (read/write/delete)

### 4. VCS Context Capture

**Rust**: `crates/routa-core/src/trace/vcs.rs`
**TypeScript**: `src/core/trace/vcs-context.ts`

Every trace records:
- Git revision (SHA)
- Current branch
- Repo root
- Dirty state (has uncommitted changes)

## 📊 Comparison: What We Have vs What We Need

| Feature | Agent Traces | Evolution History | Needed for Learning |
|---------|-------------|-------------------|---------------------|
| **Session linkage** | ✅ sessionId | ❌ No sessionId | ✅ Critical |
| **Task fingerprint** | ⚠️ metadata only | ❌ No task_type | ✅ Required |
| **Tool call sequence** | ✅ Full detail | ❌ Not recorded | ✅ Very useful |
| **File changes** | ✅ With ranges | ⚠️ Partial (changed_paths) | ✅ Required |
| **Evidence bundle** | ⚠️ Scattered | ❌ Not structured | ✅ Required |
| **Outcome** | ❌ No success/fail | ✅ success_rate | ✅ Critical |
| **Provenance** | ✅ VCS context | ⚠️ repo_root only | ✅ Required |
| **Replay-able** | ✅ Yes | ❌ No | ✅ Very useful |

## 🎯 Recommended Integration Path

### Phase 0: Immediate (This Week)

**Goal**: Connect evolution history to agent traces

1. Add `session_id: Option<String>` to `EvolutionHistory`
2. Capture current ACP session ID in `evaluate_harness_engineering()`
3. Write enriched history entries with session link
4. Validate traces are being written to `.routa/traces/`

**Benefit**: Can manually query agent traces for a harness run

**Effort**: ~2 hours

### Phase 1: MVP (Week 1)

**Goal**: Automated pattern extraction

1. Implement `aggregate_evolution_traces()` function
   - Load evolution history entries (last 30 days)
   - For each entry, load corresponding agent traces via sessionId
   - Build unified view: outcome + execution details
2. Implement `detect_common_patterns()`
   - Find gap categories that appear together
   - Detect patch application order
   - Extract file touch patterns
3. Implement `generate_playbook_candidate()`
   - Triggered when 3+ similar successful runs found
   - Write to `docs/fitness/playbooks/{id}.yaml`

**Benefit**: Automatic playbook generation from real runs

**Effort**: 3-4 days

### Phase 2: Runtime Integration (Week 2)

**Goal**: Use playbooks at runtime

1. Implement `load_playbooks_for_task()`
2. Add preflight guidance display
3. Implement `reorder_patches_by_playbook()`
4. Add provenance UI (show which runs generated the playbook)

**Benefit**: Faster convergence on new repos

**Effort**: 2-3 days

### Phase 3: Cross-Repo Learning (Week 3+)

**Goal**: Share learned patterns across repositories

1. Workspace-scoped playbook storage
2. Playbook import/export
3. Pattern similarity matching
4. Confidence decay for stale playbooks

**Benefit**: Transfer learning across projects

**Effort**: 1 week

## 🚨 Critical Insight: Reuse, Don't Rebuild!

**DO NOT create a separate trace system for harness evolution!**

Instead:
1. ✅ Use existing `TraceRecord` schema
2. ✅ Use existing `TraceWriter` / `TraceReader`
3. ✅ Use existing `trace-replay.ts` for pattern analysis
4. ✅ Just extend `EvolutionHistory` to **link** to agent traces

**Why this matters**:
- Agent traces already capture 90% of what we need
- Trace reader/writer are battle-tested (dual Rust+TS implementations)
- Replay infrastructure lets us re-analyze past runs
- VCS context is already there
- File attribution is already there

**What we're missing**:
- Task-level aggregation (evolution history has no sessionId)
- Outcome annotation (agent traces don't know success/failure)
- Pattern extraction logic

## 📝 Next Steps

1. **Review this analysis** - Does the integration strategy make sense?
2. **Decide on Phase 0** - Should we add sessionId linkage immediately?
3. **Prototype** - Can I build a quick proof-of-concept aggregator?
4. **Update PR #342** - Refine design doc with these findings

## 🎁 Bonus: Example Aggregated View

```json
{
  "evolution": {
    "timestamp": "2026-04-06T01:29:43Z",
    "session_id": "abc-123",
    "mode": "auto-apply",
    "patches_applied": ["patch.normalize_automation_target"],
    "success_rate": 1.0
  },
  "agent_traces": [
    {"eventType": "tool_call", "tool": {"name": "view"}, "files": [{"path": "docs/harness/automations.yml"}]},
    {"eventType": "tool_call", "tool": {"name": "str-replace-editor"}, "files": [{"path": "docs/harness/automations.yml", "operation": "write"}]},
    {"eventType": "tool_call", "tool": {"name": "launch-process"}, "tool": {"input": {"command": "git add docs/harness/automations.yml"}}}
  ],
  "derived_pattern": {
    "task_fingerprint": "harness_evolution:normalize_automation",
    "file_touch_sequence": ["read:automations.yml", "write:automations.yml", "commit:automations.yml"],
    "success_indicators": ["ratchet_passed", "tests_passed"],
    "confidence": 0.85
  }
}
```

This is the **evidence-backed learning** that Issue #294 asks for!
