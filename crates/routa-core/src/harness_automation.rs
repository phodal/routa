use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::models::schedule::Schedule;
use serde::{Deserialize, Serialize};

const AUTOMATION_CONFIG_RELATIVE_PATH: &str = "docs/harness/automations.yml";
const FILE_BUDGETS_RELATIVE_PATH: &str = "docs/fitness/file_budgets.json";
const ISSUE_SCANNER_RELATIVE_PATH: &str = ".github/scripts/issue-scanner.py";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessAutomationConfigFile {
    pub relative_path: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessAutomationDefinitionSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source_type: String,
    pub source_label: String,
    pub target_type: String,
    pub target_label: String,
    pub runtime_status: String,
    pub pending_count: usize,
    pub config_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_binding: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron_expr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessAutomationPendingSignal {
    pub id: String,
    pub automation_id: String,
    pub automation_name: String,
    pub signal_type: String,
    pub title: String,
    pub summary: String,
    pub severity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget_limit: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excess_lines: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub defer_until_cron: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessAutomationRecentRun {
    pub automation_id: String,
    pub automation_name: String,
    pub source_type: String,
    pub runtime_binding: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron_expr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessAutomationReport {
    pub generated_at: String,
    pub repo_root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_file: Option<HarnessAutomationConfigFile>,
    pub definitions: Vec<HarnessAutomationDefinitionSummary>,
    pub pending_signals: Vec<HarnessAutomationPendingSignal>,
    pub recent_runs: Vec<HarnessAutomationRecentRun>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AutomationConfigFile {
    schema: Option<String>,
    #[serde(default)]
    definitions: Vec<AutomationDefinitionConfig>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AutomationDefinitionConfig {
    id: Option<String>,
    name: Option<String>,
    description: Option<String>,
    #[serde(default)]
    source: AutomationSourceConfig,
    #[serde(default)]
    target: AutomationTargetConfig,
    #[serde(default)]
    runtime: AutomationRuntimeConfig,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AutomationSourceConfig {
    #[serde(rename = "type")]
    type_field: Option<String>,
    finding_type: Option<String>,
    cron: Option<String>,
    timezone: Option<String>,
    max_items: Option<usize>,
    min_lines: Option<usize>,
    defer_until_cron: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AutomationTargetConfig {
    #[serde(rename = "type")]
    type_field: Option<String>,
    r#ref: Option<String>,
    prompt: Option<String>,
    agent_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AutomationRuntimeConfig {
    schedule_id: Option<String>,
    schedule_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct FileBudgetOverride {
    path: Option<String>,
    max_lines: Option<usize>,
    reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct FileBudgetConfig {
    default_max_lines: Option<usize>,
    include_roots: Option<Vec<String>>,
    extensions: Option<Vec<String>>,
    extension_max_lines: Option<std::collections::HashMap<String, usize>>,
    excluded_parts: Option<Vec<String>>,
    overrides: Option<Vec<FileBudgetOverride>>,
}

#[derive(Debug, Clone)]
struct LongFileFinding {
    relative_path: String,
    line_count: usize,
    budget_limit: usize,
    excess_lines: usize,
    severity: String,
}

#[derive(Debug, Clone, Deserialize)]
struct IssueScannerSuspect {
    file_a: Option<String>,
    file_b: Option<String>,
    reason: Option<String>,
    #[serde(rename = "type")]
    type_field: Option<String>,
}

pub fn detect_repo_automations(
    repo_root: &Path,
    schedules: &[Schedule],
) -> Result<HarnessAutomationReport, String> {
    let mut warnings = Vec::new();
    let (config_file, definitions) = load_automation_config(repo_root, &mut warnings);
    let finding_definitions = definitions
        .iter()
        .filter(|definition| definition.source.type_field.as_deref() == Some("finding"))
        .collect::<Vec<_>>();
    let long_file_findings = if finding_definitions.iter().any(|definition| {
        normalize_string(definition.source.finding_type.as_deref())
            .map(|value| value == "long-file")
            .unwrap_or(true)
    }) {
        detect_long_file_findings(repo_root, &mut warnings)?
    } else {
        Vec::new()
    };
    let issue_scanner_suspects = if finding_definitions.iter().any(|definition| {
        normalize_string(definition.source.finding_type.as_deref()).as_deref()
            == Some("issue-suspect")
    }) {
        detect_issue_scanner_suspects(repo_root, &mut warnings)
    } else {
        Vec::new()
    };

    let mut definition_summaries = Vec::new();
    let mut pending_signals = Vec::new();
    let mut recent_runs = Vec::new();

    for (index, definition) in definitions.iter().enumerate() {
        let Some(id) = normalize_string(definition.id.as_deref()) else {
            warnings.push(format!(
                "Skipping automation definition at index {index}: missing id."
            ));
            continue;
        };
        let source_type = match normalize_source_type(definition.source.type_field.as_deref()) {
            Some(value) => value,
            None => {
                warnings.push(format!(
                    "Skipping automation \"{id}\": unsupported source type \"{}\".",
                    definition.source.type_field.clone().unwrap_or_default()
                ));
                continue;
            }
        };
        let target_type = match normalize_target_type(definition.target.type_field.as_deref()) {
            Some(value) => value,
            None => {
                warnings.push(format!(
                    "Skipping automation \"{id}\": unsupported target type \"{}\".",
                    definition.target.type_field.clone().unwrap_or_default()
                ));
                continue;
            }
        };
        let name = normalize_string(definition.name.as_deref()).unwrap_or_else(|| id.clone());
        let description = normalize_string(definition.description.as_deref()).unwrap_or_default();
        let matched_schedule = if source_type == "schedule" {
            match_runtime_schedule(definition, schedules)
        } else {
            None
        };
        let definition_pending = if source_type == "finding" {
            build_pending_signals(
                definition,
                &id,
                &name,
                &long_file_findings,
                &issue_scanner_suspects,
            )
        } else {
            Vec::new()
        };
        let pending_count = definition_pending.len();
        let runtime_status =
            compute_definition_status(source_type.as_str(), pending_count, matched_schedule);

        if let Some(schedule) = matched_schedule {
            recent_runs.push(HarnessAutomationRecentRun {
                automation_id: id.clone(),
                automation_name: name.clone(),
                source_type: "schedule".to_string(),
                runtime_binding: schedule.name.clone(),
                status: if schedule.enabled {
                    if schedule.next_run_at.is_some() {
                        "active".to_string()
                    } else {
                        "idle".to_string()
                    }
                } else {
                    "paused".to_string()
                },
                cron_expr: Some(schedule.cron_expr.clone()),
                last_run_at: schedule.last_run_at.map(|value| value.to_rfc3339()),
                next_run_at: schedule.next_run_at.map(|value| value.to_rfc3339()),
                last_task_id: schedule.last_task_id.clone(),
            });
        }

        pending_signals.extend(definition_pending);
        definition_summaries.push(HarnessAutomationDefinitionSummary {
            id,
            name,
            description,
            source_type: source_type.clone(),
            source_label: summarize_source(&definition.source, source_type.as_str()),
            target_type: target_type.clone(),
            target_label: summarize_target(&definition.target, target_type.as_str()),
            runtime_status,
            pending_count,
            config_path: AUTOMATION_CONFIG_RELATIVE_PATH.to_string(),
            runtime_binding: resolve_runtime_binding(definition),
            cron_expr: normalize_string(definition.source.cron.as_deref())
                .or_else(|| matched_schedule.map(|schedule| schedule.cron_expr.clone())),
            next_run_at: matched_schedule
                .and_then(|schedule| schedule.next_run_at.map(|v| v.to_rfc3339())),
            last_run_at: matched_schedule
                .and_then(|schedule| schedule.last_run_at.map(|v| v.to_rfc3339())),
        });
    }

    recent_runs.sort_by(|left, right| {
        let right_stamp = right
            .last_run_at
            .as_deref()
            .or(right.next_run_at.as_deref())
            .unwrap_or("");
        let left_stamp = left
            .last_run_at
            .as_deref()
            .or(left.next_run_at.as_deref())
            .unwrap_or("");
        right_stamp.cmp(left_stamp)
    });

    Ok(HarnessAutomationReport {
        generated_at: chrono::Utc::now().to_rfc3339(),
        repo_root: repo_root.display().to_string(),
        config_file,
        definitions: definition_summaries,
        pending_signals,
        recent_runs,
        warnings,
    })
}

fn load_automation_config(
    repo_root: &Path,
    warnings: &mut Vec<String>,
) -> (
    Option<HarnessAutomationConfigFile>,
    Vec<AutomationDefinitionConfig>,
) {
    let absolute_path = repo_root.join(AUTOMATION_CONFIG_RELATIVE_PATH);
    if !absolute_path.exists() {
        warnings.push(format!(
            "No \"{AUTOMATION_CONFIG_RELATIVE_PATH}\" file found for this repository."
        ));
        return (None, Vec::new());
    }

    let Ok(source) = fs::read_to_string(&absolute_path) else {
        warnings.push(format!(
            "Failed to load {AUTOMATION_CONFIG_RELATIVE_PATH}: unable to read file."
        ));
        return (None, Vec::new());
    };

    match serde_yaml::from_str::<AutomationConfigFile>(&source) {
        Ok(parsed) => (
            Some(HarnessAutomationConfigFile {
                relative_path: AUTOMATION_CONFIG_RELATIVE_PATH.to_string(),
                source,
                schema: parsed.schema,
            }),
            parsed.definitions,
        ),
        Err(error) => {
            warnings.push(format!(
                "Failed to load {AUTOMATION_CONFIG_RELATIVE_PATH}: {error}"
            ));
            (None, Vec::new())
        }
    }
}

fn normalize_source_type(value: Option<&str>) -> Option<String> {
    match normalize_string(value) {
        Some(value)
            if matches!(
                value.as_str(),
                "finding" | "schedule" | "review-signal" | "external-event"
            ) =>
        {
            Some(value)
        }
        _ => None,
    }
}

fn normalize_target_type(value: Option<&str>) -> Option<String> {
    match normalize_string(value) {
        Some(value)
            if matches!(
                value.as_str(),
                "specialist" | "workflow" | "background-task"
            ) =>
        {
            Some(value)
        }
        _ => None,
    }
}

fn normalize_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn summarize_source(source: &AutomationSourceConfig, source_type: &str) -> String {
    if source_type == "schedule" {
        let cron =
            normalize_string(source.cron.as_deref()).unwrap_or_else(|| "No cron".to_string());
        return match normalize_string(source.timezone.as_deref()) {
            Some(timezone) => format!("{cron} · {timezone}"),
            None => cron,
        };
    }

    if source_type == "finding" {
        let finding_type = normalize_string(source.finding_type.as_deref())
            .unwrap_or_else(|| "generic".to_string());
        if finding_type == "issue-suspect" {
            return match normalize_string(source.defer_until_cron.as_deref()) {
                Some(window) => format!("issue-suspect · docs/issues scan · defer {window}"),
                None => "issue-suspect · docs/issues scan".to_string(),
            };
        }
        let line_part = source
            .min_lines
            .map(|value| format!(">= {value} lines"))
            .unwrap_or_else(|| "budget overrun".to_string());
        return match normalize_string(source.defer_until_cron.as_deref()) {
            Some(window) => format!("{finding_type} · {line_part} · defer {window}"),
            None => format!("{finding_type} · {line_part}"),
        };
    }

    normalize_string(source.type_field.as_deref()).unwrap_or_else(|| source_type.to_string())
}

fn summarize_target(target: &AutomationTargetConfig, target_type: &str) -> String {
    let suffix = normalize_string(target.r#ref.as_deref())
        .or_else(|| normalize_string(target.agent_id.as_deref()))
        .or_else(|| {
            normalize_string(target.prompt.as_deref()).map(|prompt| {
                let mut clipped = prompt;
                clipped.truncate(72);
                clipped
            })
        })
        .unwrap_or_else(|| "Unbound".to_string());

    match target_type {
        "specialist" => format!("Specialist · {suffix}"),
        "workflow" => format!("Workflow · {suffix}"),
        "background-task" => format!("Background task · {suffix}"),
        _ => suffix,
    }
}

fn resolve_runtime_binding(definition: &AutomationDefinitionConfig) -> Option<String> {
    normalize_string(definition.runtime.schedule_id.as_deref())
        .or_else(|| normalize_string(definition.runtime.schedule_name.as_deref()))
        .or_else(|| normalize_string(definition.name.as_deref()))
        .or_else(|| normalize_string(definition.id.as_deref()))
}

fn match_runtime_schedule<'a>(
    definition: &AutomationDefinitionConfig,
    schedules: &'a [Schedule],
) -> Option<&'a Schedule> {
    let schedule_id = normalize_string(definition.runtime.schedule_id.as_deref());
    let schedule_name = normalize_string(definition.runtime.schedule_name.as_deref());

    schedules.iter().find(|schedule| {
        schedule_id
            .as_ref()
            .map(|candidate| candidate == &schedule.id)
            .unwrap_or(false)
            || schedule_name
                .as_ref()
                .map(|candidate| candidate == &schedule.name)
                .unwrap_or(false)
    })
}

fn build_pending_signals(
    definition: &AutomationDefinitionConfig,
    automation_id: &str,
    automation_name: &str,
    findings: &[LongFileFinding],
    issue_scanner_suspects: &[IssueScannerSuspect],
) -> Vec<HarnessAutomationPendingSignal> {
    if matches!(
        normalize_string(definition.source.finding_type.as_deref()).as_deref(),
        Some("issue-suspect")
    ) {
        let max_items = definition
            .source
            .max_items
            .unwrap_or(issue_scanner_suspects.len());
        let defer_until_cron = normalize_string(definition.source.defer_until_cron.as_deref());
        return issue_scanner_suspects
            .iter()
            .take(max_items)
            .enumerate()
            .map(|(index, suspect)| {
                let primary_file = normalize_string(suspect.file_a.as_deref())
                    .unwrap_or_else(|| format!("suspect-{}.md", index + 1));
                let secondary_file = normalize_string(suspect.file_b.as_deref());
                let reason = normalize_string(suspect.reason.as_deref()).unwrap_or_else(|| {
                    "Issue scanner flagged this item for cleanup review.".to_string()
                });
                let signal_type = normalize_string(suspect.type_field.as_deref())
                    .unwrap_or_else(|| "issue-suspect".to_string());
                HarnessAutomationPendingSignal {
                    id: format!("{automation_id}:{primary_file}:{index}"),
                    automation_id: automation_id.to_string(),
                    automation_name: automation_name.to_string(),
                    signal_type: signal_type.clone(),
                    title: primary_file.clone(),
                    summary: match secondary_file {
                        Some(file_b) => format!("{reason} Compare with {file_b}."),
                        None => reason,
                    },
                    severity: classify_issue_suspect_severity(signal_type.as_str()).to_string(),
                    relative_path: Some(format!("docs/issues/{primary_file}")),
                    line_count: None,
                    budget_limit: None,
                    excess_lines: None,
                    defer_until_cron: defer_until_cron.clone(),
                }
            })
            .collect();
    }

    if matches!(
        normalize_string(definition.source.finding_type.as_deref()).as_deref(),
        Some(value) if value != "long-file"
    ) {
        return Vec::new();
    }

    let min_lines = definition.source.min_lines.unwrap_or(0);
    let max_items = definition.source.max_items.unwrap_or(findings.len());
    let defer_until_cron = normalize_string(definition.source.defer_until_cron.as_deref());

    findings
        .iter()
        .filter(|finding| finding.line_count >= min_lines)
        .take(max_items)
        .map(|finding| HarnessAutomationPendingSignal {
            id: format!("{automation_id}:{}", finding.relative_path),
            automation_id: automation_id.to_string(),
            automation_name: automation_name.to_string(),
            signal_type: "long-file".to_string(),
            title: finding
                .relative_path
                .rsplit('/')
                .next()
                .unwrap_or(&finding.relative_path)
                .to_string(),
            summary: format!(
                "{} lines vs budget {} (+{})",
                finding.line_count, finding.budget_limit, finding.excess_lines
            ),
            severity: finding.severity.clone(),
            relative_path: Some(finding.relative_path.clone()),
            line_count: Some(finding.line_count),
            budget_limit: Some(finding.budget_limit),
            excess_lines: Some(finding.excess_lines),
            defer_until_cron: defer_until_cron.clone(),
        })
        .collect()
}

fn detect_issue_scanner_suspects(
    repo_root: &Path,
    warnings: &mut Vec<String>,
) -> Vec<IssueScannerSuspect> {
    let absolute_path = repo_root.join(ISSUE_SCANNER_RELATIVE_PATH);
    if !absolute_path.exists() {
        warnings.push(format!(
            "Missing {ISSUE_SCANNER_RELATIVE_PATH}; issue cleanup suspects are unavailable."
        ));
        return Vec::new();
    }

    // On Windows `python3` is a Microsoft Store alias that does not work
    // with Command::new; fall back to `python`.
    let python_bin = if cfg!(windows) { "python" } else { "python3" };
    let output = match Command::new(python_bin)
        .arg(&absolute_path)
        .arg("--suspects-only")
        .current_dir(repo_root)
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            warnings.push(format!(
                "Failed to run {ISSUE_SCANNER_RELATIVE_PATH} --suspects-only: {error}"
            ));
            return Vec::new();
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        warnings.push(format!(
            "Failed to run {ISSUE_SCANNER_RELATIVE_PATH} --suspects-only: {}",
            if stderr.is_empty() {
                format!("exit status {}", output.status)
            } else {
                stderr
            }
        ));
        return Vec::new();
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() || stdout == "No suspects found." {
        return Vec::new();
    }

    match serde_json::from_str::<Vec<IssueScannerSuspect>>(&stdout) {
        Ok(suspects) => suspects,
        Err(error) => {
            warnings.push(format!(
                "Unexpected output from {ISSUE_SCANNER_RELATIVE_PATH} --suspects-only: {error}"
            ));
            Vec::new()
        }
    }
}

fn compute_definition_status(
    source_type: &str,
    pending_count: usize,
    schedule: Option<&Schedule>,
) -> String {
    if source_type == "finding" {
        return if pending_count > 0 {
            "pending".to_string()
        } else {
            "clear".to_string()
        };
    }

    match schedule {
        None => "definition-only".to_string(),
        Some(schedule) if !schedule.enabled => "paused".to_string(),
        Some(schedule) if schedule.next_run_at.is_some() => "active".to_string(),
        Some(_) => "idle".to_string(),
    }
}

fn detect_long_file_findings(
    repo_root: &Path,
    warnings: &mut Vec<String>,
) -> Result<Vec<LongFileFinding>, String> {
    let budgets = load_file_budgets(repo_root, warnings);
    let include_roots = budgets
        .include_roots
        .clone()
        .unwrap_or_else(|| vec!["src".to_string(), "apps".to_string(), "crates".to_string()]);
    let extensions = budgets
        .extensions
        .clone()
        .unwrap_or_else(|| vec![".ts".to_string(), ".tsx".to_string(), ".rs".to_string()]);
    let excluded_parts = budgets.excluded_parts.clone().unwrap_or_else(|| {
        vec![
            "/node_modules/".to_string(),
            "/target/".to_string(),
            "/.next/".to_string(),
            "/_next/".to_string(),
            "/bundled/".to_string(),
        ]
    });
    let extension_max_lines = budgets.extension_max_lines.clone().unwrap_or_default();
    let default_max_lines = budgets.default_max_lines.unwrap_or(1600);
    let overrides = budgets.overrides.clone().unwrap_or_default();

    let mut candidates = Vec::new();
    for root in include_roots {
        let absolute_root = repo_root.join(&root);
        if absolute_root.is_dir() {
            walk_files(&absolute_root, &mut candidates);
        }
    }

    let mut findings = Vec::new();
    for absolute_path in candidates {
        let relative_path = absolute_path
            .strip_prefix(repo_root)
            .unwrap_or(&absolute_path)
            .to_string_lossy()
            .replace('\\', "/");
        let extension = Path::new(&relative_path)
            .extension()
            .map(|value| format!(".{}", value.to_string_lossy().to_lowercase()))
            .unwrap_or_default();
        if !extensions.iter().any(|candidate| candidate == &extension) {
            continue;
        }
        if !excluded_parts
            .iter()
            .all(|excluded| !relative_path.contains(excluded))
        {
            continue;
        }

        let Ok(source) = fs::read_to_string(&absolute_path) else {
            continue;
        };
        let line_count = count_lines(&source);
        let (budget_limit, _reason) = resolve_budget(
            &relative_path,
            &extension,
            default_max_lines,
            &extension_max_lines,
            &overrides,
        );
        if line_count <= budget_limit {
            continue;
        }
        let excess_lines = line_count.saturating_sub(budget_limit);
        findings.push(LongFileFinding {
            relative_path,
            line_count,
            budget_limit,
            excess_lines,
            severity: classify_severity(excess_lines).to_string(),
        });
    }

    findings.sort_by(|left, right| {
        right
            .excess_lines
            .cmp(&left.excess_lines)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    Ok(findings)
}

fn load_file_budgets(repo_root: &Path, warnings: &mut Vec<String>) -> FileBudgetConfig {
    let absolute_path = repo_root.join(FILE_BUDGETS_RELATIVE_PATH);
    if !absolute_path.exists() {
        warnings.push(format!(
            "Missing {FILE_BUDGETS_RELATIVE_PATH}; using default long-file budget thresholds."
        ));
        return FileBudgetConfig {
            default_max_lines: Some(1600),
            include_roots: Some(vec![
                "src".to_string(),
                "apps".to_string(),
                "crates".to_string(),
            ]),
            extensions: Some(vec![
                ".ts".to_string(),
                ".tsx".to_string(),
                ".rs".to_string(),
            ]),
            extension_max_lines: Some(
                [
                    (".rs".to_string(), 1600),
                    (".ts".to_string(), 1600),
                    (".tsx".to_string(), 1600),
                ]
                .into_iter()
                .collect(),
            ),
            excluded_parts: Some(vec![
                "/node_modules/".to_string(),
                "/target/".to_string(),
                "/.next/".to_string(),
                "/_next/".to_string(),
                "/bundled/".to_string(),
            ]),
            overrides: Some(Vec::new()),
        };
    }

    match fs::read_to_string(&absolute_path)
        .ok()
        .and_then(|source| serde_json::from_str::<FileBudgetConfig>(&source).ok())
    {
        Some(config) => config,
        None => {
            warnings.push(format!(
                "Failed to parse {FILE_BUDGETS_RELATIVE_PATH}; using default long-file budget thresholds."
            ));
            FileBudgetConfig {
                default_max_lines: Some(1600),
                include_roots: Some(vec![
                    "src".to_string(),
                    "apps".to_string(),
                    "crates".to_string(),
                ]),
                extensions: Some(vec![
                    ".ts".to_string(),
                    ".tsx".to_string(),
                    ".rs".to_string(),
                ]),
                extension_max_lines: Some(
                    [
                        (".rs".to_string(), 1600),
                        (".ts".to_string(), 1600),
                        (".tsx".to_string(), 1600),
                    ]
                    .into_iter()
                    .collect(),
                ),
                excluded_parts: Some(vec![
                    "/node_modules/".to_string(),
                    "/target/".to_string(),
                    "/.next/".to_string(),
                    "/_next/".to_string(),
                    "/bundled/".to_string(),
                ]),
                overrides: Some(Vec::new()),
            }
        }
    }
}

fn walk_files(dir: &Path, collected: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_files(&path, collected);
        } else if path.is_file() {
            collected.push(path);
        }
    }
}

fn resolve_budget(
    relative_path: &str,
    extension: &str,
    default_max_lines: usize,
    extension_max_lines: &std::collections::HashMap<String, usize>,
    overrides: &[FileBudgetOverride],
) -> (usize, Option<String>) {
    if let Some(override_entry) = overrides.iter().find(|candidate| {
        candidate
            .path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value == relative_path)
            .unwrap_or(false)
    }) {
        if let Some(max_lines) = override_entry.max_lines {
            return (max_lines, override_entry.reason.clone());
        }
    }

    (
        extension_max_lines
            .get(extension)
            .copied()
            .unwrap_or(default_max_lines),
        None,
    )
}

fn classify_severity(excess_lines: usize) -> &'static str {
    if excess_lines >= 250 {
        "high"
    } else if excess_lines >= 100 {
        "medium"
    } else {
        "low"
    }
}

fn classify_issue_suspect_severity(signal_type: &str) -> &'static str {
    match signal_type {
        "stale" => "high",
        "duplicate" => "medium",
        "open_check" => "low",
        _ => "medium",
    }
}

fn count_lines(source: &str) -> usize {
    if source.is_empty() {
        0
    } else {
        source.lines().count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use tempfile::tempdir;

    #[test]
    fn detects_repo_automations_and_runtime_schedule_state() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_root = temp_dir.path();

        fs::create_dir_all(repo_root.join("docs/harness")).expect("docs/harness");
        fs::create_dir_all(repo_root.join("docs/fitness")).expect("docs/fitness");
        fs::create_dir_all(repo_root.join("src")).expect("src");
        fs::write(
            repo_root.join("docs/harness/automations.yml"),
            [
                "schema: harness-automation-v1",
                "definitions:",
                "  - id: long-file-window",
                "    name: Long-file window",
                "    source:",
                "      type: finding",
                "      findingType: long-file",
                "      maxItems: 1",
                "      deferUntilCron: \"0 10 * * 1\"",
                "    target:",
                "      type: workflow",
                "      ref: refactor-window",
                "  - id: weekly-harness-fluency",
                "    name: Weekly harness fluency",
                "    source:",
                "      type: schedule",
                "      cron: \"0 3 * * 1\"",
                "      timezone: UTC",
                "    target:",
                "      type: specialist",
                "      ref: harness-test",
                "    runtime:",
                "      scheduleName: Weekly harness fluency",
            ]
            .join("\n"),
        )
        .expect("automations config");
        fs::write(
            repo_root.join("docs/fitness/file_budgets.json"),
            r#"{
  "default_max_lines": 20,
  "include_roots": ["src"],
  "extensions": [".ts"],
  "extension_max_lines": { ".ts": 20 },
  "excluded_parts": [],
  "overrides": []
}"#,
        )
        .expect("file budgets");
        fs::write(
            repo_root.join("src/oversized.ts"),
            vec!["export const x = 1;"; 35].join("\n"),
        )
        .expect("oversized file");

        let schedule = Schedule {
            id: "schedule-1".to_string(),
            name: "Weekly harness fluency".to_string(),
            cron_expr: "0 3 * * 1".to_string(),
            task_prompt: "Run harness fluency".to_string(),
            agent_id: "claude-code".to_string(),
            workspace_id: "default".to_string(),
            enabled: true,
            last_run_at: Some(Utc::now()),
            next_run_at: Some(Utc::now()),
            last_task_id: Some("task-1".to_string()),
            prompt_template: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let report = detect_repo_automations(repo_root, &[schedule]).expect("report");
        assert_eq!(report.definitions.len(), 2);
        assert_eq!(report.pending_signals.len(), 1);
        assert_eq!(report.pending_signals[0].automation_id, "long-file-window");
        assert_eq!(report.recent_runs.len(), 1);
        assert_eq!(
            report.recent_runs[0].automation_id,
            "weekly-harness-fluency"
        );
        assert_eq!(report.recent_runs[0].status, "active");
    }

    #[test]
    fn surfaces_issue_gc_suspects_as_pending_signals() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_root = temp_dir.path();

        fs::create_dir_all(repo_root.join("docs/harness")).expect("docs/harness");
        fs::create_dir_all(repo_root.join(".github/scripts")).expect(".github/scripts");
        fs::write(
            repo_root.join("docs/harness/automations.yml"),
            [
                "schema: harness-automation-v1",
                "definitions:",
                "  - id: issue-gc-review",
                "    name: Issue cleanup review",
                "    source:",
                "      type: finding",
                "      findingType: issue-suspect",
                "      maxItems: 2",
                "      deferUntilCron: \"0 9 * * 1\"",
                "    target:",
                "      type: workflow",
                "      ref: issue-garbage-collector",
            ]
            .join("\n"),
        )
        .expect("automations config");
        fs::write(
            repo_root.join(".github/scripts/issue-scanner.py"),
            [
                "import json",
                "print(json.dumps([",
                "  {'file_a': '2026-04-01-old-bug.md', 'file_b': None, 'reason': 'Open for 35 days (>30), likely stale', 'type': 'stale'},",
                "  {'file_a': '2026-04-02-dup-a.md', 'file_b': '2026-04-02-dup-b.md', 'reason': \"Same area 'ui', keywords: {'layout', 'panel'}\", 'type': 'duplicate'}",
                "]))",
            ]
            .join("\n"),
        )
        .expect("scanner script");

        let report = detect_repo_automations(repo_root, &[]).expect("report");
        assert_eq!(report.definitions.len(), 1);
        assert_eq!(report.definitions[0].runtime_status, "pending");
        assert_eq!(report.definitions[0].pending_count, 2);
        assert_eq!(
            report.definitions[0].source_label,
            "issue-suspect · docs/issues scan · defer 0 9 * * 1"
        );
        assert_eq!(report.pending_signals.len(), 2);
        assert_eq!(report.pending_signals[0].signal_type, "stale");
        assert_eq!(report.pending_signals[0].severity, "high");
        assert_eq!(
            report.pending_signals[0].relative_path.as_deref(),
            Some("docs/issues/2026-04-01-old-bug.md")
        );
        assert_eq!(report.pending_signals[1].signal_type, "duplicate");
        assert_eq!(report.pending_signals[1].severity, "medium");
    }
}
