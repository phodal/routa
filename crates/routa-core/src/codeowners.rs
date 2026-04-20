use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;

use crate::git::git_command;
use glob::Pattern;
use serde::Serialize;
use serde_yaml::Value;

#[cfg(test)]
use std::process::Command;

const CODEOWNERS_CANDIDATES: &[&str] = &[".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

const SENSITIVE_PATH_PREFIXES: &[&str] = &[
    "src/core/acp/",
    "src/core/orchestration/",
    "crates/routa-server/src/api/",
];

const SENSITIVE_FILES: &[&str] = &[
    "api-contract.yaml",
    "docs/fitness/manifest.yaml",
    "docs/fitness/review-triggers.yaml",
    ".github/workflows/defense.yaml",
];

const MAX_REPORT_FILES: usize = 50;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeownersOwner {
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeownersRule {
    pub pattern: String,
    pub owners: Vec<CodeownersOwner>,
    pub line: usize,
    pub precedence: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleResponse {
    pub pattern: String,
    pub owners: Vec<String>,
    pub line: usize,
    pub precedence: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerGroupSummary {
    pub name: String,
    pub kind: String,
    pub matched_file_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverageReport {
    pub unowned_files: Vec<String>,
    pub overlapping_files: Vec<String>,
    pub sensitive_unowned_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerOwnershipCorrelation {
    pub trigger_name: String,
    pub severity: String,
    pub action: String,
    pub owner_groups: Vec<String>,
    pub owner_group_count: usize,
    pub touched_file_count: usize,
    pub unowned_paths: Vec<String>,
    pub overlapping_paths: Vec<String>,
    pub spans_multiple_owner_groups: bool,
    pub has_ownership_gap: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeownersTriggerHotspot {
    pub trigger_name: String,
    pub reason: String,
    pub sample_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeownersCorrelationReport {
    pub review_trigger_file: Option<String>,
    pub trigger_correlations: Vec<TriggerOwnershipCorrelation>,
    pub hotspots: Vec<CodeownersTriggerHotspot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeownersResponse {
    pub generated_at: String,
    pub repo_root: String,
    pub codeowners_file: Option<String>,
    pub owners: Vec<OwnerGroupSummary>,
    pub rules: Vec<RuleResponse>,
    pub coverage: CoverageReport,
    pub correlation: CodeownersCorrelationReport,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct ReviewTriggerBoundary {
    paths: Vec<String>,
}

#[derive(Debug, Clone)]
struct ReviewTriggerRule {
    name: String,
    severity: String,
    action: String,
    paths: Vec<String>,
    boundaries: Vec<ReviewTriggerBoundary>,
    directories: Vec<String>,
}

#[derive(Debug, Clone)]
struct OwnershipRoutingContext {
    trigger_correlations: Vec<TriggerOwnershipCorrelation>,
}

fn classify_owner(raw: &str) -> CodeownersOwner {
    let trimmed = raw.trim();
    let kind = if trimmed.contains('@') && trimmed.contains('/') {
        "team"
    } else if trimmed.contains('@') && trimmed.contains('.') {
        "email"
    } else {
        "user"
    };
    CodeownersOwner {
        name: trimmed.to_string(),
        kind: kind.to_string(),
    }
}

pub fn parse_codeowners_content(content: &str) -> (Vec<CodeownersRule>, Vec<String>) {
    let mut rules = Vec::new();
    let mut warnings = Vec::new();

    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let tokens: Vec<&str> = trimmed.split_whitespace().collect();
        if tokens.len() < 2 {
            warnings.push(format!(
                "Line {}: pattern without owners — \"{}\"",
                i + 1,
                trimmed
            ));
            continue;
        }

        let pattern = tokens[0].to_string();
        let owners: Vec<CodeownersOwner> = tokens[1..].iter().map(|t| classify_owner(t)).collect();
        let precedence = rules.len();

        rules.push(CodeownersRule {
            pattern,
            owners,
            line: i + 1,
            precedence,
        });
    }

    (rules, warnings)
}

fn normalize_pattern(pattern: &str) -> (String, bool) {
    let anchored_to_root = pattern.starts_with('/');
    let normalized = if let Some(stripped) = pattern.strip_prefix('/') {
        stripped.to_string()
    } else {
        pattern.to_string()
    };

    if !anchored_to_root && !normalized.contains('/') {
        (format!("**/{normalized}"), anchored_to_root)
    } else {
        (normalized, anchored_to_root)
    }
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

fn best_matching_rule(file_path: &str, rules: &[CodeownersRule]) -> Option<usize> {
    let mut best: Option<usize> = None;
    for (i, rule) in rules.iter().enumerate() {
        if match_file(file_path, &rule.pattern) {
            match best {
                Some(prev) if rules[prev].precedence < rule.precedence => best = Some(i),
                None => best = Some(i),
                _ => {}
            }
        }
    }
    best
}

fn count_matching_rules(file_path: &str, rules: &[CodeownersRule]) -> usize {
    rules
        .iter()
        .filter(|rule| match_file(file_path, &rule.pattern))
        .count()
}

fn is_sensitive(file_path: &str) -> bool {
    SENSITIVE_PATH_PREFIXES
        .iter()
        .any(|prefix| file_path.starts_with(prefix))
        || SENSITIVE_FILES.contains(&file_path)
}

fn normalize_yaml_string_list(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::String(value)) if !value.trim().is_empty() => vec![value.to_string()],
        Some(Value::Sequence(values)) => values
            .iter()
            .filter_map(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(ToString::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

fn normalize_yaml_int(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(number)) => number.as_i64(),
        Some(Value::String(value)) => value.trim().parse::<i64>().ok(),
        _ => None,
    }
}

fn parse_review_trigger_rules(repo_root: &Path) -> (Option<String>, Vec<ReviewTriggerRule>) {
    let relative_path = "docs/fitness/review-triggers.yaml";
    let full_path = repo_root.join(relative_path);
    if !full_path.is_file() {
        return (None, Vec::new());
    }

    let Ok(source) = std::fs::read_to_string(full_path) else {
        return (Some(relative_path.to_string()), Vec::new());
    };
    let Ok(parsed) = serde_yaml::from_str::<Value>(&source) else {
        return (Some(relative_path.to_string()), Vec::new());
    };

    let rules = parsed
        .get("review_triggers")
        .and_then(Value::as_sequence)
        .map(|entries| {
            entries
                .iter()
                .filter_map(Value::as_mapping)
                .map(|rule| {
                    let boundaries = rule
                        .get(Value::String("boundaries".to_string()))
                        .and_then(Value::as_mapping)
                        .map(|mapping| {
                            mapping
                                .iter()
                                .filter_map(|(_, value)| {
                                    let paths = normalize_yaml_string_list(Some(value));
                                    if paths.is_empty() {
                                        None
                                    } else {
                                        Some(ReviewTriggerBoundary { paths })
                                    }
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();

                    let _ =
                        normalize_yaml_int(rule.get(Value::String("min_boundaries".to_string())));
                    let _ = normalize_yaml_int(rule.get(Value::String("max_files".to_string())));
                    let _ =
                        normalize_yaml_int(rule.get(Value::String("max_added_lines".to_string())));
                    let _ = normalize_yaml_int(
                        rule.get(Value::String("max_deleted_lines".to_string())),
                    );

                    ReviewTriggerRule {
                        name: rule
                            .get(Value::String("name".to_string()))
                            .and_then(Value::as_str)
                            .unwrap_or("unknown")
                            .to_string(),
                        severity: rule
                            .get(Value::String("severity".to_string()))
                            .and_then(Value::as_str)
                            .unwrap_or("medium")
                            .to_string(),
                        action: rule
                            .get(Value::String("action".to_string()))
                            .and_then(Value::as_str)
                            .unwrap_or("require_human_review")
                            .to_string(),
                        paths: normalize_yaml_string_list(
                            rule.get(Value::String("paths".to_string())),
                        ),
                        boundaries,
                        directories: normalize_yaml_string_list(
                            rule.get(Value::String("directories".to_string())),
                        ),
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    (Some(relative_path.to_string()), rules)
}

fn match_review_trigger_files(rule: &ReviewTriggerRule, file_paths: &[String]) -> Vec<String> {
    let mut matched = BTreeSet::new();
    for file_path in file_paths {
        let matches_pattern = rule
            .paths
            .iter()
            .chain(
                rule.boundaries
                    .iter()
                    .flat_map(|boundary| boundary.paths.iter()),
            )
            .any(|pattern| match_file(file_path, pattern));
        let matches_directory = rule.directories.iter().any(|directory| {
            file_path == directory || file_path.starts_with(&format!("{directory}/"))
        });

        if matches_pattern || matches_directory {
            matched.insert(file_path.clone());
        }
    }

    matched.into_iter().collect()
}

fn unique_sorted(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn build_ownership_routing_context(
    changed_files: &[String],
    rules: &[CodeownersRule],
    trigger_rules: &[ReviewTriggerRule],
    matched_trigger_names: Option<&HashSet<String>>,
) -> OwnershipRoutingContext {
    let changed_files = unique_sorted(changed_files.to_vec());
    let mut owners_by_file: HashMap<String, Vec<String>> = HashMap::new();

    for file in &changed_files {
        match best_matching_rule(file, rules) {
            Some(idx) => {
                let owners = rules[idx]
                    .owners
                    .iter()
                    .map(|owner| owner.name.clone())
                    .collect::<Vec<_>>();
                owners_by_file.insert(file.clone(), owners);
            }
            None => {
                owners_by_file.insert(file.clone(), Vec::new());
            }
        }
    }

    let relevant_trigger_rules = trigger_rules
        .iter()
        .filter(|rule| {
            matched_trigger_names
                .map(|names| names.contains(&rule.name))
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();

    let trigger_correlations = relevant_trigger_rules
        .into_iter()
        .filter_map(|rule| {
            let touched_files = match_review_trigger_files(rule, &changed_files);
            if touched_files.is_empty() {
                return None;
            }

            let owner_groups = unique_sorted(
                touched_files
                    .iter()
                    .flat_map(|file| owners_by_file.get(file).cloned().unwrap_or_default())
                    .collect(),
            );
            let unowned_paths = unique_sorted(
                touched_files
                    .iter()
                    .filter(|file| {
                        owners_by_file
                            .get(*file)
                            .is_some_and(|owners| owners.is_empty())
                    })
                    .cloned()
                    .collect(),
            );
            let overlapping_paths = unique_sorted(
                touched_files
                    .iter()
                    .filter(|file| count_matching_rules(file, rules) > 1)
                    .cloned()
                    .collect(),
            );

            Some(TriggerOwnershipCorrelation {
                trigger_name: rule.name.clone(),
                severity: rule.severity.clone(),
                action: rule.action.clone(),
                owner_groups: owner_groups.clone(),
                owner_group_count: owner_groups.len(),
                touched_file_count: touched_files.len(),
                unowned_paths: unowned_paths.clone(),
                overlapping_paths: overlapping_paths.clone(),
                spans_multiple_owner_groups: owner_groups.len() > 1,
                has_ownership_gap: !unowned_paths.is_empty(),
            })
        })
        .collect::<Vec<_>>();

    OwnershipRoutingContext {
        trigger_correlations,
    }
}

fn build_codeowners_correlation_report(
    tracked_files: &[String],
    rules: &[CodeownersRule],
    review_trigger_file: Option<String>,
    trigger_rules: &[ReviewTriggerRule],
) -> CodeownersCorrelationReport {
    let routing = build_ownership_routing_context(tracked_files, rules, trigger_rules, None);
    let hotspots = routing
        .trigger_correlations
        .iter()
        .flat_map(|correlation| {
            let mut entries = Vec::new();
            if correlation.has_ownership_gap {
                entries.push(CodeownersTriggerHotspot {
                    trigger_name: correlation.trigger_name.clone(),
                    reason: "Trigger-covered paths have no explicit owner coverage.".to_string(),
                    sample_paths: correlation.unowned_paths.iter().take(5).cloned().collect(),
                });
            }
            if correlation.spans_multiple_owner_groups {
                entries.push(CodeownersTriggerHotspot {
                    trigger_name: correlation.trigger_name.clone(),
                    reason: "Trigger spans multiple owner groups and may need cross-team review routing.".to_string(),
                    sample_paths: correlation.overlapping_paths.iter().take(5).cloned().collect(),
                });
            }
            if !correlation.overlapping_paths.is_empty() {
                entries.push(CodeownersTriggerHotspot {
                    trigger_name: correlation.trigger_name.clone(),
                    reason: "Trigger touches overlapping ownership rules that should be shown explicitly.".to_string(),
                    sample_paths: correlation.overlapping_paths.iter().take(5).cloned().collect(),
                });
            }
            entries
        })
        .collect();

    CodeownersCorrelationReport {
        review_trigger_file,
        trigger_correlations: routing.trigger_correlations,
        hotspots,
    }
}

fn collect_tracked_files(repo_root: &Path, warnings: &mut Vec<String>) -> Vec<String> {
    let output = git_command()
        .args(["ls-files"])
        .current_dir(repo_root)
        .output();

    match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout
                .lines()
                .filter(|line| !line.is_empty())
                .map(ToString::to_string)
                .collect()
        }
        _ => {
            warnings.push(
                "Failed to list git-tracked files. Coverage analysis may be incomplete."
                    .to_string(),
            );
            Vec::new()
        }
    }
}

pub fn detect_codeowners(repo_root: &Path) -> Result<CodeownersResponse, String> {
    let mut warnings = Vec::new();

    let codeowners_file = CODEOWNERS_CANDIDATES
        .iter()
        .find(|candidate| repo_root.join(candidate).is_file())
        .map(|s| s.to_string());

    let Some(ref codeowners_path) = codeowners_file else {
        return Ok(CodeownersResponse {
            generated_at: chrono::Utc::now().to_rfc3339(),
            repo_root: repo_root.display().to_string(),
            codeowners_file: None,
            owners: Vec::new(),
            rules: Vec::new(),
            coverage: CoverageReport {
                unowned_files: Vec::new(),
                overlapping_files: Vec::new(),
                sensitive_unowned_files: Vec::new(),
            },
            correlation: CodeownersCorrelationReport {
                review_trigger_file: None,
                trigger_correlations: Vec::new(),
                hotspots: Vec::new(),
            },
            warnings: vec![format!(
                "No CODEOWNERS file found. Checked: {}",
                CODEOWNERS_CANDIDATES.join(", ")
            )],
        });
    };

    let content = std::fs::read_to_string(repo_root.join(codeowners_path))
        .map_err(|e| format!("Failed to read {codeowners_path}: {e}"))?;

    let (rules, parse_warnings) = parse_codeowners_content(&content);
    warnings.extend(parse_warnings);

    let tracked_files = collect_tracked_files(repo_root, &mut warnings);
    let (review_trigger_file, review_trigger_rules) = parse_review_trigger_rules(repo_root);

    let mut owner_counts: HashMap<String, (String, usize)> = HashMap::new();
    let mut unowned_files = Vec::new();
    let mut overlapping_files = Vec::new();
    let mut sensitive_unowned_files = Vec::new();

    for file in &tracked_files {
        let matching_count = count_matching_rules(file, &rules);
        let best = best_matching_rule(file, &rules);

        if matching_count > 1 {
            overlapping_files.push(file.clone());
        }

        match best {
            Some(idx) => {
                for owner in &rules[idx].owners {
                    let entry = owner_counts
                        .entry(owner.name.clone())
                        .or_insert_with(|| (owner.kind.clone(), 0));
                    entry.1 += 1;
                }
            }
            None => {
                unowned_files.push(file.clone());
                if is_sensitive(file) {
                    sensitive_unowned_files.push(file.clone());
                }
            }
        }
    }

    let mut owner_groups: Vec<OwnerGroupSummary> = owner_counts
        .into_iter()
        .map(|(name, (kind, count))| OwnerGroupSummary {
            name,
            kind,
            matched_file_count: count,
        })
        .collect();
    owner_groups.sort_by(|a, b| b.matched_file_count.cmp(&a.matched_file_count));

    let rule_responses: Vec<RuleResponse> = rules
        .iter()
        .map(|r| RuleResponse {
            pattern: r.pattern.clone(),
            owners: r.owners.iter().map(|o| o.name.clone()).collect(),
            line: r.line,
            precedence: r.precedence,
        })
        .collect();

    Ok(CodeownersResponse {
        generated_at: chrono::Utc::now().to_rfc3339(),
        repo_root: repo_root.display().to_string(),
        codeowners_file,
        owners: owner_groups,
        rules: rule_responses,
        coverage: CoverageReport {
            unowned_files: unowned_files.into_iter().take(MAX_REPORT_FILES).collect(),
            overlapping_files: overlapping_files
                .into_iter()
                .take(MAX_REPORT_FILES)
                .collect(),
            sensitive_unowned_files,
        },
        correlation: build_codeowners_correlation_report(
            &tracked_files,
            &rules,
            review_trigger_file,
            &review_trigger_rules,
        ),
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_codeowners() {
        let content = "# Comment\n\n*.js @frontend-team\nsrc/core/** @arch-team @platform-team\n";
        let (rules, warnings) = parse_codeowners_content(content);
        assert!(warnings.is_empty());
        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0].pattern, "*.js");
        assert_eq!(rules[0].owners.len(), 1);
        assert_eq!(rules[0].owners[0].name, "@frontend-team");
        assert_eq!(rules[1].pattern, "src/core/**");
        assert_eq!(rules[1].owners.len(), 2);
    }

    #[test]
    fn classifies_owner_kinds() {
        let team = classify_owner("@org/team");
        assert_eq!(team.kind, "team");

        let user = classify_owner("@username");
        assert_eq!(user.kind, "user");

        let email = classify_owner("user@example.com");
        assert_eq!(email.kind, "email");
    }

    #[test]
    fn matches_glob_patterns() {
        assert!(match_file("src/core/acp/handler.ts", "src/core/**"));
        assert!(match_file("lib/utils.js", "*.js"));
        assert!(!match_file("lib/utils.ts", "*.js"));
        assert!(match_file("docs/README.md", "docs/"));
        assert!(match_file("README.md", "/README.md"));
        assert!(!match_file("docs/README.md", "/README.md"));
    }

    #[test]
    fn higher_precedence_wins() {
        let content = "* @default-team\nsrc/core/** @arch-team\n";
        let (rules, _) = parse_codeowners_content(content);
        let best = best_matching_rule("src/core/handler.ts", &rules);
        assert_eq!(best, Some(1));
        assert_eq!(rules[best.unwrap()].owners[0].name, "@arch-team");
    }

    #[test]
    fn warns_on_pattern_without_owners() {
        let content = "src/core/**\n";
        let (rules, warnings) = parse_codeowners_content(content);
        assert_eq!(rules.len(), 0);
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("pattern without owners"));
    }

    #[test]
    fn detects_overlap() {
        let content = "*.ts @ts-team\nsrc/** @src-team\n";
        let (rules, _) = parse_codeowners_content(content);
        let count = count_matching_rules("src/handler.ts", &rules);
        assert_eq!(count, 2);
    }

    #[test]
    fn root_anchored_basenames_do_not_overlap_nested_files() {
        let content = "/package.json @root\npackages/** @packages\n";
        let (rules, _) = parse_codeowners_content(content);

        assert_eq!(
            count_matching_rules("packages/routa-cli/package.json", &rules),
            1
        );
        assert_eq!(count_matching_rules("package.json", &rules), 1);
        assert_eq!(
            best_matching_rule("packages/routa-cli/package.json", &rules),
            Some(1)
        );
        assert_eq!(best_matching_rule("package.json", &rules), Some(0));
    }

    #[test]
    fn missing_codeowners_returns_warning() {
        let temp = tempfile::tempdir().unwrap();
        let result = detect_codeowners(temp.path()).unwrap();
        assert!(result.codeowners_file.is_none());
        assert!(!result.warnings.is_empty());
        assert!(result.warnings[0].contains("No CODEOWNERS file found"));
    }

    #[test]
    fn detects_codeowners_from_github_dir() {
        let temp = tempfile::tempdir().unwrap();
        let github_dir = temp.path().join(".github");
        std::fs::create_dir_all(&github_dir).unwrap();
        std::fs::write(github_dir.join("CODEOWNERS"), "src/** @dev-team\n").unwrap();

        Command::new("git")
            .args(["init", "--no-bare"])
            .current_dir(temp.path())
            .output()
            .unwrap();

        std::fs::write(temp.path().join("src").join("..").join("test.txt"), "x").ok();

        let result = detect_codeowners(temp.path()).unwrap();
        assert_eq!(
            result.codeowners_file.as_deref(),
            Some(".github/CODEOWNERS")
        );
        assert_eq!(result.rules.len(), 1);
    }

    #[test]
    fn builds_trigger_correlation_report() {
        let temp = tempfile::tempdir().unwrap();
        let github_dir = temp.path().join(".github");
        let docs_fitness_dir = temp.path().join("docs").join("fitness");
        std::fs::create_dir_all(&github_dir).unwrap();
        std::fs::create_dir_all(temp.path().join("src").join("core")).unwrap();
        std::fs::create_dir_all(
            temp.path()
                .join("crates")
                .join("routa-server")
                .join("src")
                .join("api"),
        )
        .unwrap();
        std::fs::create_dir_all(&docs_fitness_dir).unwrap();

        std::fs::write(
            github_dir.join("CODEOWNERS"),
            "src/** @web-team\ncrates/** @rust-team\n",
        )
        .unwrap();
        std::fs::write(temp.path().join("src").join("core").join("review.ts"), "x").unwrap();
        std::fs::write(
            temp.path()
                .join("crates")
                .join("routa-server")
                .join("src")
                .join("api")
                .join("handler.rs"),
            "x",
        )
        .unwrap();
        std::fs::write(temp.path().join("api-contract.yaml"), "openapi: 3.0.0").unwrap();
        std::fs::write(
            docs_fitness_dir.join("review-triggers.yaml"),
            [
                "review_triggers:",
                "  - name: cross_boundary_change_web_rust",
                "    type: cross_boundary_change",
                "    severity: medium",
                "    action: require_human_review",
                "    boundaries:",
                "      web:",
                "        - src/**",
                "      rust:",
                "        - crates/**",
                "  - name: sensitive_contract_or_governance_change",
                "    type: sensitive_file_change",
                "    severity: high",
                "    action: require_human_review",
                "    paths:",
                "      - api-contract.yaml",
            ]
            .join("\n"),
        )
        .unwrap();

        Command::new("git")
            .args(["init", "--no-bare"])
            .current_dir(temp.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(temp.path())
            .output()
            .unwrap();

        let result = detect_codeowners(temp.path()).unwrap();
        assert_eq!(
            result.correlation.review_trigger_file.as_deref(),
            Some("docs/fitness/review-triggers.yaml")
        );
        assert!(!result.correlation.trigger_correlations.is_empty());
        assert!(result
            .correlation
            .trigger_correlations
            .iter()
            .any(|correlation| correlation.trigger_name == "cross_boundary_change_web_rust"));
    }
}
