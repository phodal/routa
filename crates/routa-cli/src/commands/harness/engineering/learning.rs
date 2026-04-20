//! Trace Learning for Harness Evolution
//!
//! Extracts patterns from evolution history and generates playbook candidates.

use super::types::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;

/// Playbook candidate generated from successful evolution runs
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybookCandidate {
    pub id: String,
    pub task_type: String,
    pub confidence: f64,
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
pub struct AntiPattern {
    pub do_not: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybookProvenance {
    pub source_runs: Vec<String>,
    pub success_rate: f64,
    pub evidence_count: usize,
}

/// Load evolution history from JSONL file
pub fn load_evolution_history(repo_root: &Path) -> Result<Vec<EvolutionHistory>, String> {
    let history_file = repo_root.join("docs/fitness/evolution/history.jsonl");

    if !history_file.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&history_file)
        .map_err(|e| format!("Failed to read evolution history: {e}"))?;

    let mut entries = Vec::new();
    for (line_num, line) in content.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }

        match serde_json::from_str::<EvolutionHistory>(line) {
            Ok(entry) => entries.push(entry),
            Err(e) => {
                eprintln!(
                    "Warning: Failed to parse history line {}: {}",
                    line_num + 1,
                    e
                );
            }
        }
    }

    Ok(entries)
}

/// Detect common patterns from successful runs
pub fn detect_common_patterns(
    entries: &[EvolutionHistory],
    min_success_rate: f64,
) -> Vec<CommonPattern> {
    // Filter successful runs (success_rate >= threshold)
    let successful: Vec<&EvolutionHistory> = entries
        .iter()
        .filter(|e| e.success_rate >= min_success_rate)
        .collect();

    if successful.len() < 3 {
        return Vec::new(); // Need at least 3 successful runs
    }

    // Group by gap patterns (which gap categories appear together)
    let mut gap_pattern_groups: HashMap<String, Vec<&EvolutionHistory>> = HashMap::new();

    for entry in successful.iter() {
        if let Some(ref categories) = entry.gap_categories {
            let mut sorted_categories = categories.clone();
            sorted_categories.sort();
            let pattern_key = sorted_categories.join(",");

            gap_pattern_groups
                .entry(pattern_key)
                .or_default()
                .push(entry);
        }
    }

    // Find patterns that appear 3+ times
    gap_pattern_groups
        .into_iter()
        .filter(|(_, group)| group.len() >= 3)
        .map(|(pattern, group)| CommonPattern {
            gap_categories: pattern.split(',').map(|s| s.to_string()).collect(),
            occurrence_count: group.len(),
            avg_success_rate: group.iter().map(|e| e.success_rate).sum::<f64>()
                / group.len() as f64,
            preferred_patch_order: extract_patch_order_consensus(&group),
        })
        .collect()
}

/// Common pattern found in successful runs
#[derive(Debug, Clone)]
pub struct CommonPattern {
    pub gap_categories: Vec<String>,
    pub occurrence_count: usize,
    pub avg_success_rate: f64,
    pub preferred_patch_order: Vec<String>,
}

fn extract_patch_order_consensus(entries: &[&EvolutionHistory]) -> Vec<String> {
    // Count patch frequencies and their typical positions
    let mut patch_positions: BTreeMap<String, Vec<usize>> = BTreeMap::new();

    for entry in entries {
        for (idx, patch_id) in entry.patches_applied.iter().enumerate() {
            patch_positions
                .entry(patch_id.clone())
                .or_default()
                .push(idx);
        }
    }

    // Sort patches by their average position
    let mut patches_with_avg: Vec<(String, f64)> = patch_positions
        .into_iter()
        .map(|(patch, positions)| {
            let avg = positions.iter().sum::<usize>() as f64 / positions.len() as f64;
            (patch, avg)
        })
        .collect();

    patches_with_avg.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());

    patches_with_avg
        .into_iter()
        .map(|(patch, _)| patch)
        .collect()
}

/// Generate playbook candidates from detected patterns
pub fn generate_playbook_candidates(
    repo_root: &Path,
    patterns: &[CommonPattern],
) -> Result<Vec<PlaybookCandidate>, String> {
    let mut playbooks = Vec::new();
    let history = load_evolution_history(repo_root)?;

    for pattern in patterns {
        // Generate unique ID from gap pattern
        let id = format!(
            "harness-evolution-{}",
            pattern
                .gap_categories
                .iter()
                .map(|c| c.replace("_", "-"))
                .collect::<Vec<_>>()
                .join("-")
        );

        // Find all runs matching this pattern
        let matching_runs: Vec<&EvolutionHistory> = history
            .iter()
            .filter(|e| {
                if let Some(ref cats) = e.gap_categories {
                    let mut sorted = cats.clone();
                    sorted.sort();
                    sorted == pattern.gap_categories
                } else {
                    false
                }
            })
            .collect();

        // Extract anti-patterns from failed runs
        let failed_runs: Vec<&EvolutionHistory> =
            history.iter().filter(|e| e.success_rate < 0.8).collect();

        let anti_patterns = extract_anti_patterns(&failed_runs);

        let playbook = PlaybookCandidate {
            id,
            task_type: "harness_evolution".to_string(),
            confidence: pattern.avg_success_rate,
            strategy: PlaybookStrategy {
                preferred_patch_order: pattern.preferred_patch_order.clone(),
                gap_patterns: pattern.gap_categories.clone(),
                anti_patterns,
            },
            provenance: PlaybookProvenance {
                source_runs: matching_runs.iter().map(|e| e.timestamp.clone()).collect(),
                success_rate: pattern.avg_success_rate,
                evidence_count: pattern.occurrence_count,
            },
        };

        playbooks.push(playbook);
    }

    Ok(playbooks)
}

fn extract_anti_patterns(failed_runs: &[&EvolutionHistory]) -> Vec<AntiPattern> {
    let mut anti_patterns = Vec::new();

    for run in failed_runs {
        if let Some(ref reason) = run.rollback_reason {
            anti_patterns.push(AntiPattern {
                do_not: format!("apply {} patches", run.patches_applied.join(", ")),
                reason: reason.clone(),
            });
        }
    }

    // Deduplicate
    anti_patterns.sort_by(|a, b| a.do_not.cmp(&b.do_not));
    anti_patterns.dedup_by(|a, b| a.do_not == b.do_not);

    anti_patterns
}

/// Save playbook to JSON file
pub fn save_playbook(repo_root: &Path, playbook: &PlaybookCandidate) -> Result<(), String> {
    let playbook_dir = repo_root.join("docs/fitness/playbooks");
    fs::create_dir_all(&playbook_dir)
        .map_err(|e| format!("Failed to create playbooks dir: {e}"))?;

    let playbook_file = playbook_dir.join(format!("{}.json", playbook.id));

    let json = serde_json::to_string_pretty(playbook)
        .map_err(|e| format!("Failed to serialize playbook: {e}"))?;

    fs::write(&playbook_file, json).map_err(|e| format!("Failed to write playbook: {e}"))?;

    Ok(())
}

/// Load playbooks for a specific task type
pub fn load_playbooks_for_task(
    repo_root: &Path,
    task_type: &str,
) -> Result<Vec<PlaybookCandidate>, String> {
    let playbook_dir = repo_root.join("docs/fitness/playbooks");

    if !playbook_dir.exists() {
        return Ok(Vec::new());
    }

    let entries =
        fs::read_dir(&playbook_dir).map_err(|e| format!("Failed to read playbooks dir: {e}"))?;

    let mut playbooks = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {e}"))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }

        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read playbook file {path:?}: {e}"))?;

        match serde_json::from_str::<PlaybookCandidate>(&content) {
            Ok(playbook) if playbook.task_type == task_type => {
                playbooks.push(playbook);
            }
            Ok(_) => {
                // Skip playbooks for other task types
            }
            Err(e) => {
                eprintln!("Warning: Failed to parse playbook {path:?}: {e}");
            }
        }
    }

    // Sort by confidence (descending)
    playbooks.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap());

    Ok(playbooks)
}

/// Find the best matching playbook for given gaps
pub fn find_matching_playbook<'a>(
    playbooks: &'a [PlaybookCandidate],
    gaps: &[super::HarnessEngineeringGap],
) -> Option<&'a PlaybookCandidate> {
    if gaps.is_empty() || playbooks.is_empty() {
        return None;
    }

    // Extract and sort current gap categories
    let mut current_categories: Vec<String> = gaps.iter().map(|g| g.category.clone()).collect();
    current_categories.sort();
    current_categories.dedup();

    // Find exact match first
    if let Some(exact) = playbooks.iter().find(|pb| {
        let mut playbook_pattern = pb.strategy.gap_patterns.clone();
        playbook_pattern.sort();
        playbook_pattern == current_categories
    }) {
        return Some(exact);
    }

    // If no exact match, find best partial match (highest overlap)
    let mut best_match: Option<(&PlaybookCandidate, f64)> = None;

    for playbook in playbooks {
        let playbook_patterns = &playbook.strategy.gap_patterns;

        // Calculate overlap percentage
        let overlap_count = current_categories
            .iter()
            .filter(|cat| playbook_patterns.contains(cat))
            .count();

        if overlap_count == 0 {
            continue; // No overlap at all
        }

        // Overlap score: (overlap / total unique categories)
        let total_unique = current_categories.len().max(playbook_patterns.len());
        let overlap_score = overlap_count as f64 / total_unique as f64;

        // Only consider if overlap is significant (>= 50%) and weighted by confidence
        let weighted_score = overlap_score * playbook.confidence;

        if overlap_score >= 0.5 && (best_match.is_none() || weighted_score > best_match.unwrap().1)
        {
            best_match = Some((playbook, weighted_score));
        }
    }

    best_match.map(|(pb, _)| pb)
}

/// Reorder patches based on playbook strategy
pub fn reorder_patches_by_playbook(
    patches: &mut [super::HarnessEngineeringPatchCandidate],
    playbook: &PlaybookCandidate,
) {
    use std::collections::HashMap;

    // Create priority map from playbook order
    let priority_map: HashMap<String, usize> = playbook
        .strategy
        .preferred_patch_order
        .iter()
        .enumerate()
        .map(|(idx, id)| (id.clone(), idx))
        .collect();

    // Sort patches by priority
    // Patches in playbook come first (by their order)
    // Patches not in playbook come last (preserve original order)
    patches.sort_by_key(|patch| priority_map.get(&patch.id).copied().unwrap_or(usize::MAX));
}

/// Display preflight guidance from playbook
pub fn display_preflight_guidance(
    playbook: &PlaybookCandidate,
    gaps: &[super::HarnessEngineeringGap],
    json_output: bool,
) {
    if json_output {
        return; // Skip in JSON mode
    }

    // Calculate match type
    let current_categories: Vec<String> = gaps.iter().map(|g| g.category.clone()).collect();

    let exact_match = {
        let mut sorted_current = current_categories.clone();
        sorted_current.sort();
        sorted_current.dedup();
        let mut sorted_playbook = playbook.strategy.gap_patterns.clone();
        sorted_playbook.sort();
        sorted_current == sorted_playbook
    };

    let match_type = if exact_match {
        "exact match"
    } else {
        "partial match"
    };

    println!();
    println!(
        "🧠 Loaded learned playbook (confidence: {:.0}%, {})",
        playbook.confidence * 100.0,
        match_type
    );
    println!("  ID: {}", playbook.id);
    println!(
        "  Evidence: {} successful runs",
        playbook.provenance.evidence_count
    );

    if !playbook.strategy.preferred_patch_order.is_empty() {
        println!();
        println!("💡 Recommended patch order:");
        for (idx, patch_id) in playbook.strategy.preferred_patch_order.iter().enumerate() {
            println!("  {}. {}", idx + 1, patch_id);
        }
    }

    if !playbook.strategy.anti_patterns.is_empty() {
        println!();
        println!("⚠️  Known issues:");
        for anti in &playbook.strategy.anti_patterns {
            println!("  - {}: {}", anti.do_not, anti.reason);
        }
    }

    println!();
}
