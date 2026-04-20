//! `routa agent` — Agent management commands.

use std::sync::Arc;
use std::time::{Duration, Instant};

use dialoguer::{theme::ColorfulTheme, Input, Select};
use routa_core::acp::SessionLaunchOptions;
use routa_core::orchestration::{OrchestratorConfig, RoutaOrchestrator, SpecialistConfig};
use routa_core::rpc::RpcRouter;
use routa_core::state::AppState;
use routa_core::workflow::specialist::{SpecialistDef, SpecialistLoader};

use super::print_json;
use super::prompt::update_agent_status;
use super::review::stream_parser::{
    extract_agent_output_from_history, extract_agent_output_from_process_output,
    extract_text_from_prompt_result, extract_update_text, update_contains_turn_complete,
};
use super::tui::TuiRenderer;
use super::{format_rfc3339_timestamp, truncate_text};

mod ui_journey;
mod ui_journey_provider;

use ui_journey::{
    build_context as build_ui_journey_context,
    build_specialist_request as build_ui_journey_specialist_request,
    execution_budget as ui_journey_execution_budget, generate_run_id,
    load_aggregate_run as load_ui_journey_aggregate_run,
    output_contains_artifact_payload as ui_journey_output_contains_artifact_payload,
    recover_success_artifacts_from_output as recover_ui_journey_success_artifacts_from_output,
    validate_prompt as validate_ui_journey_prompt,
    validate_scenario_resource as validate_ui_journey_scenario_resource,
    validate_success_artifacts as validate_ui_journey_success_artifacts,
    write_baseline_artifacts as write_ui_journey_baseline_artifacts,
    write_failure_artifacts as write_ui_journey_failure_artifacts, UiJourneyRunContext,
    UiJourneyRunMetrics, JOURNEY_EVALUATOR_ID,
};
use ui_journey_provider::{
    augment_runtime_failure_message as augment_ui_journey_runtime_failure_message,
    diagnose_runtime_failure as diagnose_ui_journey_runtime_failure,
    extract_provider_output_from_process_output as extract_ui_journey_provider_output_from_process_output,
    normalize_ui_journey_update, verify_provider_readiness,
    RuntimeFailureContext as UiJourneyRuntimeFailureContext,
};

#[derive(Clone, Copy)]
pub struct RunArgs<'a> {
    pub specialist: Option<&'a str>,
    pub specialist_file: Option<&'a str>,
    pub prompt: Option<&'a str>,
    pub workspace_id: &'a str,
    pub provider: Option<&'a str>,
    pub output_json: bool,
    pub cwd_override: Option<&'a str>,
    pub specialist_dir: Option<&'a str>,
    pub provider_timeout_ms: Option<u64>,
    pub provider_retries: u8,
    pub repeat_count: u8,
}

struct SelectedSpecialistRunArgs<'a> {
    selected_specialist: SpecialistConfig,
    user_prompt: String,
    workspace_id: &'a str,
    provider: Option<&'a str>,
    output_json: bool,
    capture_json_output: bool,
    cwd_override: Option<&'a str>,
    provider_timeout_ms: Option<u64>,
    provider_retries: u8,
    repeat_count: u8,
}

struct ExecuteSpecialistRunArgs<'a> {
    selected_specialist: SpecialistConfig,
    user_prompt: String,
    workspace_id: &'a str,
    effective_provider: &'a str,
    output_json: bool,
    capture_json_output: bool,
    cwd_override: Option<&'a str>,
    provider_timeout_ms: Option<u64>,
    provider_retries: u8,
    journey_context_override: Option<UiJourneyRunContext>,
}

struct SpecialistOutputSnapshot<'a> {
    collected_output: &'a str,
    prompt_response: &'a serde_json::Value,
    effective_provider: &'a str,
    history: &'a [serde_json::Value],
}

fn should_finish_non_journey_run(
    journey_context_present: bool,
    output_json: bool,
    snapshot: &SpecialistOutputSnapshot<'_>,
    prompt_finished: bool,
    idle_count: u32,
    prompt_finished_idle_threshold: u32,
) -> bool {
    if journey_context_present || !prompt_finished || idle_count < prompt_finished_idle_threshold {
        return false;
    }

    if !output_json {
        return false;
    }

    collect_specialist_output_candidates(snapshot)
        .iter()
        .any(|candidate| is_strict_json_specialist_candidate(candidate))
}

fn collect_specialist_output_candidates(snapshot: &SpecialistOutputSnapshot<'_>) -> Vec<String> {
    let mut candidates = vec![snapshot.collected_output.to_string()];

    if let Some(text) = extract_text_from_prompt_result(snapshot.prompt_response) {
        candidates.push(text);
    }

    let provider_output = extract_ui_journey_provider_output_from_process_output(
        snapshot.effective_provider,
        snapshot.history,
    );
    if !provider_output.is_empty() {
        candidates.push(provider_output);
    }

    let process_output = extract_agent_output_from_process_output(snapshot.history);
    if !process_output.is_empty() {
        candidates.push(process_output);
    }

    let history_output = extract_agent_output_from_history(snapshot.history);
    if !history_output.is_empty() {
        candidates.push(history_output);
    }

    candidates
}

fn resolve_specialist_output(output_json: bool, snapshot: &SpecialistOutputSnapshot<'_>) -> String {
    let candidates = collect_specialist_output_candidates(snapshot);

    if output_json {
        if let Some(candidate) = select_best_specialist_json_candidate(&candidates, true) {
            return candidate;
        }
        if let Some(candidate) = select_best_specialist_json_candidate(&candidates, false) {
            return candidate;
        }
    }

    candidates
        .into_iter()
        .find(|candidate| !candidate.trim().is_empty())
        .unwrap_or_default()
}

fn is_strict_json_specialist_candidate(candidate: &str) -> bool {
    if candidate.trim().is_empty() {
        return false;
    }

    parse_specialist_json_output_strict(candidate).is_ok()
}

fn select_best_specialist_json_candidate(
    candidates: &[String],
    strict_only: bool,
) -> Option<String> {
    candidates
        .iter()
        .filter_map(|candidate| {
            let trimmed = candidate.trim();
            if trimmed.is_empty() {
                return None;
            }

            let parsed = if strict_only {
                parse_specialist_json_output_strict(candidate).ok()?
            } else {
                parse_specialist_json_output(candidate).ok()?
            };

            Some((score_specialist_json_candidate(&parsed, trimmed), candidate))
        })
        .max_by_key(|(score, _)| *score)
        .map(|(_, candidate)| candidate.clone())
}

fn score_specialist_json_candidate(
    parsed: &serde_json::Value,
    candidate: &str,
) -> (usize, usize, usize) {
    let preferred_keys = [
        "summary",
        "recommendedActions",
        "patchCandidates",
        "verificationPlan",
        "warnings",
        "audit_conclusion",
        "aiAssessment",
    ];
    let preferred_key_matches = preferred_keys
        .iter()
        .filter(|key| parsed.get(**key).is_some())
        .count();
    let top_level_key_count = parsed.as_object().map_or(0, |value| value.len());

    (preferred_key_matches, top_level_key_count, candidate.len())
}

async fn run_internal(
    state: &AppState,
    args: RunArgs<'_>,
    capture_json_output: bool,
) -> Result<Option<serde_json::Value>, String> {
    let RunArgs {
        specialist,
        specialist_file,
        prompt,
        workspace_id,
        provider,
        output_json,
        cwd_override,
        specialist_dir,
        provider_timeout_ms,
        provider_retries,
        repeat_count,
    } = args;
    let router = RpcRouter::new(state.clone());

    let selected_specialist = if let Some(path) = specialist_file {
        load_specialist_from_file(path)?
    } else {
        let specialists = load_specialists(specialist_dir);
        if specialists.is_empty() {
            return Err(
                "No specialists available. Add files under specialists/ or resources/specialists/."
                    .to_string(),
            );
        }

        let (prompt_specialist, prompt_remainder) = parse_prompt_mention(prompt);
        let selected = if let Some(id) = specialist.or(prompt_specialist.as_deref()) {
            find_specialist(&specialists, id).ok_or_else(|| format!("Unknown specialist: {id}"))?
        } else {
            select_specialist(&specialists)?
        };

        let user_prompt = match prompt_remainder.or(prompt.map(|value| value.to_string())) {
            Some(existing_prompt) if !existing_prompt.trim().is_empty() => existing_prompt,
            _ => prompt_for_user_request(&selected)?,
        };

        return run_selected_specialist(
            state,
            &router,
            SelectedSpecialistRunArgs {
                selected_specialist: selected,
                user_prompt,
                workspace_id,
                provider,
                output_json,
                capture_json_output,
                cwd_override,
                provider_timeout_ms,
                provider_retries,
                repeat_count,
            },
        )
        .await;
    };

    let user_prompt = match prompt.map(|value| value.to_string()) {
        Some(existing_prompt) if !existing_prompt.trim().is_empty() => existing_prompt,
        _ => prompt_for_user_request(&selected_specialist)?,
    };

    run_selected_specialist(
        state,
        &router,
        SelectedSpecialistRunArgs {
            selected_specialist,
            user_prompt,
            workspace_id,
            provider,
            output_json,
            capture_json_output,
            cwd_override,
            provider_timeout_ms,
            provider_retries,
            repeat_count,
        },
    )
    .await
}

pub async fn list(state: &AppState, workspace_id: &str, limit: usize) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.list",
            "params": { "workspaceId": workspace_id }
        }))
        .await;

    if let Some(agents) = response
        .get("result")
        .and_then(|result| result.get("agents"))
        .and_then(|value| value.as_array())
    {
        let shown = agents.len().min(limit);
        let hidden = agents.len().saturating_sub(shown);
        println!("Agents ({shown} shown, {hidden} hidden) in workspace {workspace_id}:");
        for agent in agents.iter().take(limit) {
            let status = agent
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            let role = agent
                .get("role")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            let name = agent
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("unnamed");
            let updated_at =
                format_rfc3339_timestamp(agent.get("updatedAt").and_then(|value| value.as_str()));
            let id = agent
                .get("id")
                .and_then(|value| value.as_str())
                .unwrap_or("?");
            println!(
                "  {:<10} {:<10} {:<34} {:<16} {}",
                status,
                role,
                truncate_text(name, 34),
                updated_at,
                short_id(id)
            );
        }
    } else {
        print_json(&response);
    }

    Ok(())
}

fn short_id(value: &str) -> &str {
    value.get(..8).unwrap_or(value)
}

pub async fn create(
    state: &AppState,
    name: &str,
    role: &str,
    workspace_id: &str,
    parent_id: Option<&str>,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let mut params = serde_json::json!({
        "name": name,
        "role": role,
        "workspaceId": workspace_id
    });
    if let Some(pid) = parent_id {
        params["parentId"] = serde_json::json!(pid);
    }
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.create",
            "params": params
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn status(state: &AppState, agent_id: &str) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.get",
            "params": { "id": agent_id }
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn summary(state: &AppState, agent_id: &str) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.get",
            "params": { "id": agent_id }
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn run(state: &AppState, args: RunArgs<'_>) -> Result<(), String> {
    run_internal(state, args, false).await.map(|_| ())
}

pub async fn run_for_json(
    state: &AppState,
    mut args: RunArgs<'_>,
) -> Result<serde_json::Value, String> {
    args.output_json = true;
    run_internal(state, args, true)
        .await?
        .ok_or_else(|| "Specialist did not return JSON output".to_string())
}

async fn run_selected_specialist(
    state: &AppState,
    router: &RpcRouter,
    args: SelectedSpecialistRunArgs<'_>,
) -> Result<Option<serde_json::Value>, String> {
    let SelectedSpecialistRunArgs {
        selected_specialist,
        user_prompt,
        workspace_id,
        provider,
        output_json,
        capture_json_output,
        cwd_override,
        provider_timeout_ms,
        provider_retries,
        repeat_count,
    } = args;
    let effective_provider = provider
        .map(str::to_string)
        .or_else(|| selected_specialist.default_provider.clone())
        .unwrap_or_else(|| "opencode".to_string());

    if repeat_count > 1 && selected_specialist.id != JOURNEY_EVALUATOR_ID {
        return Err(format!(
            "--repeat is only supported for specialist '{JOURNEY_EVALUATOR_ID}'"
        ));
    }

    if repeat_count <= 1 {
        return execute_specialist_run(
            state,
            router,
            ExecuteSpecialistRunArgs {
                selected_specialist,
                user_prompt,
                workspace_id,
                effective_provider: &effective_provider,
                output_json,
                capture_json_output,
                cwd_override,
                provider_timeout_ms,
                provider_retries,
                journey_context_override: None,
            },
        )
        .await;
    }

    let batch_run_id = generate_run_id();
    let mut aggregate_runs = Vec::new();
    let mut failed_runs = 0usize;

    for iteration in 1..=repeat_count {
        println!("═══ UI Journey Baseline Run {iteration}/{repeat_count} ({batch_run_id}) ═══");
        let context =
            build_ui_journey_context(&selected_specialist.id, &user_prompt, &effective_provider)
                .ok_or_else(|| "Failed to build UI journey context".to_string())?;

        let run_result = execute_specialist_run(
            state,
            router,
            ExecuteSpecialistRunArgs {
                selected_specialist: selected_specialist.clone(),
                user_prompt: user_prompt.clone(),
                workspace_id,
                effective_provider: &effective_provider,
                output_json,
                capture_json_output,
                cwd_override,
                provider_timeout_ms,
                provider_retries,
                journey_context_override: Some(context.clone()),
            },
        )
        .await;

        if run_result.is_err() {
            failed_runs += 1;
        }

        aggregate_runs.push(load_ui_journey_aggregate_run(&context)?);
    }

    let aggregate_context =
        build_ui_journey_context(&selected_specialist.id, &user_prompt, &effective_provider)
            .ok_or_else(|| "Failed to build UI journey aggregate context".to_string())?;
    let baseline_path = write_ui_journey_baseline_artifacts(
        &aggregate_context,
        &batch_run_id,
        &aggregate_runs,
        repeat_count,
    )?;

    if failed_runs > 0 {
        return Err(format!(
            "Completed {} UI journey runs with {} failures. Baseline summary written to {}",
            repeat_count,
            failed_runs,
            baseline_path.display()
        ));
    }

    println!(
        "📊 UI journey baseline summary written to {}",
        baseline_path.display()
    );
    Ok(None)
}

async fn execute_specialist_run(
    state: &AppState,
    router: &RpcRouter,
    args: ExecuteSpecialistRunArgs<'_>,
) -> Result<Option<serde_json::Value>, String> {
    let ExecuteSpecialistRunArgs {
        selected_specialist,
        user_prompt,
        workspace_id,
        effective_provider,
        output_json,
        capture_json_output,
        cwd_override,
        provider_timeout_ms,
        provider_retries,
        journey_context_override,
    } = args;
    let run_start = Instant::now();
    let wall_clock_start = std::time::SystemTime::now();
    let journey_context = journey_context_override.or_else(|| {
        build_ui_journey_context(&selected_specialist.id, &user_prompt, effective_provider)
    });
    let execution_budget = journey_context
        .as_ref()
        .map(|_| ui_journey_execution_budget());
    let mut metrics = UiJourneyRunMetrics {
        attempts: 0,
        provider_timeout_ms,
        provider_retries,
        elapsed_ms: 0,
        initialization_elapsed_ms: None,
        session_id: None,
        prompt_status: None,
        history_entry_count: 0,
        output_chars: 0,
        last_process_output: None,
    };

    if let Some(context) = journey_context.as_ref() {
        if let Err(error) = validate_ui_journey_prompt(&context.prompt) {
            metrics.elapsed_ms = run_start.elapsed().as_millis();
            write_ui_journey_failure_artifacts(context, "prompt_validation", &error, &metrics);
            return Err(error);
        }

        if let Err(error) = validate_ui_journey_scenario_resource(context) {
            metrics.elapsed_ms = run_start.elapsed().as_millis();
            write_ui_journey_failure_artifacts(context, "scenario_resolution", &error, &metrics);
            return Err(error);
        }
    }

    let verify_provider =
        verify_provider_readiness(effective_provider, !capture_json_output && !output_json).await;
    if let Err(error) = verify_provider {
        if let Some(context) = journey_context.as_ref() {
            metrics.elapsed_ms = run_start.elapsed().as_millis();
            write_ui_journey_failure_artifacts(context, "provider_readiness", &error, &metrics);
        }
        return Err(format!("Failed to verify provider: {error}"));
    }

    let workspace_id = ensure_workspace(router, workspace_id).await?;
    let agent_role = selected_specialist.role.as_str();
    let agent_name = format!("cli-{}", selected_specialist.id);
    let create_response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.create",
            "params": {
                "name": agent_name,
                "role": agent_role,
                "workspaceId": &workspace_id
            }
        }))
        .await;

    let agent_id = create_response
        .get("result")
        .and_then(|r| r.get("agentId"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            let error_msg = create_response
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error");
            let err = format!("Failed to create agent: {error_msg}");
            if let Some(context) = journey_context.as_ref() {
                metrics.elapsed_ms = run_start.elapsed().as_millis();
                write_ui_journey_failure_artifacts(context, "agent_creation", &err, &metrics);
            }
            err
        })?
        .to_string();

    let cwd = cwd_override.map(ToString::to_string).unwrap_or_else(|| {
        std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string())
    });

    if !output_json {
        println!("╔══════════════════════════════════════════════════════════╗");
        println!("║  Routa CLI — Specialist Run                            ║");
        println!("╠══════════════════════════════════════════════════════════╣");
        println!("║  Specialist: {:<42} ║", selected_specialist.id);
        println!("║  Role      : {agent_role:<42} ║");
        println!("║  Workspace : {:<42} ║", &workspace_id);
        println!("║  Provider  : {effective_provider:<42} ║");
        println!(
            "║  CWD       : {:<42} ║",
            super::prompt::truncate_path(&cwd, 42)
        );
        println!("╚══════════════════════════════════════════════════════════╝");
        println!();
        println!("📋 Prompt: {user_prompt}");
        println!();
    }

    let launch_options = SessionLaunchOptions {
        initialize_timeout_ms: provider_timeout_ms,
        specialist_id: Some(selected_specialist.id.clone()),
        provider_args: (effective_provider.eq_ignore_ascii_case("codex")
            && output_json
            && journey_context.is_none())
        .then(|| {
            vec![
                "-c".to_string(),
                "model_reasoning_effort=\"low\"".to_string(),
            ]
        }),
        ..SessionLaunchOptions::default()
    };

    let max_attempts = 1usize + usize::from(provider_retries);
    let mut final_session_id: Option<String> = None;
    let mut last_session_error = String::new();

    for attempt in 1..=max_attempts {
        metrics.attempts = attempt as u32;
        let attempt_start = Instant::now();
        let attempt_session_id = uuid::Uuid::new_v4().to_string();
        let create_result = state
            .acp_manager
            .create_session_with_options(
                attempt_session_id.clone(),
                cwd.clone(),
                workspace_id.clone(),
                Some(effective_provider.to_string()),
                Some(agent_role.to_string()),
                selected_specialist.default_model.clone(),
                None,
                None,
                None,
                launch_options.clone(),
            )
            .await;

        match create_result {
            Ok((_, _)) => {
                metrics.initialization_elapsed_ms = Some(attempt_start.elapsed().as_millis());
                final_session_id = Some(attempt_session_id);
                break;
            }
            Err(err) => {
                let reason = format!("Attempt {attempt} failed: {err}");
                last_session_error = reason.clone();

                if attempt < max_attempts {
                    if !output_json {
                        println!("⚠️  {reason}. Retrying in 1 second...");
                    }
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }

                let error = format!("Failed to create ACP session: {err}");
                if let Some(context) = journey_context.as_ref() {
                    metrics.elapsed_ms = run_start.elapsed().as_millis();
                    write_ui_journey_failure_artifacts(
                        context,
                        "session_creation",
                        &error,
                        &metrics,
                    );
                }
                if let Err(status_err) = update_agent_status(router, &agent_id, "ERROR").await {
                    eprintln!("Failed to mark agent {agent_id} ERROR: {status_err}");
                }
                return Err(error);
            }
        }
    }

    let session_id = final_session_id.ok_or_else(|| {
        format!("Failed to create ACP session after {max_attempts} attempts: {last_session_error}")
    })?;
    metrics.session_id = Some(session_id.clone());
    if let Err(err) = update_agent_status(router, &agent_id, "ACTIVE").await {
        eprintln!("Failed to mark agent {agent_id} ACTIVE: {err}");
    }

    let acp = Arc::new(state.acp_manager.clone());
    let orchestrator = RoutaOrchestrator::new(
        OrchestratorConfig::default(),
        acp,
        state.agent_store.clone(),
        state.task_store.clone(),
        state.event_bus.clone(),
    );
    orchestrator
        .register_agent_session(&agent_id, &session_id)
        .await;

    let mut rx = match state.acp_manager.subscribe(&session_id).await {
        Some(rx) => rx,
        None => {
            if let Err(status_err) = update_agent_status(router, &agent_id, "ERROR").await {
                eprintln!("Failed to mark agent {agent_id} ERROR: {status_err}");
            }
            state.acp_manager.kill_session(&session_id).await;
            orchestrator.cleanup(&session_id).await;
            return Err("Failed to subscribe to session updates".to_string());
        }
    };

    let effective_user_prompt = journey_context
        .as_ref()
        .map(build_ui_journey_specialist_request)
        .unwrap_or_else(|| user_prompt.clone());
    let initial_prompt = build_specialist_prompt(
        &selected_specialist,
        &agent_id,
        &workspace_id,
        &effective_user_prompt,
    );

    if !output_json {
        println!("🚀 Sending prompt to specialist...");
        println!();
    }

    if let Some(budget) = execution_budget {
        if run_start.elapsed() >= budget {
            let error = format!(
                "UI journey exceeded max runtime budget of {} seconds before prompt submission",
                budget.as_secs()
            );
            if let Some(context) = journey_context.as_ref() {
                metrics.elapsed_ms = run_start.elapsed().as_millis();
                write_ui_journey_failure_artifacts(context, "execution_timeout", &error, &metrics);
            }
            if let Err(status_err) = update_agent_status(router, &agent_id, "ERROR").await {
                eprintln!("Failed to mark agent {agent_id} ERROR: {status_err}");
            }
            state.acp_manager.kill_session(&session_id).await;
            orchestrator.cleanup(&session_id).await;
            return Err(error);
        }
    }

    let mut renderer = (!output_json).then(TuiRenderer::new);
    let mut idle_count = 0u32;
    let max_idle = if output_json && journey_context.is_none() {
        30
    } else {
        600
    };
    let prompt_finished_idle_threshold = 10;
    let mut failure_reason: Option<String> = None;
    let mut collected_output = String::new();
    let mut prompt_response = serde_json::Value::Null;
    let mut prompt_error: Option<String> = None;
    let mut prompt_finished = false;
    metrics.prompt_status = Some("pending".to_string());
    let prompt_future = state.acp_manager.prompt(&session_id, &initial_prompt);
    tokio::pin!(prompt_future);

    loop {
        if let Some(budget) = execution_budget {
            if run_start.elapsed() >= budget {
                if let Some(renderer) = renderer.as_mut() {
                    renderer.finish();
                }
                if !output_json {
                    println!(
                        "⏰ UI journey exceeded max runtime budget of {} seconds",
                        budget.as_secs()
                    );
                }
                failure_reason = Some("execution_timeout".to_string());
                break;
            }
        }

        let tick = tokio::time::sleep(std::time::Duration::from_secs(1));
        tokio::pin!(tick);

        tokio::select! {
            prompt_result = &mut prompt_future, if !prompt_finished => {
                prompt_finished = true;
                match prompt_result {
                    Ok(response) => {
                        prompt_response = response;
                        metrics.prompt_status = Some("acknowledged".to_string());
                    }
                    Err(err)
                        if journey_context.is_some()
                            && err
                                .to_string()
                                .contains("Timeout waiting for session/prompt") =>
                    {
                        metrics.prompt_status = Some("rpc_timeout".to_string());
                        if output_json {
                            eprintln!(
                                "⚠️  Prompt submission timed out waiting for RPC response; continuing to monitor session output..."
                            );
                        } else {
                            println!(
                                "⚠️  Prompt submission timed out waiting for RPC response; continuing to monitor session output..."
                            );
                        }
                    }
                    Err(err) => {
                        metrics.prompt_status = Some("error".to_string());
                        prompt_error = Some(format!("Failed to send prompt: {err}"));
                    }
                }
            }
            recv_result = rx.recv() => {
                match recv_result {
                    Ok(update) => {
                        // Provider normalization is useful beyond UI-journey runs.
                        // Codex emits raw process_output and thought events that can pollute
                        // JSON-specialist output unless we canonicalize them first.
                        let normalized_update =
                            normalize_ui_journey_update(effective_provider, &update);

                        let Some(normalized_update) = normalized_update else {
                            continue;
                        };
                        idle_count = 0;

                        let update_payload = normalized_update
                            .get("params")
                            .and_then(|params| params.get("update"))
                            .and_then(|value| value.as_object());
                        if let Some(update_payload) = update_payload {
                            if let Some(text) = extract_update_text(update_payload) {
                                collected_output.push_str(&text);
                            }
                        }
                        if journey_context.is_none()
                            && output_json
                            && prompt_finished
                            && is_strict_json_specialist_candidate(&collected_output)
                        {
                            if let Some(renderer) = renderer.as_mut() {
                                renderer.finish();
                            }
                            break;
                        }
                        if let Some(renderer) = renderer.as_mut() {
                            renderer.handle_update(&normalized_update);
                        }
                        let payload_complete = journey_context.is_some()
                            && ui_journey_output_contains_artifact_payload(&collected_output);
                        let turn_complete = normalized_update
                            .get("params")
                            .and_then(|params| params.get("update"))
                            .and_then(|value| value.get("sessionUpdate"))
                            .and_then(|value| value.as_str())
                            == Some("turn_complete");
                        if payload_complete || turn_complete {
                            if let Some(renderer) = renderer.as_mut() {
                                renderer.finish();
                            }
                            if !output_json {
                                if payload_complete {
                                    println!("═══ Specialist artifact payload received ═══");
                                } else {
                                    println!("═══ Specialist turn complete ═══");
                                }
                            }
                            break;
                        }
                    }
                    Err(_) => {
                        if let Some(renderer) = renderer.as_mut() {
                            renderer.finish();
                        }
                        if !output_json {
                            println!("═══ Specialist session ended ═══");
                        }
                        break;
                    }
                }
            }
            _ = &mut tick => {
                idle_count += 1;
                if let Some(history) = state.acp_manager.get_session_history(&session_id).await {
                    if update_contains_turn_complete(&history) {
                        if let Some(renderer) = renderer.as_mut() {
                            renderer.finish();
                        }
                        if !output_json {
                            println!("═══ Specialist turn complete ═══");
                        }
                        break;
                    }
                    let snapshot = SpecialistOutputSnapshot {
                        collected_output: &collected_output,
                        prompt_response: &prompt_response,
                        effective_provider,
                        history: &history,
                    };
                    if should_finish_non_journey_run(
                        journey_context.is_some(),
                        output_json,
                        &snapshot,
                        prompt_finished,
                        idle_count,
                        prompt_finished_idle_threshold,
                    ) {
                        if let Some(renderer) = renderer.as_mut() {
                            renderer.finish();
                        }
                        if !output_json {
                            println!("═══ Specialist response complete ═══");
                        }
                        break;
                    }
                }

                if idle_count >= max_idle {
                    if let Some(renderer) = renderer.as_mut() {
                        renderer.finish();
                    }
                    if !output_json {
                        println!("⏰ Timeout: no activity for {max_idle} seconds");
                    }
                    failure_reason = Some("session_idle_timeout".to_string());
                    break;
                }

                if !state.acp_manager.is_alive(&session_id).await {
                    if let Some(renderer) = renderer.as_mut() {
                        renderer.finish();
                    }
                    if !output_json {
                        println!("═══ Specialist process exited ═══");
                    }
                    failure_reason = Some("provider_process_exited".to_string());
                    break;
                }
            }
        }
    }

    let history = state
        .acp_manager
        .get_session_history(&session_id)
        .await
        .unwrap_or_default();
    metrics.history_entry_count = history.len();
    metrics.last_process_output = extract_last_process_output_line(&history);
    let specialist_output = resolve_specialist_output(
        output_json,
        &SpecialistOutputSnapshot {
            collected_output: &collected_output,
            prompt_response: &prompt_response,
            effective_provider,
            history: &history,
        },
    );
    metrics.output_chars = specialist_output.chars().count();

    if prompt_error.is_some() && specialist_output.trim().is_empty() && failure_reason.is_none() {
        let failure_stage = diagnose_ui_journey_runtime_failure(
            effective_provider,
            wall_clock_start,
            metrics.prompt_status.as_deref(),
            metrics.history_entry_count,
            metrics.output_chars,
            metrics.last_process_output.as_deref(),
            None,
        )
        .and_then(|diagnostic| diagnostic.failure_stage_override)
        .unwrap_or("prompt_submission");
        let error = augment_ui_journey_runtime_failure_message(
            &prompt_error.unwrap_or_else(|| "Failed to send prompt".to_string()),
            &UiJourneyRuntimeFailureContext {
                provider: effective_provider,
                run_started_at: wall_clock_start,
                prompt_status: metrics.prompt_status.as_deref(),
                history_entry_count: metrics.history_entry_count,
                output_chars: metrics.output_chars,
                last_process_output: metrics.last_process_output.as_deref(),
                provider_output: None,
            },
        );
        if let Some(context) = journey_context.as_ref() {
            metrics.elapsed_ms = run_start.elapsed().as_millis();
            write_ui_journey_failure_artifacts(context, failure_stage, &error, &metrics);
        }
        if journey_context.is_none() && !output_json {
            if let Err(status_err) = update_agent_status(router, &agent_id, "ERROR").await {
                eprintln!("Failed to mark agent {agent_id} ERROR: {status_err}");
            }
            println!();
            super::prompt::print_session_summary(
                router,
                &workspace_id,
                Some(&agent_id),
                Some(&session_id),
            )
            .await;
        }
        state.acp_manager.kill_session(&session_id).await;
        orchestrator.cleanup(&session_id).await;
        return Err(error);
    }

    let terminal_status = if failure_reason.is_some() {
        "ERROR"
    } else {
        "COMPLETED"
    };
    if let Err(err) = update_agent_status(router, &agent_id, terminal_status).await {
        eprintln!("Failed to mark agent {agent_id} {terminal_status}: {err}");
    }

    if journey_context.is_none() && !output_json {
        println!();
        super::prompt::print_session_summary(
            router,
            &workspace_id,
            Some(&agent_id),
            Some(&session_id),
        )
        .await;
    }

    state.acp_manager.kill_session(&session_id).await;
    orchestrator.cleanup(&session_id).await;

    if let Some(context) = journey_context.as_ref() {
        if let Some(reason) = failure_reason.as_deref() {
            metrics.elapsed_ms = run_start.elapsed().as_millis();
            let default_failure_summary = match reason {
                "session_idle_timeout" => "Session timed out with no activity",
                "execution_timeout" => "UI journey exceeded the maximum runtime budget",
                _ => "Provider process exited unexpectedly",
            };
            let failure_stage = diagnose_ui_journey_runtime_failure(
                effective_provider,
                wall_clock_start,
                metrics.prompt_status.as_deref(),
                metrics.history_entry_count,
                metrics.output_chars,
                metrics.last_process_output.as_deref(),
                Some(specialist_output.as_str()),
            )
            .and_then(|diagnostic| diagnostic.failure_stage_override)
            .unwrap_or(reason);
            let failure_summary = augment_ui_journey_runtime_failure_message(
                default_failure_summary,
                &UiJourneyRuntimeFailureContext {
                    provider: effective_provider,
                    run_started_at: wall_clock_start,
                    prompt_status: metrics.prompt_status.as_deref(),
                    history_entry_count: metrics.history_entry_count,
                    output_chars: metrics.output_chars,
                    last_process_output: metrics.last_process_output.as_deref(),
                    provider_output: Some(specialist_output.as_str()),
                },
            );
            write_ui_journey_failure_artifacts(context, failure_stage, &failure_summary, &metrics);
            return Err(format!(
                "Failed to complete specialist run: {failure_summary}"
            ));
        }
    }

    if let Some(context) = journey_context.as_ref() {
        metrics.elapsed_ms = run_start.elapsed().as_millis();
        if let Err(error) =
            recover_ui_journey_success_artifacts_from_output(context, &specialist_output)
        {
            write_ui_journey_failure_artifacts(context, "artifact_recovery", &error, &metrics);
            return Err(error);
        }
        if let Err(error) = validate_ui_journey_success_artifacts(context, &metrics) {
            write_ui_journey_failure_artifacts(context, "artifact_validation", &error, &metrics);
            return Err(error);
        }
    }

    if journey_context.is_none() && output_json {
        if let Some(reason) = failure_reason.as_deref() {
            return Err(format!("Failed to complete specialist JSON run: {reason}"));
        }
        let parsed = parse_specialist_json_output(&specialist_output)?;
        if capture_json_output {
            return Ok(Some(parsed));
        }
        println!(
            "{}",
            serde_json::to_string_pretty(&parsed)
                .map_err(|err| format!("Failed to format specialist JSON output: {err}"))?
        );
    }

    Ok(None)
}

fn parse_specialist_json_output(output: &str) -> Result<serde_json::Value, String> {
    match parse_specialist_json_output_strict(output) {
        Ok(parsed) => Ok(parsed),
        Err(_) => {
            let trimmed = output.trim();
            if trimmed.is_empty() {
                return Err("Specialist output is empty; expected JSON object".to_string());
            }

            let normalized_lines = trimmed
                .lines()
                .map(|line| {
                    line.trim_start_matches(|char: char| char.is_whitespace() || char == '▶')
                })
                .collect::<Vec<_>>()
                .join("\n");
            let stripped_controls = normalized_lines
                .chars()
                .filter(|char| matches!(char, '\n' | '\r' | '\t') || !char.is_control())
                .collect::<String>();
            let candidate =
                extract_json_object_slice(&stripped_controls).unwrap_or(stripped_controls.as_str());
            let repaired = repair_truncated_json_candidate(candidate);
            serde_json::from_str::<serde_json::Value>(&repaired).map_err(|err| {
                format!(
                    "Specialist output is not valid JSON (raw_len={}): {}",
                    output.chars().count(),
                    err
                )
            })
        }
    }
}

fn parse_specialist_json_output_strict(output: &str) -> Result<serde_json::Value, String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Err("Specialist output is empty; expected JSON object".to_string());
    }

    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Ok(parsed);
    }

    let normalized_lines = trimmed
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
    let candidate = escape_unescaped_json_string_controls(candidate);

    serde_json::from_str::<serde_json::Value>(&candidate).map_err(|err| {
        format!(
            "Specialist output is not valid JSON (raw_len={}): {}",
            output.chars().count(),
            err
        )
    })
}

fn extract_json_object_slice(value: &str) -> Option<&str> {
    let first = value.find('{')?;
    let last = value.rfind('}')?;
    (first <= last).then_some(&value[first..=last])
}

fn repair_truncated_json_candidate(candidate: &str) -> String {
    let mut repaired = String::with_capacity(candidate.len() + 8);
    let mut stack = Vec::new();
    let mut in_string = false;
    let mut escaped = false;

    for ch in candidate.chars() {
        repaired.push(ch);
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' | '[' => stack.push(ch),
            '}' => {
                if stack.last() == Some(&'{') {
                    stack.pop();
                }
            }
            ']' => {
                if stack.last() == Some(&'[') {
                    stack.pop();
                }
            }
            _ => {}
        }
    }

    if in_string {
        repaired.push('"');
    }

    for opener in stack.iter().rev() {
        repaired.push(match opener {
            '{' => '}',
            '[' => ']',
            _ => continue,
        });
    }

    repaired
}

fn escape_unescaped_json_string_controls(candidate: &str) -> String {
    let mut normalized = String::with_capacity(candidate.len());
    let mut in_string = false;
    let mut escaped = false;

    for ch in candidate.chars() {
        if in_string {
            if escaped {
                normalized.push(ch);
                escaped = false;
                continue;
            }

            match ch {
                '\\' => {
                    normalized.push(ch);
                    escaped = true;
                }
                '"' => {
                    normalized.push(ch);
                    in_string = false;
                }
                '\n' => normalized.push_str("\\n"),
                '\r' => normalized.push_str("\\r"),
                '\t' => normalized.push_str("\\t"),
                _ => normalized.push(ch),
            }
            continue;
        }

        if ch == '"' {
            in_string = true;
        }
        normalized.push(ch);
    }

    normalized
}

fn extract_last_process_output_line(history: &[serde_json::Value]) -> Option<String> {
    history.iter().rev().find_map(|entry| {
        let update = entry
            .get("params")
            .and_then(|params| params.get("update"))
            .and_then(|value| value.as_object())?;
        let session_update = update
            .get("sessionUpdate")
            .and_then(|value| value.as_str())?;
        if session_update != "process_output" {
            return None;
        }
        update
            .get("data")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn load_specialist_from_file(path: &str) -> Result<SpecialistConfig, String> {
    let specialist = SpecialistDef::from_path(path)?;
    SpecialistConfig::from_specialist_def(specialist)
        .ok_or_else(|| format!("Failed to resolve specialist from file: {path}"))
}

fn load_specialists(specialist_dir: Option<&str>) -> Vec<SpecialistConfig> {
    let mut specialists = SpecialistConfig::list_available();

    if let Some(dir) = specialist_dir {
        let mut loader = SpecialistLoader::new();
        if loader.load_dir(dir).is_ok() {
            for specialist in loader
                .all()
                .values()
                .cloned()
                .filter_map(SpecialistConfig::from_specialist_def)
            {
                if let Some(index) = specialists
                    .iter()
                    .position(|current| current.id == specialist.id)
                {
                    specialists[index] = specialist;
                } else {
                    specialists.push(specialist);
                }
            }
        }
    }

    specialists.sort_by(|left, right| left.id.cmp(&right.id));
    specialists
}

fn parse_prompt_mention(prompt: Option<&str>) -> (Option<String>, Option<String>) {
    let Some(prompt) = prompt.map(str::trim) else {
        return (None, None);
    };

    let Some(without_marker) = prompt.strip_prefix('@') else {
        return (None, None);
    };

    let mut parts = without_marker.splitn(2, char::is_whitespace);
    let specialist = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase());
    let remainder = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    (specialist, remainder)
}

fn prompt_for_user_request(specialist: &SpecialistConfig) -> Result<String, String> {
    let theme = ColorfulTheme::default();
    let prompt = Input::with_theme(&theme)
        .with_prompt(format!("Prompt for {}", specialist.name))
        .interact_text()
        .map_err(|e| format!("Failed to read prompt: {e}"))?;

    Ok(prompt)
}

fn select_specialist(specialists: &[SpecialistConfig]) -> Result<SpecialistConfig, String> {
    let theme = ColorfulTheme::default();
    let items = specialists
        .iter()
        .map(|specialist| {
            format!(
                "{} ({}){}",
                specialist.id,
                specialist.role.as_str(),
                specialist
                    .description
                    .as_ref()
                    .map(|description| format!(" - {description}"))
                    .unwrap_or_default()
            )
        })
        .collect::<Vec<_>>();

    let index = Select::with_theme(&theme)
        .with_prompt("Select a specialist")
        .items(&items)
        .default(0)
        .interact()
        .map_err(|e| format!("Failed to select specialist: {e}"))?;

    Ok(specialists[index].clone())
}

fn find_specialist(specialists: &[SpecialistConfig], id: &str) -> Option<SpecialistConfig> {
    let target = id.to_lowercase();
    specialists
        .iter()
        .find(|specialist| specialist.id == target)
        .cloned()
}

fn build_specialist_prompt(
    specialist: &SpecialistConfig,
    agent_id: &str,
    workspace_id: &str,
    prompt: &str,
) -> String {
    format!(
        "{}\n\n---\n\n**Your Agent ID:** {}\n**Workspace ID:** {}\n\n## User Request\n\n{}\n\n---\n**Reminder:** {}\n",
        specialist
            .system_prompt_body()
            .unwrap_or_else(|| specialist.system_prompt.clone()),
        agent_id,
        workspace_id,
        prompt,
        specialist.role_reminder
    )
}

async fn ensure_workspace(router: &RpcRouter, workspace_id: &str) -> Result<String, String> {
    if workspace_id == "default" {
        return Ok("default".to_string());
    }

    let ws_response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "workspaces.get",
            "params": { "id": workspace_id }
        }))
        .await;

    if ws_response.get("error").is_none() {
        return Ok(workspace_id.to_string());
    }

    let create_resp = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "workspaces.create",
            "params": { "title": workspace_id }
        }))
        .await;

    if let Some(err) = create_resp.get("error") {
        let err_msg = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("Failed to create workspace: {err_msg}"));
    }

    let created_ws_id = create_resp
        .get("result")
        .and_then(|r| r.get("workspace"))
        .and_then(|w| w.get("id"))
        .and_then(|id| id.as_str())
        .ok_or("Failed to get created workspace ID")?
        .to_string();

    println!("Created workspace: {created_ws_id}");
    Ok(created_ws_id)
}

#[cfg(test)]
mod tests {
    use super::{
        parse_prompt_mention, parse_specialist_json_output, resolve_specialist_output,
        should_finish_non_journey_run, SpecialistOutputSnapshot,
    };
    use routa_core::orchestration::SpecialistConfig;

    #[test]
    fn parses_prompt_mentions_with_inline_prompt() {
        let (specialist, prompt) =
            parse_prompt_mention(Some("@view-git-change summarize the diff"));
        assert_eq!(specialist.as_deref(), Some("view-git-change"));
        assert_eq!(prompt.as_deref(), Some("summarize the diff"));
    }

    #[test]
    fn ignores_plain_prompts() {
        let (specialist, prompt) = parse_prompt_mention(Some("summarize the diff"));
        assert!(specialist.is_none());
        assert!(prompt.is_none());
    }

    #[test]
    fn prefers_specialist_execution_provider_when_cli_provider_missing() {
        let specialist = SpecialistConfig {
            id: "test".to_string(),
            name: "Test".to_string(),
            description: None,
            role: routa_core::models::agent::AgentRole::Developer,
            default_model_tier: routa_core::models::agent::ModelTier::Smart,
            system_prompt: "prompt".to_string(),
            role_reminder: String::new(),
            default_provider: Some("claude".to_string()),
            default_adapter: None,
            default_model: Some("sonnet-4.5".to_string()),
        };

        let effective_provider = None
            .map(str::to_string)
            .or_else(|| specialist.default_provider.clone())
            .unwrap_or_else(|| "opencode".to_string());

        assert_eq!(effective_provider, "claude");
        assert_eq!(specialist.default_model.as_deref(), Some("sonnet-4.5"));
    }

    #[test]
    fn parses_specialist_json_output_with_stream_prefixes() {
        let output = "▶ {\"audit_conclusion\":{\"overall\":\"通过\",\"total_score\":16,\"one_sentence\":\"ok\"}}";
        let parsed = parse_specialist_json_output(output).expect("should parse prefixed JSON");
        assert_eq!(
            parsed
                .get("audit_conclusion")
                .and_then(|v| v.get("total_score"))
                .and_then(|v| v.as_i64()),
            Some(16)
        );
    }

    #[test]
    fn parses_specialist_json_output_with_text_wrapper() {
        let output = "thinking...\n{\"audit_conclusion\":{\"overall\":\"有条件通过\",\"total_score\":13,\"one_sentence\":\"gap\"}}\n";
        let parsed = parse_specialist_json_output(output).expect("should extract JSON object");
        assert_eq!(
            parsed
                .get("audit_conclusion")
                .and_then(|v| v.get("overall"))
                .and_then(|v| v.as_str()),
            Some("有条件通过")
        );
    }

    #[test]
    fn parses_specialist_json_output_with_raw_newlines_inside_strings() {
        let output = "{\"summary\":{\"overallAssessment\":\"line one\nline two\"}}";
        let parsed = parse_specialist_json_output(output)
            .expect("should escape raw newlines inside strings");
        assert_eq!(
            parsed
                .get("summary")
                .and_then(|v| v.get("overallAssessment"))
                .and_then(|v| v.as_str()),
            Some("line one\nline two")
        );
    }

    #[test]
    fn parses_repaired_truncated_json_output() {
        let output = "{\"summary\":{\"mode\":\"dry-run\"},\"verificationPlan\":[{\"label\":\"x\"}";
        let parsed = parse_specialist_json_output(output).expect("should repair truncated JSON");
        assert_eq!(
            parsed
                .get("summary")
                .and_then(|v| v.get("mode"))
                .and_then(|v| v.as_str()),
            Some("dry-run")
        );
    }

    #[test]
    fn finishes_non_journey_run_after_prompt_completion_idle_threshold() {
        let history = Vec::new();
        let prompt_response = serde_json::Value::Null;
        let snapshot = SpecialistOutputSnapshot {
            collected_output: "",
            prompt_response: &prompt_response,
            effective_provider: "claude",
            history: &history,
        };
        assert!(!should_finish_non_journey_run(
            false, true, &snapshot, false, 3, 3
        ));
        let ready_snapshot = SpecialistOutputSnapshot {
            collected_output: "{\"ok\":true}",
            prompt_response: &prompt_response,
            effective_provider: "claude",
            history: &history,
        };
        assert!(!should_finish_non_journey_run(
            true,
            true,
            &ready_snapshot,
            true,
            3,
            3
        ));
        assert!(!should_finish_non_journey_run(
            false,
            false,
            &ready_snapshot,
            true,
            3,
            3
        ));
        let incomplete_snapshot = SpecialistOutputSnapshot {
            collected_output: "{\"ok\":",
            prompt_response: &prompt_response,
            effective_provider: "claude",
            history: &history,
        };
        assert!(!should_finish_non_journey_run(
            false,
            true,
            &incomplete_snapshot,
            true,
            3,
            3
        ));
        assert!(!should_finish_non_journey_run(
            false,
            true,
            &ready_snapshot,
            true,
            2,
            3
        ));
        assert!(should_finish_non_journey_run(
            false,
            true,
            &ready_snapshot,
            true,
            3,
            3
        ));
        let repaired_only_snapshot = SpecialistOutputSnapshot {
            collected_output: "{\"ok\":true",
            prompt_response: &prompt_response,
            effective_provider: "claude",
            history: &history,
        };
        assert!(!should_finish_non_journey_run(
            false,
            true,
            &repaired_only_snapshot,
            true,
            3,
            3
        ));
    }

    #[test]
    fn resolve_specialist_output_prefers_parseable_json_candidate() {
        let prompt_response = serde_json::json!({
            "result": {
                "text": "{\"ok\":true,\"source\":\"prompt\"}"
            }
        });
        let resolved = resolve_specialist_output(
            true,
            &SpecialistOutputSnapshot {
                collected_output: "{\"ok\":",
                prompt_response: &prompt_response,
                effective_provider: "codex",
                history: &[],
            },
        );
        assert_eq!(resolved, "{\"ok\":true,\"source\":\"prompt\"}");
    }

    #[test]
    fn resolve_specialist_output_prefers_more_complete_json_candidate() {
        let prompt_response = serde_json::json!({
            "result": {
                "text": "{\"summary\":{\"mode\":\"dry-run\"},\"verificationPlan\":[{\"label\":\"verify\"}],\"warnings\":[]}"
            }
        });
        let resolved = resolve_specialist_output(
            true,
            &SpecialistOutputSnapshot {
                collected_output: "{\"summary\":{\"mode\":\"dry-run\"}}",
                prompt_response: &prompt_response,
                effective_provider: "codex",
                history: &[],
            },
        );
        assert_eq!(
            resolved,
            "{\"summary\":{\"mode\":\"dry-run\"},\"verificationPlan\":[{\"label\":\"verify\"}],\"warnings\":[]}"
        );
    }
}
