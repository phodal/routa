use crate::shared::models::FileView;
use crate::ui::tui::cache::DiffStatSummary;
use glob::Pattern;
use serde_yaml::Value;
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReviewRiskLevel {
    High,
    Medium,
}

#[derive(Clone, Debug)]
pub struct ReviewHint {
    pub label: &'static str,
    pub level: ReviewRiskLevel,
    pub rule_name: String,
}

#[derive(Clone, Debug)]
pub struct RepoReviewHint {
    pub label: &'static str,
    pub level: ReviewRiskLevel,
    pub rule_name: String,
}

#[derive(Clone, Debug)]
struct ReviewTriggerRule {
    name: String,
    trigger_type: String,
    severity: String,
    paths: Vec<String>,
    directories: Vec<String>,
    boundaries: Vec<Vec<String>>,
    min_boundaries: Option<usize>,
    max_files: Option<usize>,
    max_added_lines: Option<usize>,
    max_deleted_lines: Option<usize>,
}

pub struct ReviewTriggerCache {
    rules: Vec<ReviewTriggerRule>,
}

impl ReviewTriggerCache {
    pub fn load(repo_root: &str) -> Self {
        Self {
            rules: load_review_trigger_rules(repo_root),
        }
    }

    pub fn review_hint(&self, file: &FileView) -> Option<ReviewHint> {
        let mut best: Option<ReviewHint> = None;
        for rule in &self.rules {
            let matches = if file.entry_kind.is_container() {
                matches_rule_as_container(rule, &file.rel_path)
            } else {
                matches_review_trigger_rule(rule, &file.rel_path)
            };
            if !matches {
                continue;
            }
            let level = severity_level(&rule.severity);
            let candidate = ReviewHint {
                label: level_label(&level),
                level: level.clone(),
                rule_name: rule.name.clone(),
            };
            if best
                .as_ref()
                .map(|current| {
                    review_level_rank(&candidate.level) > review_level_rank(&current.level)
                })
                .unwrap_or(true)
            {
                best = Some(candidate);
            }
        }
        best
    }

    pub fn repo_review_hints<'a>(
        &self,
        files: &[&'a FileView],
        diff_stat_for: impl Fn(&'a FileView) -> Option<&'a DiffStatSummary>,
    ) -> Vec<RepoReviewHint> {
        let file_paths = files
            .iter()
            .map(|file| file.rel_path.clone())
            .collect::<Vec<_>>();
        let added_lines = repo_added_lines(files, &diff_stat_for);
        let deleted_lines = repo_deleted_lines(files, &diff_stat_for);
        let mut hints = Vec::new();

        for rule in &self.rules {
            let matched = match rule.trigger_type.as_str() {
                "diff_size" => {
                    rule.max_files.is_some_and(|max| file_paths.len() > max)
                        || rule
                            .max_added_lines
                            .is_some_and(|max| added_lines.is_some_and(|value| value > max))
                        || rule
                            .max_deleted_lines
                            .is_some_and(|max| deleted_lines.is_some_and(|value| value > max))
                }
                "cross_boundary_change" => {
                    let matched_boundaries = rule
                        .boundaries
                        .iter()
                        .filter(|boundary| {
                            file_paths.iter().any(|path| {
                                boundary.iter().any(|pattern| match_file(path, pattern))
                            })
                        })
                        .count();
                    matched_boundaries >= rule.min_boundaries.unwrap_or(2)
                }
                _ => false,
            };
            if matched {
                hints.push(RepoReviewHint {
                    label: level_label(&severity_level(&rule.severity)),
                    level: severity_level(&rule.severity),
                    rule_name: rule.name.clone(),
                });
            }
        }

        hints.sort_by_key(|hint| std::cmp::Reverse(review_level_rank(&hint.level)));
        hints
    }

    pub fn repo_review_context_for_file<'a>(
        &self,
        file: &FileView,
        files: &[&'a FileView],
        diff_stat_for: impl Fn(&'a FileView) -> Option<&'a DiffStatSummary>,
    ) -> Vec<RepoReviewHint> {
        let file_paths = files
            .iter()
            .map(|entry| entry.rel_path.clone())
            .collect::<Vec<_>>();
        let added_lines = repo_added_lines(files, &diff_stat_for);
        let deleted_lines = repo_deleted_lines(files, &diff_stat_for);
        let mut hints = Vec::new();

        for rule in &self.rules {
            let includes_file = match rule.trigger_type.as_str() {
                "diff_size" => {
                    rule.max_files.is_some_and(|max| file_paths.len() > max)
                        || rule
                            .max_added_lines
                            .is_some_and(|max| added_lines.is_some_and(|value| value > max))
                        || rule
                            .max_deleted_lines
                            .is_some_and(|max| deleted_lines.is_some_and(|value| value > max))
                }
                "cross_boundary_change" => {
                    let file_matches_boundary = rule.boundaries.iter().any(|boundary| {
                        boundary
                            .iter()
                            .any(|pattern| match_file(&file.rel_path, pattern))
                    });
                    let matched_boundaries = rule
                        .boundaries
                        .iter()
                        .filter(|boundary| {
                            file_paths.iter().any(|path| {
                                boundary.iter().any(|pattern| match_file(path, pattern))
                            })
                        })
                        .count();
                    file_matches_boundary && matched_boundaries >= rule.min_boundaries.unwrap_or(2)
                }
                _ => false,
            };
            if includes_file {
                hints.push(RepoReviewHint {
                    label: level_label(&severity_level(&rule.severity)),
                    level: severity_level(&rule.severity),
                    rule_name: rule.name.clone(),
                });
            }
        }

        hints.sort_by_key(|hint| std::cmp::Reverse(review_level_rank(&hint.level)));
        hints
    }
}

fn repo_added_lines<'a>(
    files: &[&'a FileView],
    diff_stat_for: &impl Fn(&'a FileView) -> Option<&'a DiffStatSummary>,
) -> Option<usize> {
    let mut total = 0usize;
    let mut seen = false;
    for file in files {
        if let Some(stats) = diff_stat_for(file) {
            if let Some(additions) = stats.additions {
                total += additions;
                seen = true;
            }
        }
    }
    seen.then_some(total)
}

fn repo_deleted_lines<'a>(
    files: &[&'a FileView],
    diff_stat_for: &impl Fn(&'a FileView) -> Option<&'a DiffStatSummary>,
) -> Option<usize> {
    let mut total = 0usize;
    let mut seen = false;
    for file in files {
        if let Some(stats) = diff_stat_for(file) {
            if let Some(deletions) = stats.deletions {
                total += deletions;
                seen = true;
            }
        }
    }
    seen.then_some(total)
}

fn review_level_rank(level: &ReviewRiskLevel) -> u8 {
    match level {
        ReviewRiskLevel::High => 2,
        ReviewRiskLevel::Medium => 1,
    }
}

fn severity_level(severity: &str) -> ReviewRiskLevel {
    match severity {
        "high" => ReviewRiskLevel::High,
        _ => ReviewRiskLevel::Medium,
    }
}

fn level_label(level: &ReviewRiskLevel) -> &'static str {
    match level {
        ReviewRiskLevel::High => "HIGH",
        ReviewRiskLevel::Medium => "REV",
    }
}

fn load_review_trigger_rules(repo_root: &str) -> Vec<ReviewTriggerRule> {
    let path = Path::new(repo_root).join("docs/fitness/review-triggers.yaml");
    let Ok(source) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(parsed) = serde_yaml::from_str::<Value>(&source) else {
        return Vec::new();
    };
    parsed
        .get("review_triggers")
        .and_then(Value::as_sequence)
        .map(|entries| {
            entries
                .iter()
                .filter_map(Value::as_mapping)
                .map(|rule| ReviewTriggerRule {
                    name: rule
                        .get(Value::String("name".to_string()))
                        .and_then(Value::as_str)
                        .unwrap_or("review_trigger")
                        .to_string(),
                    trigger_type: rule
                        .get(Value::String("type".to_string()))
                        .and_then(Value::as_str)
                        .unwrap_or("changed_paths")
                        .to_string(),
                    severity: rule
                        .get(Value::String("severity".to_string()))
                        .and_then(Value::as_str)
                        .unwrap_or("medium")
                        .to_string(),
                    paths: normalize_yaml_string_list(rule.get(Value::String("paths".to_string()))),
                    directories: normalize_yaml_string_list(
                        rule.get(Value::String("directories".to_string())),
                    ),
                    boundaries: rule
                        .get(Value::String("boundaries".to_string()))
                        .and_then(Value::as_mapping)
                        .map(|mapping| {
                            mapping
                                .iter()
                                .filter_map(|(_, value)| {
                                    let paths = normalize_yaml_string_list(Some(value));
                                    (!paths.is_empty()).then_some(paths)
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default(),
                    min_boundaries: normalize_yaml_int(
                        rule.get(Value::String("min_boundaries".to_string())),
                    )
                    .map(|value| value as usize),
                    max_files: normalize_yaml_int(rule.get(Value::String("max_files".to_string())))
                        .map(|value| value as usize),
                    max_added_lines: normalize_yaml_int(
                        rule.get(Value::String("max_added_lines".to_string())),
                    )
                    .map(|value| value as usize),
                    max_deleted_lines: normalize_yaml_int(
                        rule.get(Value::String("max_deleted_lines".to_string())),
                    )
                    .map(|value| value as usize),
                })
                .filter(|rule| {
                    !rule.paths.is_empty()
                        || !rule.directories.is_empty()
                        || !rule.boundaries.is_empty()
                        || rule.max_files.is_some()
                        || rule.max_added_lines.is_some()
                        || rule.max_deleted_lines.is_some()
                })
                .collect()
        })
        .unwrap_or_default()
}

fn normalize_yaml_int(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(number)) => number.as_i64(),
        Some(Value::String(value)) => value.trim().parse::<i64>().ok(),
        _ => None,
    }
}

fn normalize_yaml_string_list(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Sequence(entries)) => entries
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

fn matches_rule_as_container(rule: &ReviewTriggerRule, rel_path: &str) -> bool {
    let prefix = format!("{}/", rel_path.trim_end_matches('/'));
    rule.paths
        .iter()
        .any(|pattern| pattern_starts_with_path(pattern, &prefix) || match_file(rel_path, pattern))
        || rule
            .directories
            .iter()
            .any(|directory| rel_path == directory || prefix.starts_with(&format!("{directory}/")))
}

fn pattern_starts_with_path(pattern: &str, prefix: &str) -> bool {
    let normalized = pattern.trim_start_matches('/').replace('\\', "/");
    normalized.starts_with(prefix)
}

fn matches_review_trigger_rule(rule: &ReviewTriggerRule, rel_path: &str) -> bool {
    rule.paths
        .iter()
        .any(|pattern| match_file(rel_path, pattern))
        || rule.directories.iter().any(|directory| {
            rel_path == directory || rel_path.starts_with(&format!("{directory}/"))
        })
}

fn normalize_pattern(pattern: &str) -> (String, bool) {
    let anchored_to_root = pattern.starts_with('/');
    let trimmed = pattern.trim_start_matches('/');
    (trimmed.replace('\\', "/"), anchored_to_root)
}

fn match_file(file_path: &str, pattern: &str) -> bool {
    let (normalized, anchored_to_root) = normalize_pattern(pattern);
    let is_dir = pattern.ends_with('/');
    let match_pattern = if is_dir {
        format!("{normalized}**")
    } else {
        normalized
    };
    let requires_root_match = anchored_to_root && !match_pattern.contains('/');

    if requires_root_match && file_path.contains('/') {
        return false;
    }

    let dir_variant = if !match_pattern.ends_with("/**") {
        Some(format!("{match_pattern}/**"))
    } else {
        None
    };

    Pattern::new(&match_pattern)
        .map(|p| p.matches(file_path))
        .unwrap_or(false)
        || dir_variant
            .as_deref()
            .and_then(|p| Pattern::new(p).ok())
            .map(|p| p.matches(file_path))
            .unwrap_or(false)
}
