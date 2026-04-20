use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::Local;
use serde::Deserialize;

pub(crate) const JOURNEY_EVALUATOR_ID: &str = "ui-journey-evaluator";
pub(crate) const DEFAULT_SCENARIO_ID: &str = "unknown-scenario";
pub(crate) const DEFAULT_BASE_URL: &str = "http://localhost:3000";
pub(crate) const DEFAULT_ARTIFACT_DIR: &str = "artifacts/ui-journey";
const DEFAULT_EXECUTION_BUDGET_MS: u64 = 240_000;
const RESULT_PAYLOAD_START: &str = "<ui-journey-artifact>";
const RESULT_PAYLOAD_END: &str = "</ui-journey-artifact>";

#[derive(Debug, Clone)]
pub(crate) struct UiJourneyPromptParams {
    pub(crate) scenario_id: Option<String>,
    pub(crate) base_url: String,
    pub(crate) artifact_dir: String,
    pub(crate) run_id: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct UiJourneyRunContext {
    pub(crate) specialist_id: String,
    pub(crate) provider: String,
    pub(crate) run_id: String,
    pub(crate) prompt: UiJourneyPromptParams,
}

#[derive(Debug, Clone)]
pub(crate) struct UiJourneyRunMetrics {
    pub(crate) attempts: u32,
    pub(crate) provider_timeout_ms: Option<u64>,
    pub(crate) provider_retries: u8,
    pub(crate) elapsed_ms: u128,
    pub(crate) initialization_elapsed_ms: Option<u128>,
    pub(crate) session_id: Option<String>,
    pub(crate) prompt_status: Option<String>,
    pub(crate) history_entry_count: usize,
    pub(crate) output_chars: usize,
    pub(crate) last_process_output: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct UiJourneyAggregateRun {
    pub(crate) run_id: String,
    pub(crate) result: String,
    pub(crate) task_fit_score: i64,
    pub(crate) verdict: String,
    pub(crate) failure_stage: Option<String>,
    pub(crate) artifact_dir: PathBuf,
}

#[derive(Debug, Deserialize)]
struct UiJourneyArtifactPayload {
    evaluation: serde_json::Value,
    summary_markdown: String,
}

pub(crate) fn build_context(
    specialist_id: &str,
    prompt: &str,
    provider: &str,
) -> Option<UiJourneyRunContext> {
    if specialist_id != JOURNEY_EVALUATOR_ID {
        return None;
    }

    let mut parsed = parse_prompt(prompt);
    let run_id = parsed
        .run_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(generate_run_id);
    parsed.run_id = Some(run_id.clone());
    Some(UiJourneyRunContext {
        specialist_id: specialist_id.to_string(),
        provider: provider.to_string(),
        run_id,
        prompt: parsed,
    })
}

pub(crate) fn generate_run_id() -> String {
    let now = Local::now();
    format!(
        "{}-{:03}",
        now.format("%Y%m%d-%H%M%S"),
        now.timestamp_subsec_millis()
    )
}

pub(crate) fn parse_prompt(prompt: &str) -> UiJourneyPromptParams {
    let mut values = HashMap::new();

    for pair in prompt.split(',') {
        let section = pair.trim();
        if section.is_empty() {
            continue;
        }

        let maybe_pair = section.split_once('=').or_else(|| section.split_once(':'));
        let Some((raw_key, raw_value)) = maybe_pair else {
            continue;
        };

        let key = raw_key.trim().to_lowercase();
        let value = raw_value.trim();
        if value.is_empty() {
            continue;
        }

        values.insert(key, value.to_string());
    }

    UiJourneyPromptParams {
        scenario_id: values.remove("scenario"),
        base_url: values
            .remove("base_url")
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string()),
        artifact_dir: values
            .remove("artifact_dir")
            .unwrap_or_else(|| DEFAULT_ARTIFACT_DIR.to_string()),
        run_id: values.remove("run_id"),
    }
}

pub(crate) fn validate_prompt(prompt: &UiJourneyPromptParams) -> Result<(), String> {
    let scenario = prompt
        .scenario_id
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    if scenario.is_none() {
        return Err("Missing required journey parameter: scenario".to_string());
    }
    if prompt.artifact_dir.trim().is_empty() {
        return Err("Missing required journey parameter: artifact_dir".to_string());
    }

    Ok(())
}

pub(crate) fn execution_budget() -> Duration {
    std::env::var("ROUTA_UI_JOURNEY_MAX_RUNTIME_MS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .map(Duration::from_millis)
        .unwrap_or_else(|| Duration::from_millis(DEFAULT_EXECUTION_BUDGET_MS))
}

pub(crate) fn build_specialist_request(context: &UiJourneyRunContext) -> String {
    format!(
        "scenario: {scenario}, base_url: {base_url}, artifact_dir: {artifact_dir}, run_id: {run_id}",
        scenario = context
            .prompt
            .scenario_id
            .as_deref()
            .unwrap_or(DEFAULT_SCENARIO_ID),
        base_url = context.prompt.base_url,
        artifact_dir = context.prompt.artifact_dir,
        run_id = context.run_id
    )
}

pub(crate) fn validate_scenario_resource(context: &UiJourneyRunContext) -> Result<(), String> {
    let scenario_id = context
        .prompt
        .scenario_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Missing required journey parameter: scenario".to_string())?;

    resolve_scenario_path(scenario_id).ok_or_else(|| {
        format!(
            "Scenario file not found for '{scenario_id}'. Expected under resources/ui-journeys/<scenario>.yaml"
        )
    })?;

    Ok(())
}

fn resolve_scenario_path(scenario_id: &str) -> Option<PathBuf> {
    let mut search_dirs = Vec::new();

    if let Ok(resource_dir) = std::env::var("ROUTA_SPECIALISTS_RESOURCE_DIR") {
        let resource_path = PathBuf::from(resource_dir);
        search_dirs.push(resource_path.join("..").join("ui-journeys"));
        if let Some(parent) = resource_path.parent() {
            search_dirs.push(parent.join("ui-journeys"));
        }
    }

    search_dirs.push(PathBuf::from("resources/ui-journeys"));
    search_dirs.push(PathBuf::from("../resources/ui-journeys"));

    for dir in search_dirs {
        for extension in ["yaml", "yml"] {
            let candidate = dir.join(format!("{scenario_id}.{extension}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

pub(crate) fn write_failure_artifacts(
    context: &UiJourneyRunContext,
    failure_stage: &str,
    failure_message: &str,
    metrics: &UiJourneyRunMetrics,
) {
    if let Err(err) = write_artifact_set(
        context,
        failure_stage,
        failure_message,
        "incomplete",
        metrics,
    ) {
        eprintln!("⚠️  Failed to write failure artifacts: {err}");
    }
}

pub(crate) fn write_artifact_set(
    context: &UiJourneyRunContext,
    stage: &str,
    message: &str,
    status: &str,
    metrics: &UiJourneyRunMetrics,
) -> Result<(), String> {
    let scenario_id = context
        .prompt
        .scenario_id
        .clone()
        .unwrap_or_else(|| DEFAULT_SCENARIO_ID.to_string());
    let artifact_dir = artifact_dir(context);
    let screenshot_dir = artifact_dir.join("screenshots");

    std::fs::create_dir_all(&screenshot_dir)
        .map_err(|err| format!("Failed to create {}: {}", screenshot_dir.display(), err))?;

    let evaluation = serde_json::json!({
        "result": status,
        "specialist_id": context.specialist_id,
        "provider": context.provider,
        "scenario_id": context.prompt.scenario_id,
        "run_id": context.run_id,
        "task_fit_score": if status == "completed" { 100 } else { 0 },
        "verdict": if status == "completed" { "Good Fit" } else { "Incomplete" },
        "findings": if status == "completed" {
            serde_json::json!([])
        } else {
            serde_json::json!([{
                "type": "issue",
                "description": format!("{} (stage: {})", message, stage),
                "severity": "high"
            }])
        },
        "evidence_summary": if status == "completed" {
            "Specialist run finished. Follow-up evaluator files can be emitted by specialist."
        } else {
            "Run failed before producing full specialist outputs."
        },
        "run_metadata": {
            "attempts": metrics.attempts,
            "provider_timeout_ms": metrics.provider_timeout_ms,
            "provider_retries": metrics.provider_retries,
            "elapsed_ms": metrics.elapsed_ms,
            "initialize_elapsed_ms": metrics.initialization_elapsed_ms,
            "session_id": metrics.session_id,
            "prompt_status": metrics.prompt_status,
            "history_entry_count": metrics.history_entry_count,
            "output_chars": metrics.output_chars,
            "last_process_output": metrics.last_process_output,
            "failure_stage": stage,
        }
    });

    let summary = format!(
        "# UI Journey Evaluation\n\n- Specialist: {specialist}\n- Provider: {provider}\n- Scenario: {scenario}\n- Run ID: {run_id}\n- Stage: {stage}\n- Base URL: {base_url}\n- Status: {status}\n- Message: {message}\n- Attempts: {attempts}\n- Provider timeout (ms): {timeout}\n- Retries: {retries}\n- Total elapsed (ms): {elapsed}\n- Session ID: {session_id}\n- Prompt status: {prompt_status}\n- History entries: {history_entries}\n- Output chars: {output_chars}\n- Last process output: {last_process_output}\n",
        specialist = context.specialist_id,
        provider = context.provider,
        scenario = scenario_id.as_str(),
        run_id = context.run_id,
        stage = stage,
        base_url = context.prompt.base_url,
        status = status,
        message = message,
        attempts = metrics.attempts,
        timeout = metrics
            .provider_timeout_ms
            .map_or_else(|| "unset".to_string(), |value| value.to_string()),
        retries = metrics.provider_retries,
        elapsed = metrics.elapsed_ms,
        session_id = metrics.session_id.as_deref().unwrap_or("unknown"),
        prompt_status = metrics.prompt_status.as_deref().unwrap_or("unknown"),
        history_entries = metrics.history_entry_count,
        output_chars = metrics.output_chars,
        last_process_output = metrics
            .last_process_output
            .as_deref()
            .unwrap_or("none"),
    );

    let evaluation_path = artifact_dir.join("evaluation.json");
    let summary_path = artifact_dir.join("summary.md");
    let evaluation_json = serde_json::to_string_pretty(&evaluation)
        .map_err(|err| format!("Failed to serialize evaluation JSON: {err}"))?;

    std::fs::write(&evaluation_path, evaluation_json)
        .map_err(|err| format!("Failed to write {}: {}", evaluation_path.display(), err))?;
    std::fs::write(&summary_path, summary)
        .map_err(|err| format!("Failed to write {}: {}", summary_path.display(), err))?;

    println!(
        "📁 UI journey artifacts written to {}",
        artifact_dir.display()
    );

    Ok(())
}

pub(crate) fn artifact_dir(context: &UiJourneyRunContext) -> PathBuf {
    let scenario_id = context
        .prompt
        .scenario_id
        .clone()
        .unwrap_or_else(|| DEFAULT_SCENARIO_ID.to_string());
    Path::new(&context.prompt.artifact_dir)
        .join(scenario_id)
        .join(&context.run_id)
}

pub(crate) fn recover_success_artifacts_from_output(
    context: &UiJourneyRunContext,
    specialist_output: &str,
) -> Result<bool, String> {
    let artifact_dir = artifact_dir(context);
    let evaluation_path = artifact_dir.join("evaluation.json");
    let summary_path = artifact_dir.join("summary.md");

    if evaluation_path.is_file() && summary_path.is_file() {
        return Ok(false);
    }

    let Some(payload) = extract_artifact_payload(specialist_output)? else {
        return Ok(false);
    };

    std::fs::create_dir_all(&artifact_dir)
        .map_err(|err| format!("Failed to create {}: {}", artifact_dir.display(), err))?;

    let mut recovered_any = false;
    if !evaluation_path.is_file() {
        let evaluation_json = serde_json::to_string_pretty(&payload.evaluation)
            .map_err(|err| format!("Failed to serialize {}: {}", evaluation_path.display(), err))?;
        std::fs::write(&evaluation_path, evaluation_json)
            .map_err(|err| format!("Failed to write {}: {}", evaluation_path.display(), err))?;
        recovered_any = true;
    }

    if !summary_path.is_file() {
        std::fs::write(&summary_path, payload.summary_markdown)
            .map_err(|err| format!("Failed to write {}: {}", summary_path.display(), err))?;
        recovered_any = true;
    }

    if recovered_any {
        println!(
            "🛟 Recovered UI journey artifacts from specialist output at {}",
            artifact_dir.display()
        );
    }

    Ok(recovered_any)
}

pub(crate) fn output_contains_artifact_payload(specialist_output: &str) -> bool {
    specialist_output.contains(RESULT_PAYLOAD_START)
        && specialist_output.contains(RESULT_PAYLOAD_END)
}

fn is_supported_screenshot_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("png" | "jpg" | "jpeg" | "webp")
    )
}

pub(crate) fn validate_success_artifacts(
    context: &UiJourneyRunContext,
    metrics: &UiJourneyRunMetrics,
) -> Result<(), String> {
    let artifact_dir = artifact_dir(context);
    let evaluation_path = artifact_dir.join("evaluation.json");
    let summary_path = artifact_dir.join("summary.md");
    let screenshot_dir = artifact_dir.join("screenshots");

    if !evaluation_path.is_file() {
        return Err(format!(
            "Specialist run completed but missing evaluation artifact: {}",
            evaluation_path.display()
        ));
    }
    if !summary_path.is_file() {
        return Err(format!(
            "Specialist run completed but missing summary artifact: {}",
            summary_path.display()
        ));
    }
    if !screenshot_dir.is_dir() {
        return Err(format!(
            "Specialist run completed but missing screenshots directory: {}",
            screenshot_dir.display()
        ));
    }

    let screenshot_count = std::fs::read_dir(&screenshot_dir)
        .map_err(|err| format!("Failed to read {}: {}", screenshot_dir.display(), err))?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_file() && is_supported_screenshot_file(&entry.path()))
        .count();
    if screenshot_count == 0 {
        return Err(format!(
            "Specialist run completed but produced no image screenshots in {}",
            screenshot_dir.display()
        ));
    }

    let evaluation_text = std::fs::read_to_string(&evaluation_path)
        .map_err(|err| format!("Failed to read {}: {}", evaluation_path.display(), err))?;
    let mut evaluation_value: serde_json::Value =
        serde_json::from_str(&evaluation_text).map_err(|err| {
            format!(
                "Invalid evaluation JSON in {}: {}",
                evaluation_path.display(),
                err
            )
        })?;
    let evaluation = evaluation_value.as_object_mut().ok_or_else(|| {
        format!(
            "Evaluation artifact must be a JSON object: {}",
            evaluation_path.display()
        )
    })?;

    let expected_scenario = context
        .prompt
        .scenario_id
        .as_deref()
        .unwrap_or(DEFAULT_SCENARIO_ID);
    let actual_scenario = evaluation
        .get("scenario_id")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Evaluation artifact missing string field: scenario_id".to_string())?;
    if actual_scenario != expected_scenario {
        return Err(format!(
            "Evaluation artifact scenario_id mismatch: expected '{expected_scenario}', got '{actual_scenario}'"
        ));
    }

    let actual_run_id = evaluation
        .get("run_id")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Evaluation artifact missing string field: run_id".to_string())?;
    if actual_run_id != context.run_id {
        return Err(format!(
            "Evaluation artifact run_id mismatch: expected '{}', got '{}'",
            context.run_id, actual_run_id
        ));
    }

    let task_fit_score = evaluation
        .get("task_fit_score")
        .and_then(|value| value.as_i64())
        .ok_or_else(|| "Evaluation artifact missing integer field: task_fit_score".to_string())?;
    if !(0..=100).contains(&task_fit_score) {
        return Err(format!(
            "Evaluation artifact task_fit_score out of range 0-100: {task_fit_score}"
        ));
    }

    let verdict = evaluation
        .get("verdict")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Evaluation artifact missing string field: verdict".to_string())?;
    if verdict.trim().is_empty() {
        return Err("Evaluation artifact verdict cannot be empty".to_string());
    }
    let expected_verdict = expected_verdict_for_score(task_fit_score);
    if verdict != expected_verdict {
        return Err(format!(
            "Evaluation artifact verdict/score mismatch: score {task_fit_score} requires '{expected_verdict}', got '{verdict}'"
        ));
    }

    let findings = evaluation
        .get("findings")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "Evaluation artifact missing array field: findings".to_string())?;
    for (index, finding) in findings.iter().enumerate() {
        let object = finding
            .as_object()
            .ok_or_else(|| format!("Finding at index {index} must be an object"))?;
        for field in ["type", "description", "severity"] {
            let value = object
                .get(field)
                .and_then(|value| value.as_str())
                .ok_or_else(|| format!("Finding at index {index} missing string field: {field}"))?;
            if value.trim().is_empty() {
                return Err(format!(
                    "Finding at index {index} has empty string field: {field}"
                ));
            }
        }
        let finding_type = object
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if !matches!(finding_type, "issue" | "observation") {
            return Err(format!(
                "Finding at index {index} has unsupported type '{finding_type}'; expected 'issue' or 'observation'"
            ));
        }
        let severity = object
            .get("severity")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if !matches!(severity, "low" | "medium" | "high") {
            return Err(format!(
                "Finding at index {index} has unsupported severity '{severity}'; expected low|medium|high"
            ));
        }
    }

    let evidence_summary = evaluation
        .get("evidence_summary")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Evaluation artifact missing string field: evidence_summary".to_string())?;
    if evidence_summary.trim().is_empty() {
        return Err("Evaluation artifact evidence_summary cannot be empty".to_string());
    }

    evaluation.insert("provider".to_string(), serde_json::json!(context.provider));
    evaluation.insert(
        "run_metadata".to_string(),
        serde_json::json!({
            "attempts": metrics.attempts,
            "provider_timeout_ms": metrics.provider_timeout_ms,
            "provider_retries": metrics.provider_retries,
            "elapsed_ms": metrics.elapsed_ms,
            "initialize_elapsed_ms": metrics.initialization_elapsed_ms,
            "session_id": metrics.session_id,
            "prompt_status": metrics.prompt_status,
            "history_entry_count": metrics.history_entry_count,
            "output_chars": metrics.output_chars,
            "last_process_output": metrics.last_process_output,
            "failure_stage": serde_json::Value::Null,
        }),
    );

    let normalized_evaluation = serde_json::to_string_pretty(&evaluation_value)
        .map_err(|err| format!("Failed to serialize {}: {}", evaluation_path.display(), err))?;
    std::fs::write(&evaluation_path, normalized_evaluation)
        .map_err(|err| format!("Failed to write {}: {}", evaluation_path.display(), err))?;

    println!(
        "✅ Validated UI journey artifacts at {} ({} screenshots)",
        artifact_dir.display(),
        screenshot_count
    );

    Ok(())
}

fn expected_verdict_for_score(task_fit_score: i64) -> &'static str {
    if task_fit_score >= 80 {
        "Good Fit"
    } else if task_fit_score >= 60 {
        "Partial Fit"
    } else {
        "Poor Fit"
    }
}

fn extract_artifact_payload(output: &str) -> Result<Option<UiJourneyArtifactPayload>, String> {
    let mut cursor = 0usize;
    let mut saw_marker = false;
    let mut last_error: Option<String> = None;
    let mut last_valid_payload: Option<UiJourneyArtifactPayload> = None;

    while let Some(relative_start) = output[cursor..].find(RESULT_PAYLOAD_START) {
        saw_marker = true;
        let marker_start = cursor + relative_start;
        let content_start = marker_start + RESULT_PAYLOAD_START.len();
        let remaining = &output[content_start..];
        let Some(relative_end) = remaining.find(RESULT_PAYLOAD_END) else {
            last_error = Some(
                "Specialist output included a ui-journey artifact start marker without an end marker"
                    .to_string(),
            );
            break;
        };

        let payload_text = remaining[..relative_end].trim();
        if payload_text.is_empty() {
            last_error =
                Some("UI journey artifact payload marker was present but empty".to_string());
        } else {
            match parse_artifact_payload_candidate(payload_text) {
                Ok(payload) => last_valid_payload = Some(payload),
                Err(err) => {
                    last_error = Some(err);
                }
            }
        }

        cursor = content_start + relative_end + RESULT_PAYLOAD_END.len();
    }

    if let Some(payload) = last_valid_payload {
        return Ok(Some(payload));
    }

    if saw_marker {
        Err(last_error.unwrap_or_else(|| {
            "UI journey artifact markers were present, but no valid payload could be parsed"
                .to_string()
        }))
    } else {
        Ok(None)
    }
}

fn parse_artifact_payload_candidate(
    payload_text: &str,
) -> Result<UiJourneyArtifactPayload, String> {
    let normalized_lines = payload_text
        .lines()
        .map(|line| line.trim_start_matches(|char: char| char.is_whitespace() || char == '▶'))
        .collect::<Vec<_>>()
        .join("\n");
    let stripped_controls = normalized_lines
        .chars()
        .filter(|char| matches!(char, '\n' | '\r' | '\t') || !char.is_control())
        .collect::<String>();
    let candidate =
        extract_json_object_slice(&stripped_controls).unwrap_or(stripped_controls.as_str());

    serde_json::from_str::<UiJourneyArtifactPayload>(candidate).map_err(|err| {
        format!("Failed to parse ui-journey artifact payload from specialist output: {err}")
    })
}

fn extract_json_object_slice(value: &str) -> Option<&str> {
    let first = value.find('{')?;
    let last = value.rfind('}')?;
    (first <= last).then_some(&value[first..=last])
}

pub(crate) fn load_aggregate_run(
    context: &UiJourneyRunContext,
) -> Result<UiJourneyAggregateRun, String> {
    let artifact_dir = artifact_dir(context);
    let evaluation_path = artifact_dir.join("evaluation.json");
    let evaluation_text = std::fs::read_to_string(&evaluation_path)
        .map_err(|err| format!("Failed to read {}: {}", evaluation_path.display(), err))?;
    let evaluation: serde_json::Value = serde_json::from_str(&evaluation_text).map_err(|err| {
        format!(
            "Invalid evaluation JSON in {}: {}",
            evaluation_path.display(),
            err
        )
    })?;

    let task_fit_score = evaluation
        .get("task_fit_score")
        .and_then(|value| value.as_i64())
        .ok_or_else(|| format!("Missing task_fit_score in {}", evaluation_path.display()))?;
    let verdict = evaluation
        .get("verdict")
        .and_then(|value| value.as_str())
        .ok_or_else(|| format!("Missing verdict in {}", evaluation_path.display()))?;
    let result = evaluation
        .get("result")
        .and_then(|value| value.as_str())
        .unwrap_or("completed");
    let failure_stage = evaluation
        .get("run_metadata")
        .and_then(|value| value.get("failure_stage"))
        .and_then(|value| value.as_str())
        .map(str::to_string);

    Ok(UiJourneyAggregateRun {
        run_id: context.run_id.clone(),
        result: result.to_string(),
        task_fit_score,
        verdict: verdict.to_string(),
        failure_stage,
        artifact_dir,
    })
}

pub(crate) fn write_baseline_artifacts(
    context: &UiJourneyRunContext,
    batch_run_id: &str,
    aggregate_runs: &[UiJourneyAggregateRun],
    repeat_count: u8,
) -> Result<PathBuf, String> {
    let scenario_id = context
        .prompt
        .scenario_id
        .as_deref()
        .unwrap_or(DEFAULT_SCENARIO_ID);
    let scenario_dir = Path::new(&context.prompt.artifact_dir).join(scenario_id);
    std::fs::create_dir_all(&scenario_dir)
        .map_err(|err| format!("Failed to create {}: {}", scenario_dir.display(), err))?;

    let mut verdict_counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut failure_stage_counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut min_score = i64::MAX;
    let mut max_score = i64::MIN;
    let mut score_sum = 0i64;
    let mut completed_runs = 0usize;

    for run in aggregate_runs {
        *verdict_counts.entry(run.verdict.clone()).or_default() += 1;
        if let Some(stage) = run
            .failure_stage
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            *failure_stage_counts.entry(stage.to_string()).or_default() += 1;
        }
        min_score = min_score.min(run.task_fit_score);
        max_score = max_score.max(run.task_fit_score);
        score_sum += run.task_fit_score;
        if run.result == "completed" {
            completed_runs += 1;
        }
    }

    let run_count = aggregate_runs.len();
    let average_score = if run_count == 0 {
        0.0
    } else {
        score_sum as f64 / run_count as f64
    };
    let baseline_json_path = scenario_dir.join(format!("baseline-{batch_run_id}.json"));
    let baseline_md_path = scenario_dir.join(format!("baseline-{batch_run_id}.md"));
    let runs_json = aggregate_runs
        .iter()
        .map(|run| {
            serde_json::json!({
                "run_id": run.run_id,
                "result": run.result,
                "task_fit_score": run.task_fit_score,
                "verdict": run.verdict,
                "failure_stage": run.failure_stage,
                "artifact_dir": run.artifact_dir,
            })
        })
        .collect::<Vec<_>>();

    let baseline_json = serde_json::json!({
        "scenario_id": scenario_id,
        "batch_run_id": batch_run_id,
        "requested_repeat_count": repeat_count,
        "run_count": run_count,
        "completed_runs": completed_runs,
        "incomplete_runs": run_count.saturating_sub(completed_runs),
        "score_range": {
            "min": if run_count == 0 { 0 } else { min_score },
            "max": if run_count == 0 { 0 } else { max_score },
            "average": average_score,
            "spread": if run_count == 0 { 0 } else { max_score - min_score },
        },
        "verdict_counts": verdict_counts,
        "failure_stage_counts": failure_stage_counts,
        "runs": runs_json,
    });
    let baseline_md = format!(
        "# UI Journey Baseline\n\n- Scenario: {scenario}\n- Batch Run ID: {batch_run_id}\n- Requested Repeats: {repeat_count}\n- Actual Runs: {run_count}\n- Completed Runs: {completed_runs}\n- Incomplete Runs: {incomplete_runs}\n- Score Min/Avg/Max: {min}/{avg:.1}/{max}\n- Score Spread: {spread}\n\n## Runs\n{runs}",
        scenario = scenario_id,
        run_count = run_count,
        incomplete_runs = run_count.saturating_sub(completed_runs),
        min = if run_count == 0 { 0 } else { min_score },
        avg = average_score,
        max = if run_count == 0 { 0 } else { max_score },
        spread = if run_count == 0 { 0 } else { max_score - min_score },
        runs = aggregate_runs
            .iter()
            .map(|run| {
                format!(
                    "- `{}`: {} / {} / score={} / stage={} / {}\n",
                    run.run_id,
                    run.result,
                    run.verdict,
                    run.task_fit_score,
                    run.failure_stage.as_deref().unwrap_or("none"),
                    run.artifact_dir.display()
                )
            })
            .collect::<String>(),
    );

    std::fs::write(
        &baseline_json_path,
        serde_json::to_string_pretty(&baseline_json).map_err(|err| {
            format!(
                "Failed to serialize {}: {}",
                baseline_json_path.display(),
                err
            )
        })?,
    )
    .map_err(|err| format!("Failed to write {}: {}", baseline_json_path.display(), err))?;
    std::fs::write(&baseline_md_path, baseline_md)
        .map_err(|err| format!("Failed to write {}: {}", baseline_md_path.display(), err))?;

    Ok(baseline_json_path)
}

#[cfg(test)]
mod tests {
    use super::{
        execution_budget, output_contains_artifact_payload, parse_prompt,
        recover_success_artifacts_from_output, validate_prompt, validate_success_artifacts,
        write_artifact_set, write_baseline_artifacts, UiJourneyAggregateRun, UiJourneyPromptParams,
        UiJourneyRunContext, UiJourneyRunMetrics, DEFAULT_ARTIFACT_DIR, DEFAULT_BASE_URL,
        DEFAULT_SCENARIO_ID,
    };
    use serde_json::Value;
    use std::fs;
    use std::sync::{Mutex, OnceLock};
    use tempfile::tempdir;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn parses_ui_journey_prompt_kv_pairs() {
        let params = parse_prompt(
            "scenario: core-home-session, base_url: http://localhost:3000, artifact_dir: /tmp/artifacts",
        );

        assert_eq!(params.scenario_id.as_deref(), Some("core-home-session"));
        assert_eq!(params.base_url, "http://localhost:3000");
        assert_eq!(params.artifact_dir, "/tmp/artifacts");
    }

    #[test]
    fn parses_ui_journey_prompt_eq_syntax() {
        let params = parse_prompt(
            "scenario=kanban-automation, base_url=http://127.0.0.1:3000, run_id=20260325-120000-123",
        );

        assert_eq!(params.scenario_id.as_deref(), Some("kanban-automation"));
        assert_eq!(params.base_url, "http://127.0.0.1:3000");
        assert_eq!(params.artifact_dir, DEFAULT_ARTIFACT_DIR);
        assert_eq!(params.run_id.as_deref(), Some("20260325-120000-123"));
    }

    #[test]
    fn uses_default_execution_budget() {
        let _guard = env_lock().lock().unwrap();
        std::env::remove_var("ROUTA_UI_JOURNEY_MAX_RUNTIME_MS");
        assert_eq!(execution_budget().as_secs(), 240);
    }

    #[test]
    fn accepts_execution_budget_override_from_env() {
        let _guard = env_lock().lock().unwrap();
        std::env::set_var("ROUTA_UI_JOURNEY_MAX_RUNTIME_MS", "1500");
        assert_eq!(execution_budget().as_millis(), 1500);
        std::env::remove_var("ROUTA_UI_JOURNEY_MAX_RUNTIME_MS");
    }

    #[test]
    fn writes_ui_journey_failure_artifacts() {
        let base_dir = tempdir().unwrap();
        let artifact_dir = base_dir
            .path()
            .join("artifacts")
            .to_string_lossy()
            .to_string();
        let context = UiJourneyRunContext {
            specialist_id: "ui-journey-evaluator".to_string(),
            provider: "opencode".to_string(),
            run_id: "2026-03-25-001".to_string(),
            prompt: UiJourneyPromptParams {
                scenario_id: Some("core-home-session".to_string()),
                base_url: DEFAULT_BASE_URL.to_string(),
                artifact_dir: artifact_dir.clone(),
                run_id: Some("2026-03-25-001".to_string()),
            },
        };
        let metrics = UiJourneyRunMetrics {
            attempts: 1,
            provider_timeout_ms: Some(3000),
            provider_retries: 1,
            elapsed_ms: 1200,
            initialization_elapsed_ms: Some(100),
            session_id: None,
            prompt_status: None,
            history_entry_count: 0,
            output_chars: 0,
            last_process_output: None,
        };

        write_artifact_set(
            &context,
            "session_creation",
            "init timeout",
            "incomplete",
            &metrics,
        )
        .unwrap();

        let output_dir = std::path::Path::new(&artifact_dir)
            .join("core-home-session")
            .join("2026-03-25-001");
        let evaluation = output_dir.join("evaluation.json");
        let summary = output_dir.join("summary.md");

        assert!(evaluation.exists());
        assert!(summary.exists());
        assert!(output_dir.join("screenshots").exists());

        let contents = fs::read_to_string(summary).unwrap();
        assert!(contents.contains("Stage: session_creation"));
        assert!(contents.contains("init timeout"));
    }

    #[test]
    fn defaults_ui_journey_prompt_values() {
        let params = parse_prompt("scenario: unknown");
        assert_eq!(params.base_url, DEFAULT_BASE_URL);
        assert_eq!(params.artifact_dir, DEFAULT_ARTIFACT_DIR);
        assert_eq!(params.scenario_id.as_deref(), Some("unknown"));
        assert!(params.run_id.is_none());
    }

    #[test]
    fn validate_ui_journey_prompt_requires_scenario() {
        let missing = UiJourneyPromptParams {
            scenario_id: None,
            base_url: DEFAULT_BASE_URL.to_string(),
            artifact_dir: DEFAULT_ARTIFACT_DIR.to_string(),
            run_id: None,
        };
        assert!(validate_prompt(&missing).is_err());

        let present = UiJourneyPromptParams {
            scenario_id: Some("core-home-session".to_string()),
            base_url: DEFAULT_BASE_URL.to_string(),
            artifact_dir: DEFAULT_ARTIFACT_DIR.to_string(),
            run_id: None,
        };
        assert!(validate_prompt(&present).is_ok());
    }

    #[test]
    fn validates_ui_journey_success_artifacts_and_injects_run_metadata() {
        let base_dir = tempdir().unwrap();
        let artifact_dir = base_dir
            .path()
            .join("artifacts")
            .to_string_lossy()
            .to_string();
        let context = UiJourneyRunContext {
            specialist_id: "ui-journey-evaluator".to_string(),
            provider: "opencode".to_string(),
            run_id: "2026-03-25-002".to_string(),
            prompt: UiJourneyPromptParams {
                scenario_id: Some("core-home-session".to_string()),
                base_url: DEFAULT_BASE_URL.to_string(),
                artifact_dir: artifact_dir.clone(),
                run_id: Some("2026-03-25-002".to_string()),
            },
        };
        let metrics = UiJourneyRunMetrics {
            attempts: 2,
            provider_timeout_ms: Some(5000),
            provider_retries: 1,
            elapsed_ms: 2200,
            initialization_elapsed_ms: Some(450),
            session_id: None,
            prompt_status: None,
            history_entry_count: 0,
            output_chars: 0,
            last_process_output: None,
        };

        let output_dir = std::path::Path::new(&artifact_dir)
            .join("core-home-session")
            .join("2026-03-25-002");
        fs::create_dir_all(output_dir.join("screenshots")).unwrap();
        fs::write(
            output_dir.join("evaluation.json"),
            r#"{
  "scenario_id": "core-home-session",
  "run_id": "2026-03-25-002",
  "task_fit_score": 85,
  "verdict": "Good Fit",
  "findings": [],
  "evidence_summary": "Journey completed."
}"#,
        )
        .unwrap();
        fs::write(output_dir.join("summary.md"), "# Summary\n").unwrap();
        fs::write(output_dir.join("screenshots").join("step-01.png"), "png").unwrap();

        validate_success_artifacts(&context, &metrics).unwrap();

        let evaluation: Value =
            serde_json::from_str(&fs::read_to_string(output_dir.join("evaluation.json")).unwrap())
                .unwrap();
        assert_eq!(
            evaluation.get("provider").and_then(Value::as_str),
            Some("opencode")
        );
        assert_eq!(
            evaluation
                .get("run_metadata")
                .and_then(|value| value.get("attempts"))
                .and_then(Value::as_u64),
            Some(2)
        );
        assert!(evaluation
            .get("run_metadata")
            .and_then(|value| value.get("failure_stage"))
            .is_some());
    }

    #[test]
    fn rejects_ui_journey_success_artifacts_without_screenshots() {
        let base_dir = tempdir().unwrap();
        let artifact_dir = base_dir
            .path()
            .join("artifacts")
            .to_string_lossy()
            .to_string();
        let context = UiJourneyRunContext {
            specialist_id: "ui-journey-evaluator".to_string(),
            provider: "opencode".to_string(),
            run_id: "2026-03-25-003".to_string(),
            prompt: UiJourneyPromptParams {
                scenario_id: Some(DEFAULT_SCENARIO_ID.to_string()),
                base_url: DEFAULT_BASE_URL.to_string(),
                artifact_dir: artifact_dir.clone(),
                run_id: Some("2026-03-25-003".to_string()),
            },
        };
        let metrics = UiJourneyRunMetrics {
            attempts: 1,
            provider_timeout_ms: None,
            provider_retries: 0,
            elapsed_ms: 900,
            initialization_elapsed_ms: Some(120),
            session_id: None,
            prompt_status: None,
            history_entry_count: 0,
            output_chars: 0,
            last_process_output: None,
        };

        let output_dir = std::path::Path::new(&artifact_dir)
            .join(DEFAULT_SCENARIO_ID)
            .join("2026-03-25-003");
        fs::create_dir_all(output_dir.join("screenshots")).unwrap();
        fs::write(
            output_dir.join("evaluation.json"),
            r#"{
  "scenario_id": "unknown-scenario",
  "run_id": "2026-03-25-003",
  "task_fit_score": 65,
  "verdict": "Partial Fit",
  "findings": [],
  "evidence_summary": "No screenshot saved."
}"#,
        )
        .unwrap();
        fs::write(output_dir.join("summary.md"), "# Summary\n").unwrap();

        let error = validate_success_artifacts(&context, &metrics).unwrap_err();
        assert!(error.contains("produced no image screenshots"));
    }

    #[test]
    fn rejects_non_image_screenshot_artifacts() {
        let base_dir = tempdir().unwrap();
        let artifact_dir = base_dir
            .path()
            .join("artifacts")
            .to_string_lossy()
            .to_string();
        let context = UiJourneyRunContext {
            specialist_id: "ui-journey-evaluator".to_string(),
            provider: "opencode".to_string(),
            run_id: "2026-03-25-003a".to_string(),
            prompt: UiJourneyPromptParams {
                scenario_id: Some(DEFAULT_SCENARIO_ID.to_string()),
                base_url: DEFAULT_BASE_URL.to_string(),
                artifact_dir: artifact_dir.clone(),
                run_id: Some("2026-03-25-003a".to_string()),
            },
        };
        let metrics = UiJourneyRunMetrics {
            attempts: 1,
            provider_timeout_ms: None,
            provider_retries: 0,
            elapsed_ms: 900,
            initialization_elapsed_ms: Some(120),
            session_id: None,
            prompt_status: None,
            history_entry_count: 0,
            output_chars: 0,
            last_process_output: None,
        };

        let output_dir = std::path::Path::new(&artifact_dir)
            .join(DEFAULT_SCENARIO_ID)
            .join("2026-03-25-003a");
        fs::create_dir_all(output_dir.join("screenshots")).unwrap();
        fs::write(
            output_dir.join("evaluation.json"),
            r#"{
  "scenario_id": "unknown-scenario",
  "run_id": "2026-03-25-003a",
  "task_fit_score": 65,
  "verdict": "Partial Fit",
  "findings": [],
  "evidence_summary": "Snapshot text saved but no actual image."
}"#,
        )
        .unwrap();
        fs::write(output_dir.join("summary.md"), "# Summary\n").unwrap();
        fs::write(
            output_dir.join("screenshots").join("step-01.yaml"),
            "snapshot",
        )
        .unwrap();

        let error = validate_success_artifacts(&context, &metrics).unwrap_err();
        assert!(error.contains("produced no image screenshots"));
    }

    #[test]
    fn rejects_findings_without_required_fields() {
        let base_dir = tempdir().unwrap();
        let artifact_dir = base_dir
            .path()
            .join("artifacts")
            .to_string_lossy()
            .to_string();
        let context = UiJourneyRunContext {
            specialist_id: "ui-journey-evaluator".to_string(),
            provider: "opencode".to_string(),
            run_id: "2026-03-25-004".to_string(),
            prompt: UiJourneyPromptParams {
                scenario_id: Some("core-home-session".to_string()),
                base_url: DEFAULT_BASE_URL.to_string(),
                artifact_dir: artifact_dir.clone(),
                run_id: Some("2026-03-25-004".to_string()),
            },
        };
        let metrics = UiJourneyRunMetrics {
            attempts: 1,
            provider_timeout_ms: None,
            provider_retries: 0,
            elapsed_ms: 900,
            initialization_elapsed_ms: Some(120),
            session_id: None,
            prompt_status: None,
            history_entry_count: 0,
            output_chars: 0,
            last_process_output: None,
        };

        let output_dir = std::path::Path::new(&artifact_dir)
            .join("core-home-session")
            .join("2026-03-25-004");
        fs::create_dir_all(output_dir.join("screenshots")).unwrap();
        fs::write(
            output_dir.join("evaluation.json"),
            r#"{
  "scenario_id": "core-home-session",
  "run_id": "2026-03-25-004",
  "task_fit_score": 72,
  "verdict": "Partial Fit",
  "findings": [{"type": "issue", "severity": "high"}],
  "evidence_summary": "Missing finding description."
}"#,
        )
        .unwrap();
        fs::write(output_dir.join("summary.md"), "# Summary\n").unwrap();
        fs::write(output_dir.join("screenshots").join("step-01.png"), "png").unwrap();

        let error = validate_success_artifacts(&context, &metrics).unwrap_err();
        assert!(error.contains("missing string field: description"));
    }

    #[test]
    fn rejects_verdict_score_mismatch() {
        let base_dir = tempdir().unwrap();
        let artifact_dir = base_dir
            .path()
            .join("artifacts")
            .to_string_lossy()
            .to_string();
        let context = UiJourneyRunContext {
            specialist_id: "ui-journey-evaluator".to_string(),
            provider: "opencode".to_string(),
            run_id: "2026-03-25-005".to_string(),
            prompt: UiJourneyPromptParams {
                scenario_id: Some("core-home-session".to_string()),
                base_url: DEFAULT_BASE_URL.to_string(),
                artifact_dir: artifact_dir.clone(),
                run_id: Some("2026-03-25-005".to_string()),
            },
        };
        let metrics = UiJourneyRunMetrics {
            attempts: 1,
            provider_timeout_ms: None,
            provider_retries: 0,
            elapsed_ms: 900,
            initialization_elapsed_ms: Some(120),
            session_id: None,
            prompt_status: None,
            history_entry_count: 0,
            output_chars: 0,
            last_process_output: None,
        };

        let output_dir = std::path::Path::new(&artifact_dir)
            .join("core-home-session")
            .join("2026-03-25-005");
        fs::create_dir_all(output_dir.join("screenshots")).unwrap();
        fs::write(
            output_dir.join("evaluation.json"),
            r#"{
  "scenario_id": "core-home-session",
  "run_id": "2026-03-25-005",
  "task_fit_score": 85,
  "verdict": "Partial Fit",
  "findings": [],
  "evidence_summary": "Verdict mismatch."
}"#,
        )
        .unwrap();
        fs::write(output_dir.join("summary.md"), "# Summary\n").unwrap();
        fs::write(output_dir.join("screenshots").join("step-01.png"), "png").unwrap();

        let error = validate_success_artifacts(&context, &metrics).unwrap_err();
        assert!(error.contains("verdict/score mismatch"));
    }

    #[test]
    fn rejects_findings_with_unsupported_enums() {
        let base_dir = tempdir().unwrap();
        let artifact_dir = base_dir
            .path()
            .join("artifacts")
            .to_string_lossy()
            .to_string();
        let context = UiJourneyRunContext {
            specialist_id: "ui-journey-evaluator".to_string(),
            provider: "opencode".to_string(),
            run_id: "2026-03-25-006".to_string(),
            prompt: UiJourneyPromptParams {
                scenario_id: Some("core-home-session".to_string()),
                base_url: DEFAULT_BASE_URL.to_string(),
                artifact_dir: artifact_dir.clone(),
                run_id: Some("2026-03-25-006".to_string()),
            },
        };
        let metrics = UiJourneyRunMetrics {
            attempts: 1,
            provider_timeout_ms: None,
            provider_retries: 0,
            elapsed_ms: 900,
            initialization_elapsed_ms: Some(120),
            session_id: None,
            prompt_status: None,
            history_entry_count: 0,
            output_chars: 0,
            last_process_output: None,
        };

        let output_dir = std::path::Path::new(&artifact_dir)
            .join("core-home-session")
            .join("2026-03-25-006");
        fs::create_dir_all(output_dir.join("screenshots")).unwrap();
        fs::write(
            output_dir.join("evaluation.json"),
            r#"{
  "scenario_id": "core-home-session",
  "run_id": "2026-03-25-006",
  "task_fit_score": 45,
  "verdict": "Poor Fit",
  "findings": [{"type": "warning", "description": "Bad enum", "severity": "critical"}],
  "evidence_summary": "Unsupported enums."
}"#,
        )
        .unwrap();
        fs::write(output_dir.join("summary.md"), "# Summary\n").unwrap();
        fs::write(output_dir.join("screenshots").join("step-01.png"), "png").unwrap();

        let error = validate_success_artifacts(&context, &metrics).unwrap_err();
        assert!(error.contains("unsupported type"));
    }

    #[test]
    fn recovers_success_artifacts_from_specialist_output_payload() {
        let base_dir = tempdir().unwrap();
        let artifact_dir = base_dir
            .path()
            .join("artifacts")
            .to_string_lossy()
            .to_string();
        let context = UiJourneyRunContext {
            specialist_id: "ui-journey-evaluator".to_string(),
            provider: "opencode".to_string(),
            run_id: "2026-03-25-007".to_string(),
            prompt: UiJourneyPromptParams {
                scenario_id: Some("core-home-session".to_string()),
                base_url: DEFAULT_BASE_URL.to_string(),
                artifact_dir: artifact_dir.clone(),
                run_id: Some("2026-03-25-007".to_string()),
            },
        };

        let output_dir = std::path::Path::new(&artifact_dir)
            .join("core-home-session")
            .join("2026-03-25-007");
        fs::create_dir_all(output_dir.join("screenshots")).unwrap();
        fs::write(output_dir.join("screenshots").join("step-01.png"), "png").unwrap();

        let specialist_output = concat!(
            "Execution completed successfully.\n",
            "<ui-journey-artifact>\n",
            "{\n",
            "  \"evaluation\": {\n",
            "    \"scenario_id\": \"core-home-session\",\n",
            "    \"run_id\": \"2026-03-25-007\",\n",
            "    \"task_fit_score\": 82,\n",
            "    \"verdict\": \"Good Fit\",\n",
            "    \"findings\": [\n",
            "      {\n",
            "        \"type\": \"observation\",\n",
            "        \"description\": \"Provider picker was already selected.\",\n",
            "        \"severity\": \"low\"\n",
            "      }\n",
            "    ],\n",
            "    \"evidence_summary\": \"Homepage to session detail completed without blocking errors.\"\n",
            "  },\n",
            "  \"summary_markdown\": \"# UI Journey Evaluation\\n\\n- Result: Good Fit\\n- Notes: Journey completed.\\n\"\n",
            "}\n",
            "</ui-journey-artifact>\n",
        );

        let recovered = recover_success_artifacts_from_output(&context, specialist_output).unwrap();
        assert!(recovered);
        assert!(output_dir.join("evaluation.json").exists());
        assert!(output_dir.join("summary.md").exists());
    }

    #[test]
    fn rejects_malformed_specialist_output_payload() {
        let base_dir = tempdir().unwrap();
        let artifact_dir = base_dir
            .path()
            .join("artifacts")
            .to_string_lossy()
            .to_string();
        let context = UiJourneyRunContext {
            specialist_id: "ui-journey-evaluator".to_string(),
            provider: "opencode".to_string(),
            run_id: "2026-03-25-008".to_string(),
            prompt: UiJourneyPromptParams {
                scenario_id: Some("core-home-session".to_string()),
                base_url: DEFAULT_BASE_URL.to_string(),
                artifact_dir,
                run_id: Some("2026-03-25-008".to_string()),
            },
        };

        let error = recover_success_artifacts_from_output(
            &context,
            "<ui-journey-artifact>{not-json}</ui-journey-artifact>",
        )
        .unwrap_err();
        assert!(error.contains("Failed to parse ui-journey artifact payload"));
    }

    #[test]
    fn recovers_last_valid_payload_when_output_contains_malformed_duplicate() {
        let base_dir = tempdir().unwrap();
        let artifact_dir = base_dir
            .path()
            .join("artifacts")
            .to_string_lossy()
            .to_string();
        let context = UiJourneyRunContext {
            specialist_id: "ui-journey-evaluator".to_string(),
            provider: "codex".to_string(),
            run_id: "2026-03-25-009".to_string(),
            prompt: UiJourneyPromptParams {
                scenario_id: Some("team-automation".to_string()),
                base_url: DEFAULT_BASE_URL.to_string(),
                artifact_dir: artifact_dir.clone(),
                run_id: Some("2026-03-25-009".to_string()),
            },
        };

        let specialist_output = concat!(
            "<ui-journey-artifact>\n",
            "{\"evaluation\":{\"scenario_id\":\"team-automation\",\n",
            "</ui-journey-artifact>\n",
            "<ui-journey-artifact>\n",
            "{\n",
            "  \"evaluation\": {\n",
            "    \"scenario_id\": \"team-automation\",\n",
            "    \"run_id\": \"2026-03-25-009\",\n",
            "    \"task_fit_score\": 87,\n",
            "    \"verdict\": \"Good Fit\",\n",
            "    \"findings\": [\n",
            "      {\n",
            "        \"type\": \"observation\",\n",
            "        \"description\": \"Team run page showed visible member status.\",\n",
            "        \"severity\": \"low\"\n",
            "      }\n",
            "    ],\n",
            "    \"evidence_summary\": \"Team run launched successfully.\"\n",
            "  },\n",
            "  \"summary_markdown\": \"# UI Journey Evaluation\\n\\n- Result: Good Fit\\n\"\n",
            "}\n",
            "</ui-journey-artifact>\n",
        );

        let recovered = recover_success_artifacts_from_output(&context, specialist_output).unwrap();
        assert!(recovered);

        let evaluation_path = std::path::Path::new(&artifact_dir)
            .join("team-automation")
            .join("2026-03-25-009")
            .join("evaluation.json");
        let evaluation: Value =
            serde_json::from_str(&fs::read_to_string(evaluation_path).unwrap()).unwrap();
        assert_eq!(
            evaluation.get("run_id").and_then(Value::as_str),
            Some("2026-03-25-009")
        );
        assert_eq!(
            evaluation.get("task_fit_score").and_then(Value::as_i64),
            Some(87)
        );
    }

    #[test]
    fn recovers_payload_with_terminal_prefixes() {
        let base_dir = tempdir().unwrap();
        let artifact_dir = base_dir
            .path()
            .join("artifacts")
            .to_string_lossy()
            .to_string();
        let context = UiJourneyRunContext {
            specialist_id: "ui-journey-evaluator".to_string(),
            provider: "codex".to_string(),
            run_id: "2026-03-25-010".to_string(),
            prompt: UiJourneyPromptParams {
                scenario_id: Some("team-automation".to_string()),
                base_url: DEFAULT_BASE_URL.to_string(),
                artifact_dir: artifact_dir.clone(),
                run_id: Some("2026-03-25-010".to_string()),
            },
        };

        let specialist_output = concat!(
            "▶ <ui-journey-artifact>\n",
            "▶ {\n",
            "▶   \"evaluation\": {\n",
            "▶     \"scenario_id\": \"team-automation\",\n",
            "▶     \"run_id\": \"2026-03-25-010\",\n",
            "▶     \"task_fit_score\": 90,\n",
            "▶     \"verdict\": \"Good Fit\",\n",
            "▶     \"findings\": [\n",
            "▶       {\n",
            "▶         \"type\": \"observation\",\n",
            "▶         \"description\": \"Team run showed visible member status.\",\n",
            "▶         \"severity\": \"low\"\n",
            "▶       }\n",
            "▶     ],\n",
            "▶     \"evidence_summary\": \"Team page advanced to a run page.\"\n",
            "▶   },\n",
            "▶   \"summary_markdown\": \"# UI Journey Evaluation\\n\\n- Result: Good Fit\\n\"\n",
            "▶ }\n",
            "▶ </ui-journey-artifact>\n",
        );

        let recovered = recover_success_artifacts_from_output(&context, specialist_output).unwrap();
        assert!(recovered);

        let evaluation_path = std::path::Path::new(&artifact_dir)
            .join("team-automation")
            .join("2026-03-25-010")
            .join("evaluation.json");
        let evaluation: Value =
            serde_json::from_str(&fs::read_to_string(evaluation_path).unwrap()).unwrap();
        assert_eq!(
            evaluation.get("run_id").and_then(Value::as_str),
            Some("2026-03-25-010")
        );
    }

    #[test]
    fn detects_complete_artifact_payload_markers() {
        assert!(output_contains_artifact_payload(
            "<ui-journey-artifact>{}</ui-journey-artifact>"
        ));
        assert!(!output_contains_artifact_payload("<ui-journey-artifact>{}"));
    }

    #[test]
    fn writes_ui_journey_baseline_artifacts() {
        let base_dir = tempdir().unwrap();
        let artifact_dir = base_dir
            .path()
            .join("artifacts")
            .to_string_lossy()
            .to_string();
        let context = UiJourneyRunContext {
            specialist_id: "ui-journey-evaluator".to_string(),
            provider: "opencode".to_string(),
            run_id: "2026-03-25-aggregate".to_string(),
            prompt: UiJourneyPromptParams {
                scenario_id: Some("core-home-session".to_string()),
                base_url: DEFAULT_BASE_URL.to_string(),
                artifact_dir: artifact_dir.clone(),
                run_id: Some("2026-03-25-aggregate".to_string()),
            },
        };
        let aggregate_runs = vec![
            UiJourneyAggregateRun {
                run_id: "run-a".to_string(),
                result: "completed".to_string(),
                task_fit_score: 82,
                verdict: "Good Fit".to_string(),
                failure_stage: None,
                artifact_dir: std::path::Path::new(&artifact_dir)
                    .join("core-home-session")
                    .join("run-a"),
            },
            UiJourneyAggregateRun {
                run_id: "run-b".to_string(),
                result: "incomplete".to_string(),
                task_fit_score: 0,
                verdict: "Incomplete".to_string(),
                failure_stage: Some("provider_readiness".to_string()),
                artifact_dir: std::path::Path::new(&artifact_dir)
                    .join("core-home-session")
                    .join("run-b"),
            },
        ];

        let baseline_path =
            write_baseline_artifacts(&context, "batch-001", &aggregate_runs, 2).unwrap();
        assert!(baseline_path.exists());
        assert!(baseline_path.with_extension("md").exists());

        let baseline: Value =
            serde_json::from_str(&fs::read_to_string(&baseline_path).unwrap()).unwrap();
        assert_eq!(
            baseline.get("completed_runs").and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            baseline
                .get("failure_stage_counts")
                .and_then(|value| value.get("provider_readiness"))
                .and_then(Value::as_u64),
            Some(1)
        );
    }
}
