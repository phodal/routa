use glob::{MatchOptions, Pattern};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct DiffStats {
    pub file_count: usize,
    pub added_lines: usize,
    pub deleted_lines: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewTriggerBoundary {
    pub name: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ReviewTriggerLayer {
    #[serde(default)]
    pub confidence_threshold: Option<u8>,
    #[serde(default)]
    pub specialist_id: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub context: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewTriggerRule {
    pub name: String,
    #[serde(rename = "type")]
    pub type_field: String,
    pub severity: String,
    pub action: String,
    pub paths: Vec<String>,
    pub directories: Vec<String>,
    pub max_files: Option<usize>,
    pub max_added_lines: Option<usize>,
    pub max_deleted_lines: Option<usize>,
    pub evidence_paths: Vec<String>,
    pub boundaries: Vec<ReviewTriggerBoundary>,
    pub min_boundaries: usize,
    #[serde(default)]
    pub confidence_threshold: Option<u8>,
    #[serde(default)]
    pub fallback_action: Option<String>,
    #[serde(default)]
    pub specialist_id: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub context: Vec<String>,
    #[serde(default)]
    pub review_layers: Vec<ReviewTriggerLayer>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TriggerMatch {
    pub name: String,
    pub severity: String,
    pub action: String,
    #[serde(default)]
    pub confidence_threshold: Option<u8>,
    #[serde(default)]
    pub fallback_action: Option<String>,
    #[serde(default)]
    pub specialist_id: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub context: Vec<String>,
    #[serde(default)]
    pub review_layers: Vec<ReviewTriggerLayer>,
    #[serde(default)]
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewTriggerReport {
    pub blocked: bool,
    pub human_review_required: bool,
    pub advisory_only: bool,
    pub staged_review_required: bool,
    pub base: String,
    pub changed_files: Vec<String>,
    pub diff_stats: DiffStats,
    pub triggers: Vec<TriggerMatch>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct ReviewTriggerConfigFile {
    #[serde(default)]
    review_triggers: Vec<ReviewTriggerRuleEntry>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct ReviewTriggerRuleEntry {
    name: Option<String>,
    #[serde(rename = "type")]
    type_field: Option<String>,
    severity: Option<String>,
    action: Option<String>,
    #[serde(default)]
    paths: Vec<String>,
    #[serde(default)]
    directories: Vec<String>,
    max_files: Option<usize>,
    max_added_lines: Option<usize>,
    max_deleted_lines: Option<usize>,
    #[serde(default)]
    evidence_paths: Vec<String>,
    #[serde(default)]
    boundaries: BTreeMap<String, Vec<String>>,
    min_boundaries: Option<usize>,
    confidence_threshold: Option<u8>,
    fallback_action: Option<String>,
    specialist_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    #[serde(default)]
    context: Vec<String>,
    #[serde(default)]
    review_layers: Vec<ReviewTriggerLayerEntry>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct ReviewTriggerLayerEntry {
    confidence_threshold: Option<u8>,
    specialist_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    #[serde(default)]
    context: Vec<String>,
}

pub fn load_review_triggers(config_path: &Path) -> Result<Vec<ReviewTriggerRule>, String> {
    let raw = std::fs::read_to_string(config_path)
        .map_err(|error| format!("failed to read {}: {error}", config_path.display()))?;
    let parsed: ReviewTriggerConfigFile = serde_yaml::from_str(&raw)
        .map_err(|error| format!("invalid review trigger yaml: {error}"))?;

    Ok(parsed
        .review_triggers
        .into_iter()
        .map(|entry| ReviewTriggerRule {
            action: normalize_action(entry.action.as_deref(), "require_human_review"),
            name: normalize_string(entry.name).unwrap_or_else(|| "unknown".to_string()),
            type_field: normalize_string(entry.type_field).unwrap_or_else(|| "unknown".to_string()),
            severity: normalize_string(entry.severity).unwrap_or_else(|| "medium".to_string()),
            paths: sanitize_strings(entry.paths),
            directories: sanitize_strings(entry.directories),
            max_files: entry.max_files,
            max_added_lines: entry.max_added_lines,
            max_deleted_lines: entry.max_deleted_lines,
            evidence_paths: sanitize_strings(entry.evidence_paths),
            boundaries: entry
                .boundaries
                .into_iter()
                .filter_map(|(name, paths)| {
                    let name = normalize_string(Some(name))?;
                    Some(ReviewTriggerBoundary {
                        name,
                        paths: sanitize_strings(paths),
                    })
                })
                .collect(),
            min_boundaries: entry.min_boundaries.unwrap_or(2),
            confidence_threshold: normalize_confidence_threshold(entry.confidence_threshold),
            fallback_action: normalize_optional_action(entry.fallback_action.as_deref()),
            specialist_id: normalize_string(entry.specialist_id),
            provider: normalize_string(entry.provider),
            model: normalize_string(entry.model),
            context: sanitize_strings(entry.context),
            review_layers: entry
                .review_layers
                .into_iter()
                .map(|layer| ReviewTriggerLayer {
                    confidence_threshold: normalize_confidence_threshold(layer.confidence_threshold),
                    specialist_id: normalize_string(layer.specialist_id),
                    provider: normalize_string(layer.provider),
                    model: normalize_string(layer.model),
                    context: sanitize_strings(layer.context),
                })
                .collect(),
        })
        .map(|mut rule| {
            if rule.action == "staged" && rule.fallback_action.is_none() {
                rule.fallback_action = Some("require_human_review".to_string());
            }
            rule
        })
        .collect())
}

pub fn collect_changed_files(repo_root: &Path, base: &str) -> Vec<String> {
    let commands = [
        vec!["diff", "--name-only", "--diff-filter=ACMR", base],
        vec!["diff", "--name-only", "--diff-filter=ACMR"],
        vec!["ls-files", "--others", "--exclude-standard"],
    ];
    let mut seen = std::collections::BTreeSet::new();
    let mut files = Vec::new();

    for args in commands {
        let output = Command::new("git")
            .args(&args)
            .current_dir(repo_root)
            .output();
        let Ok(output) = output else {
            continue;
        };
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
                continue;
            }
            files.push(trimmed.to_string());
        }
    }

    files
}

pub fn collect_diff_stats(repo_root: &Path, base: &str) -> DiffStats {
    let output = Command::new("git")
        .args(["diff", "--numstat", "--diff-filter=ACMR", base])
        .current_dir(repo_root)
        .output();
    let Ok(output) = output else {
        return DiffStats::default();
    };

    let mut stats = DiffStats::default();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut parts = line.split('\t');
        let Some(added) = parts.next() else {
            continue;
        };
        let Some(deleted) = parts.next() else {
            continue;
        };
        let Some(_path) = parts.next() else {
            continue;
        };
        if added == "-" || deleted == "-" {
            continue;
        }
        let Ok(added_lines) = added.parse::<usize>() else {
            continue;
        };
        let Ok(deleted_lines) = deleted.parse::<usize>() else {
            continue;
        };
        stats.file_count += 1;
        stats.added_lines += added_lines;
        stats.deleted_lines += deleted_lines;
    }

    stats
}

pub fn evaluate_review_triggers(
    rules: &[ReviewTriggerRule],
    changed_files: &[String],
    diff_stats: &DiffStats,
    base: &str,
    repo_root: Option<&Path>,
) -> ReviewTriggerReport {
    let mut triggers = Vec::new();

    for rule in rules {
        match rule.type_field.as_str() {
            "changed_paths" => {
                let reasons = changed_files
                    .iter()
                    .filter(|file_path| {
                        rule.paths
                            .iter()
                            .any(|pattern| pattern_matches_file(file_path, pattern))
                    })
                    .map(|file_path| format!("changed path: {file_path}"))
                    .collect::<Vec<_>>();
                push_trigger_if_any(&mut triggers, rule, reasons);
            }
            "sensitive_file_change" => {
                let reasons = changed_files
                    .iter()
                    .filter(|file_path| {
                        rule.paths
                            .iter()
                            .any(|pattern| pattern_matches_file(file_path, pattern))
                    })
                    .map(|file_path| format!("sensitive file changed: {file_path}"))
                    .collect::<Vec<_>>();
                push_trigger_if_any(&mut triggers, rule, reasons);
            }
            "diff_size" => {
                let mut reasons = Vec::new();
                if let Some(max_files) = rule.max_files {
                    if diff_stats.file_count > max_files {
                        reasons.push(format!(
                            "diff touched {} files (threshold: {max_files})",
                            diff_stats.file_count
                        ));
                    }
                }
                if let Some(max_added_lines) = rule.max_added_lines {
                    if diff_stats.added_lines > max_added_lines {
                        reasons.push(format!(
                            "diff added {} lines (threshold: {max_added_lines})",
                            diff_stats.added_lines
                        ));
                    }
                }
                if let Some(max_deleted_lines) = rule.max_deleted_lines {
                    if diff_stats.deleted_lines > max_deleted_lines {
                        reasons.push(format!(
                            "diff deleted {} lines (threshold: {max_deleted_lines})",
                            diff_stats.deleted_lines
                        ));
                    }
                }
                push_trigger_if_any(&mut triggers, rule, reasons);
            }
            "directory_file_count" => {
                let Some(repo_root) = repo_root else {
                    continue;
                };
                let Some(max_files) = rule.max_files else {
                    continue;
                };

                let mut reasons = Vec::new();
                for directory in &rule.directories {
                    let touched_files = changed_files_in_directory(changed_files, directory);
                    if touched_files.is_empty() {
                        continue;
                    }
                    let direct_files = count_direct_files(repo_root, directory);
                    if direct_files > max_files {
                        let mut changed_sample = touched_files
                            .iter()
                            .take(3)
                            .map(|path| path.as_str())
                            .collect::<Vec<_>>()
                            .join(", ");
                        if touched_files.len() > 3 {
                            changed_sample.push_str(", ...");
                        }
                        reasons.push(format!(
                            "directory '{directory}' has {direct_files} direct files (threshold: {max_files}); changed files: {changed_sample}"
                        ));
                    }
                }
                push_trigger_if_any(&mut triggers, rule, reasons);
            }
            "evidence_gap" => {
                let monitored_changes = changed_files
                    .iter()
                    .filter(|file_path| {
                        rule.paths
                            .iter()
                            .any(|pattern| pattern_matches_file(file_path, pattern))
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                if monitored_changes.is_empty() {
                    continue;
                }
                let evidence_touched = changed_files.iter().any(|file_path| {
                    rule.evidence_paths
                        .iter()
                        .any(|pattern| pattern_matches_file(file_path, pattern))
                });
                if !evidence_touched {
                    let mut reasons = monitored_changes
                        .iter()
                        .map(|path| format!("changed code path without evidence update: {path}"))
                        .collect::<Vec<_>>();
                    reasons.push(format!(
                        "expected evidence path patterns: {}",
                        rule.evidence_paths.join(", ")
                    ));
                    push_trigger_if_any(&mut triggers, rule, reasons);
                }
            }
            "cross_boundary_change" => {
                let boundary_hits = rule
                    .boundaries
                    .iter()
                    .filter_map(|boundary| {
                        let matches = changed_files
                            .iter()
                            .filter(|file_path| {
                                boundary
                                    .paths
                                    .iter()
                                    .any(|pattern| pattern_matches_file(file_path, pattern))
                            })
                            .cloned()
                            .collect::<Vec<_>>();
                        if matches.is_empty() {
                            None
                        } else {
                            Some((boundary.name.clone(), matches))
                        }
                    })
                    .collect::<Vec<_>>();
                if boundary_hits.len() >= rule.min_boundaries {
                    let reasons = boundary_hits
                        .into_iter()
                        .map(|(name, paths)| {
                            format!("changed boundary '{name}': {}", paths.join(", "))
                        })
                        .collect::<Vec<_>>();
                    push_trigger_if_any(&mut triggers, rule, reasons);
                }
            }
            _ => {}
        }
    }

    let blocked = triggers.iter().any(|trigger| trigger.action == "block");
    let human_review_required = triggers
        .iter()
        .any(|trigger| trigger.action == "require_human_review");
    let advisory_only =
        !triggers.is_empty() && triggers.iter().all(|trigger| trigger.action == "advisory");
    let staged_review_required = triggers.iter().any(|trigger| trigger.action == "staged");

    ReviewTriggerReport {
        blocked,
        human_review_required,
        advisory_only,
        staged_review_required,
        base: base.to_string(),
        changed_files: changed_files.to_vec(),
        diff_stats: diff_stats.clone(),
        triggers,
    }
}

fn normalize_string(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn normalize_action(value: Option<&str>, fallback: &str) -> String {
    match value.unwrap_or_default().trim().to_lowercase().as_str() {
        "advisory" | "warn" => "advisory".to_string(),
        "block" | "block_push" => "block".to_string(),
        "review" | "auto_review" | "staged" => "staged".to_string(),
        "require_human_review" | "human_review" => "require_human_review".to_string(),
        _ => fallback.to_string(),
    }
}

fn normalize_optional_action(value: Option<&str>) -> Option<String> {
    value
        .map(|item| normalize_action(Some(item), "require_human_review"))
        .filter(|item| !item.is_empty())
}

fn normalize_confidence_threshold(value: Option<u8>) -> Option<u8> {
    value.map(|threshold| threshold.clamp(1, 10))
}

fn sanitize_strings(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn pattern_matches_file(file_path: &str, pattern: &str) -> bool {
    let trimmed = pattern.trim();
    if trimmed.is_empty() {
        return false;
    }
    if let Some(prefix) = trimmed.strip_suffix('/') {
        return file_path == prefix || file_path.starts_with(&format!("{prefix}/"));
    }
    Pattern::new(trimmed)
        .map(|pattern| {
            pattern.matches_with(
                file_path,
                MatchOptions {
                    case_sensitive: true,
                    require_literal_separator: false,
                    require_literal_leading_dot: false,
                },
            )
        })
        .unwrap_or(false)
}

fn changed_files_in_directory<'a>(changed_files: &'a [String], directory: &str) -> Vec<&'a String> {
    let normalized = directory.trim().trim_matches('/');
    if normalized.is_empty() {
        return Vec::new();
    }
    let prefix = format!("{normalized}/");
    changed_files
        .iter()
        .filter(|file_path| file_path.as_str() == normalized || file_path.starts_with(&prefix))
        .collect()
}

fn count_direct_files(repo_root: &Path, directory: &str) -> usize {
    let target = repo_root.join(directory);
    let Ok(entries) = std::fs::read_dir(target) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| entry.path().is_file())
        .count()
}

fn push_trigger_if_any(
    triggers: &mut Vec<TriggerMatch>,
    rule: &ReviewTriggerRule,
    reasons: Vec<String>,
) {
    if reasons.is_empty() {
        return;
    }
    triggers.push(TriggerMatch {
        name: rule.name.clone(),
        severity: rule.severity.clone(),
        action: rule.action.clone(),
        confidence_threshold: rule.confidence_threshold,
        fallback_action: rule.fallback_action.clone(),
        specialist_id: rule.specialist_id.clone(),
        provider: rule.provider.clone(),
        model: rule.model.clone(),
        context: rule.context.clone(),
        review_layers: rule.review_layers.clone(),
        reasons,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diff_size_rule_triggers_when_threshold_exceeded() {
        let rule = ReviewTriggerRule {
            name: "oversized_change".to_string(),
            type_field: "diff_size".to_string(),
            severity: "high".to_string(),
            action: "require_human_review".to_string(),
            paths: Vec::new(),
            directories: Vec::new(),
            max_files: Some(1),
            max_added_lines: Some(10),
            max_deleted_lines: Some(5),
            evidence_paths: Vec::new(),
            boundaries: Vec::new(),
            min_boundaries: 2,
            confidence_threshold: None,
            fallback_action: None,
            specialist_id: None,
            provider: None,
            model: None,
            context: Vec::new(),
            review_layers: Vec::new(),
        };

        let report = evaluate_review_triggers(
            &[rule],
            &["src/a.ts".to_string(), "src/b.ts".to_string()],
            &DiffStats {
                file_count: 2,
                added_lines: 12,
                deleted_lines: 7,
            },
            "HEAD~1",
            None,
        );

        assert!(report.human_review_required);
        assert!(!report.blocked);
        assert!(!report.advisory_only);
        assert_eq!(report.triggers.len(), 1);
        assert_eq!(report.triggers[0].reasons.len(), 3);
    }

    #[test]
    fn cross_boundary_rule_requires_minimum_boundaries() {
        let rule = ReviewTriggerRule {
            name: "cross_boundary".to_string(),
            type_field: "cross_boundary_change".to_string(),
            severity: "medium".to_string(),
            action: "require_human_review".to_string(),
            paths: Vec::new(),
            directories: Vec::new(),
            max_files: None,
            max_added_lines: None,
            max_deleted_lines: None,
            evidence_paths: Vec::new(),
            boundaries: vec![
                ReviewTriggerBoundary {
                    name: "web".to_string(),
                    paths: vec!["src/**".to_string()],
                },
                ReviewTriggerBoundary {
                    name: "rust".to_string(),
                    paths: vec!["crates/**".to_string()],
                },
            ],
            min_boundaries: 2,
            confidence_threshold: None,
            fallback_action: None,
            specialist_id: None,
            provider: None,
            model: None,
            context: Vec::new(),
            review_layers: Vec::new(),
        };

        let report = evaluate_review_triggers(
            &[rule],
            &[
                "src/app/page.tsx".to_string(),
                "crates/routa-server/src/api/review.rs".to_string(),
            ],
            &DiffStats::default(),
            "HEAD~1",
            None,
        );

        assert!(report.human_review_required);
        assert!(!report.blocked);
        assert!(!report.advisory_only);
        assert_eq!(report.triggers[0].reasons.len(), 2);
    }

    #[test]
    fn load_review_triggers_normalizes_staged_fields() {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("review-triggers.yaml");
        std::fs::write(
            &config_path,
            r#"
review_triggers:
  - name: staged_security_review
    type: changed_paths
    severity: high
    action: review
    fallback_action: human_review
    confidence_threshold: 99
    specialist_id: security-reviewer
    provider: codex
    model: gpt-5.4
    context:
      - graph_review_context
    review_layers:
      - provider: codex
        model: gpt-5.4-mini
        confidence_threshold: 7
      - provider: claude
        model: claude-sonnet
        confidence_threshold: 9
    paths:
      - src/core/acp/**
"#,
        )
        .expect("write config");

        let rules = load_review_triggers(&config_path).expect("load rules");

        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].action, "staged");
        assert_eq!(
            rules[0].fallback_action.as_deref(),
            Some("require_human_review")
        );
        assert_eq!(rules[0].confidence_threshold, Some(10));
        assert_eq!(rules[0].specialist_id.as_deref(), Some("security-reviewer"));
        assert_eq!(rules[0].provider.as_deref(), Some("codex"));
        assert_eq!(rules[0].model.as_deref(), Some("gpt-5.4"));
        assert_eq!(rules[0].context, vec!["graph_review_context".to_string()]);
        assert_eq!(rules[0].review_layers.len(), 2);
        assert_eq!(rules[0].review_layers[0].provider.as_deref(), Some("codex"));
        assert_eq!(rules[0].review_layers[0].model.as_deref(), Some("gpt-5.4-mini"));
        assert_eq!(rules[0].review_layers[0].confidence_threshold, Some(7));
        assert_eq!(rules[0].review_layers[1].provider.as_deref(), Some("claude"));
        assert_eq!(rules[0].review_layers[1].model.as_deref(), Some("claude-sonnet"));
        assert_eq!(rules[0].review_layers[1].confidence_threshold, Some(9));
    }

    #[test]
    fn advisory_action_sets_advisory_only_report() {
        let rule = ReviewTriggerRule {
            name: "docs_change".to_string(),
            type_field: "changed_paths".to_string(),
            severity: "low".to_string(),
            action: "advisory".to_string(),
            paths: vec!["docs/**".to_string()],
            directories: Vec::new(),
            max_files: None,
            max_added_lines: None,
            max_deleted_lines: None,
            evidence_paths: Vec::new(),
            boundaries: Vec::new(),
            min_boundaries: 2,
            confidence_threshold: None,
            fallback_action: None,
            specialist_id: None,
            provider: None,
            model: None,
            context: Vec::new(),
            review_layers: Vec::new(),
        };

        let report = evaluate_review_triggers(
            &[rule],
            &["docs/fitness/README.md".to_string()],
            &DiffStats {
                file_count: 1,
                added_lines: 3,
                deleted_lines: 0,
            },
            "HEAD~1",
            None,
        );

        assert!(!report.blocked);
        assert!(!report.human_review_required);
        assert!(report.advisory_only);
        assert!(!report.staged_review_required);
    }
}
