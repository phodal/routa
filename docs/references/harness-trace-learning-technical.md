# Harness Trace Learning - Technical Reference

> **Deep dive**: Architecture, algorithms, and implementation details.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Harness Evolution Run                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Context Capture (Phase 0)                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ build_evolution_context()                                 │   │
│  │ - Infer workflow type                                     │   │
│  │ - Aggregate gap categories                                │   │
│  │ - Extract changed paths                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ record_evolution_outcome()                                │   │
│  │ - Append to history.jsonl                                 │   │
│  │ - Include full context + provenance                       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Pattern Extraction (Phase 1)                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ load_evolution_history()                                  │   │
│  │ - Parse history.jsonl                                     │   │
│  │ - Filter by success_rate >= 0.8                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ detect_common_patterns()                                  │   │
│  │ - Group by gap category combinations                      │   │
│  │ - Find patterns with 3+ occurrences                       │   │
│  │ - Extract patch order consensus                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ generate_playbook_candidates()                            │   │
│  │ - Build playbook with strategy                            │   │
│  │ - Add full provenance                                     │   │
│  │ - Calculate confidence score                              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ save_playbook()                                           │   │
│  │ - Write to docs/fitness/playbooks/*.json                  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Runtime Integration (Phase 2)                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ load_playbooks_for_task()                                 │   │
│  │ - Read docs/fitness/playbooks/*.json                      │   │
│  │ - Filter by taskType                                      │   │
│  │ - Sort by confidence                                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ find_matching_playbook()                                  │   │
│  │ - Try exact match first                                   │   │
│  │ - Fallback to fuzzy match (>= 50% overlap)                │   │
│  │ - Select highest weighted_score                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ display_preflight_guidance()                              │   │
│  │ - Show match type (exact/partial)                         │   │
│  │ - Display recommended patch order                         │   │
│  │ - Show anti-patterns                                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ reorder_patches_by_playbook()                             │   │
│  │ - Sort patches by learned order                           │   │
│  │ - Preserve unmatched patches at end                       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
                      Apply Patches (optimized)
```

## Core Algorithms

### 1. Pattern Detection

**File**: `crates/routa-cli/src/commands/harness/engineering/learning.rs`

**Function**: `detect_common_patterns()`

```rust
pub fn detect_common_patterns(
    entries: &[EvolutionHistory],
    min_success_rate: f64,
) -> Vec<CommonPattern> {
    // Step 1: Filter successful runs
    let successful: Vec<&EvolutionHistory> = entries
        .iter()
        .filter(|e| e.success_rate >= min_success_rate)  // Default: 0.8
        .collect();
    
    if successful.len() < 3 {
        return Vec::new();  // Need at least 3 runs
    }
    
    // Step 2: Group by gap patterns
    let mut gap_pattern_groups: HashMap<String, Vec<&EvolutionHistory>> = HashMap::new();
    
    for entry in successful.iter() {
        if let Some(ref categories) = entry.gap_categories {
            let mut sorted_categories = categories.clone();
            sorted_categories.sort();
            let pattern_key = sorted_categories.join(",");  // e.g., "gap_a,gap_b"
            
            gap_pattern_groups
                .entry(pattern_key)
                .or_default()
                .push(entry);
        }
    }
    
    // Step 3: Find patterns appearing 3+ times
    gap_pattern_groups
        .into_iter()
        .filter(|(_, group)| group.len() >= 3)  // Minimum 3 occurrences
        .map(|(pattern, group)| CommonPattern {
            gap_categories: pattern.split(',').map(|s| s.to_string()).collect(),
            occurrence_count: group.len(),
            avg_success_rate: group.iter().map(|e| e.success_rate).sum::<f64>() 
                              / group.len() as f64,
            preferred_patch_order: extract_patch_order_consensus(&group),
        })
        .collect()
}
```

**Complexity**: O(n) where n = number of history entries

**Thresholds**:
- Minimum success rate: 0.8 (80%)
- Minimum occurrences: 3 runs

### 2. Patch Order Consensus

**Function**: `extract_patch_order_consensus()`

```rust
fn extract_patch_order_consensus(entries: &[&EvolutionHistory]) -> Vec<String> {
    // Count patch positions across all runs
    let mut patch_positions: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    
    for entry in entries {
        for (idx, patch_id) in entry.patches_applied.iter().enumerate() {
            patch_positions
                .entry(patch_id.clone())
                .or_default()
                .push(idx);
        }
    }
    
    // Calculate average position for each patch
    let mut patches_with_avg: Vec<(String, f64)> = patch_positions
        .into_iter()
        .map(|(patch, positions)| {
            let avg = positions.iter().sum::<usize>() as f64 / positions.len() as f64;
            (patch, avg)
        })
        .collect();
    
    // Sort by average position
    patches_with_avg.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
    
    patches_with_avg.into_iter().map(|(patch, _)| patch).collect()
}
```

**Example**:
```
Run 1: [patch.A (pos 0), patch.B (pos 1), patch.C (pos 2)]
Run 2: [patch.A (pos 0), patch.C (pos 1), patch.B (pos 2)]
Run 3: [patch.A (pos 0), patch.B (pos 1), patch.C (pos 2)]

Average positions:
- patch.A: (0+0+0)/3 = 0.0
- patch.B: (1+2+1)/3 = 1.33
- patch.C: (2+1+2)/3 = 1.67

Result: [patch.A, patch.B, patch.C]
```

### 3. Fuzzy Matching

**Function**: `find_matching_playbook()`

```rust
pub fn find_matching_playbook<'a>(
    playbooks: &'a [PlaybookCandidate],
    gaps: &[HarnessEngineeringGap],
) -> Option<&'a PlaybookCandidate> {
    // Extract current gap categories
    let mut current_categories: Vec<String> = gaps
        .iter()
        .map(|g| g.category.clone())
        .collect();
    current_categories.sort();
    current_categories.dedup();
    
    // Step 1: Try exact match
    if let Some(exact) = playbooks.iter().find(|pb| {
        let mut playbook_pattern = pb.strategy.gap_patterns.clone();
        playbook_pattern.sort();
        playbook_pattern == current_categories
    }) {
        return Some(exact);
    }
    
    // Step 2: Fuzzy matching
    let mut best_match: Option<(&PlaybookCandidate, f64)> = None;
    
    for playbook in playbooks {
        // Calculate overlap
        let overlap_count = current_categories
            .iter()
            .filter(|cat| playbook.strategy.gap_patterns.contains(cat))
            .count();
        
        if overlap_count == 0 {
            continue;
        }
        
        // Overlap ratio
        let total_unique = current_categories.len().max(playbook.strategy.gap_patterns.len());
        let overlap_ratio = overlap_count as f64 / total_unique as f64;
        
        // Weighted score
        let weighted_score = overlap_ratio * playbook.confidence;
        
        // Threshold: >= 50% overlap
        if overlap_ratio >= 0.5 {
            if best_match.is_none() || weighted_score > best_match.unwrap().1 {
                best_match = Some((playbook, weighted_score));
            }
        }
    }
    
    best_match.map(|(pb, _)| pb)
}
```

**Scoring**:
```
weighted_score = (overlap_count / total_unique) * confidence

Example:
Playbook: ["gap_a", "gap_b"], confidence: 0.95
Current:  ["gap_a", "gap_b", "gap_c"]
Overlap:  2
Total:    max(2, 3) = 3
Ratio:    2/3 = 0.667
Score:    0.667 * 0.95 = 0.634
```

## Data Schemas

### EvolutionHistory

**File**: `crates/routa-cli/src/commands/harness/engineering/types.rs`

```rust
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionHistory {
    // Core metadata
    pub timestamp: String,              // RFC3339 format
    pub repo_root: String,              // Absolute path
    pub mode: String,                   // "auto-apply" | "evaluation"

    // Trace linking (Phase 0)
    pub session_id: Option<String>,     // Links to .routa/traces/

    // Task fingerprint
    pub task_type: Option<String>,      // "harness_evolution"
    pub workflow: Option<String>,       // "bootstrap" | "auto-apply" | "evaluation"
    pub trigger: Option<String>,        // "manual" | "automation" | "ci"

    // Evidence bundle
    pub gaps_detected: Option<usize>,
    pub gap_categories: Option<Vec<String>>,
    pub changed_paths: Option<Vec<String>>,

    // Outcome
    pub patches_applied: Vec<String>,
    pub patches_failed: Vec<String>,
    pub success_rate: f64,              // 0.0 to 1.0

    // Failure context
    pub rollback_reason: Option<String>,
    pub error_messages: Option<Vec<String>>,
}
```

**Serialization**: JSON with camelCase field names

### PlaybookCandidate

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybookCandidate {
    pub id: String,                     // Unique identifier
    pub task_type: String,              // "harness_evolution"
    pub confidence: f64,                // 0.0 to 1.0
    pub strategy: PlaybookStrategy,
    pub provenance: PlaybookProvenance,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybookStrategy {
    pub preferred_patch_order: Vec<String>,
    pub gap_patterns: Vec<String>,
    pub anti_patterns: Vec<AntiPattern>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybookProvenance {
    pub source_runs: Vec<String>,       // Timestamps
    pub success_rate: f64,              // Average across source runs
    pub evidence_count: usize,          // Number of source runs
}
```

## File Formats

### history.jsonl

**Format**: JSONL (JSON Lines)
- One JSON object per line
- Append-only (preserves history)
- No trailing comma

**Example**:
```jsonl
{"timestamp":"2026-04-06T01:29:43Z","repoRoot":"/path/to/repo","mode":"auto-apply","taskType":"harness_evolution","workflow":"bootstrap","trigger":"manual","gapsDetected":2,"gapCategories":["missing_governance_gate","missing_execution_surface"],"changedPaths":[".github/CODEOWNERS","docs/harness/build.yml"],"patchesApplied":["patch.create_codeowners","bootstrap.synthesize_build_yml"],"patchesFailed":[],"successRate":1.0}
{"timestamp":"2026-04-06T02:15:22Z","repoRoot":"/path/to/repo","mode":"auto-apply","taskType":"harness_evolution","workflow":"bootstrap","trigger":"manual","gapsDetected":2,"gapCategories":["missing_governance_gate","missing_execution_surface"],"changedPaths":[".github/CODEOWNERS","docs/harness/build.yml"],"patchesApplied":["patch.create_codeowners","bootstrap.synthesize_build_yml"],"patchesFailed":[],"successRate":1.0}
```

**Parsing**:
```rust
let content = fs::read_to_string("history.jsonl")?;
for line in content.lines() {
    if line.trim().is_empty() { continue; }
    let entry: EvolutionHistory = serde_json::from_str(line)?;
    // Process entry
}
```

### playbook-*.json

**Format**: JSON (pretty-printed)
- Single JSON object per file
- One file per playbook
- Named: `{task-type}-{gap-pattern}.json`

**Example**:
```json
{
  "id": "harness-evolution-missing-governance",
  "taskType": "harness_evolution",
  "confidence": 0.95,
  "strategy": {
    "preferredPatchOrder": [
      "patch.create_codeowners",
      "patch.create_dependabot"
    ],
    "gapPatterns": [
      "missing_governance_gate"
    ],
    "antiPatterns": []
  },
  "provenance": {
    "sourceRuns": [
      "2026-04-06T01:29:43Z",
      "2026-04-06T02:15:22Z",
      "2026-04-07T10:30:15Z"
    ],
    "successRate": 0.95,
    "evidenceCount": 3
  }
}
```

## Performance Characteristics

### Pattern Detection

**Time Complexity**: O(n + m log m)
- n = number of history entries
- m = number of unique gap patterns

**Space Complexity**: O(n)
- Stores all successful runs in memory

**Bottleneck**: JSONL parsing (I/O bound)

**Optimization**: Could add indexing for large history files (>10k entries)

### Playbook Matching

**Time Complexity**: O(p * g)
- p = number of playbooks (typically < 10)
- g = number of current gaps (typically < 50)

**Space Complexity**: O(p)

**Optimization**: Already optimal for expected data sizes

### Patch Reordering

**Time Complexity**: O(n log n)
- n = number of patches (typically < 20)
- Standard sorting algorithm

**Space Complexity**: O(n)

**Optimization**: Already optimal

## Configuration

### Thresholds (Hardcoded)

**Pattern Detection**:
- Minimum success rate: `0.8` (80%)
- Minimum occurrences: `3` runs

**Fuzzy Matching**:
- Minimum overlap: `0.5` (50%)

**Future**: These could be made configurable via CLI flags or config file.

### File Paths

```rust
const HISTORY_FILE: &str = "docs/fitness/evolution/history.jsonl";
const PLAYBOOKS_DIR: &str = "docs/fitness/playbooks";
```

## Extension Points

### Custom Playbook Generators

**Current**: Automatic generation from history

**Extension**: Allow custom playbook generators

```rust
pub trait PlaybookGenerator {
    fn generate(&self, history: &[EvolutionHistory]) -> Vec<PlaybookCandidate>;
}

// Example: AI-powered generator
struct AIPlaybookGenerator {
    model: String,
}

impl PlaybookGenerator for AIPlaybookGenerator {
    fn generate(&self, history: &[EvolutionHistory]) -> Vec<PlaybookCandidate> {
        // Call AI model to analyze patterns
        // Return AI-suggested playbooks
    }
}
```

### Custom Matching Strategies

**Current**: Exact + fuzzy matching

**Extension**: Pluggable matchers

```rust
pub trait PlaybookMatcher {
    fn find_match<'a>(
        &self,
        playbooks: &'a [PlaybookCandidate],
        gaps: &[HarnessEngineeringGap],
    ) -> Option<&'a PlaybookCandidate>;
}

// Example: ML-based matcher
struct MLMatcher {
    model_path: PathBuf,
}

impl PlaybookMatcher for MLMatcher {
    fn find_match<'a>(...) -> Option<&'a PlaybookCandidate> {
        // Use ML model to predict best playbook
    }
}
```

### Playbook Validation

**Future**: Validate playbooks before use

```rust
pub trait PlaybookValidator {
    fn validate(&self, playbook: &PlaybookCandidate) -> Result<(), String>;
}

// Example: Schema validator
struct SchemaValidator;

impl PlaybookValidator for SchemaValidator {
    fn validate(&self, playbook: &PlaybookCandidate) -> Result<(), String> {
        if playbook.confidence < 0.0 || playbook.confidence > 1.0 {
            return Err("Confidence must be between 0.0 and 1.0".to_string());
        }
        // ... more validation
        Ok(())
    }
}
```

## Testing Strategy

### Unit Tests (9 tests)

**Pattern Detection**:
- `test_load_evolution_history` - Parse JSONL
- `test_detect_common_patterns` - Group & filter
- `test_generate_playbook_candidates` - Build playbooks

**Runtime Integration**:
- `test_load_playbooks_for_task` - Deserialize JSON
- `test_find_matching_playbook` - Exact match
- `test_fuzzy_matching_playbook` - Partial match
- `test_no_match_when_overlap_too_low` - Threshold

**Utilities**:
- `test_save_playbook` - Serialize & write
- `test_reorder_patches_by_playbook` - Sorting

### Integration Tests

**Manual Validation**:
1. Run harness evolve 3 times
2. Generate playbook with `--learn`
3. Verify playbook file exists
4. Run harness evolve again
5. Verify playbook loaded and guidance displayed

### Property-Based Tests (Future)

```rust
#[quickcheck]
fn prop_fuzzy_match_is_reflexive(playbook: PlaybookCandidate) -> bool {
    // A playbook should always match itself
    let gaps = playbook.strategy.gap_patterns
        .iter()
        .map(|cat| create_gap(cat))
        .collect();

    find_matching_playbook(&[playbook.clone()], &gaps).is_some()
}
```

## Related Code

### Core Modules

- `crates/routa-cli/src/commands/harness/engineering/learning.rs` (310 lines)
  - Pattern detection
  - Playbook generation
  - Runtime loading
  - Fuzzy matching

- `crates/routa-cli/src/commands/harness/engineering/mod.rs` (+190 lines)
  - Integration with harness evolve
  - Context capture
  - History recording

- `crates/routa-cli/src/commands/harness/engineering/types.rs` (+20 lines)
  - EvolutionHistory schema
  - EvolutionContext

### Tests

- `crates/routa-cli/src/commands/harness/engineering/tests_learning.rs` (300 lines)
  - 9 comprehensive tests
  - Covers all major code paths

## References

- [User Guide](../guides/harness-trace-learning-guide.md)
- [Feature Overview](../features/harness-trace-learning.md)
- [Phase 2 Design](../design-docs/harness-trace-learning-phase2.md)
- Issue [#294](https://github.com/phodal/routa/issues/294)
- PR [#345](https://github.com/phodal/routa/pull/345)
