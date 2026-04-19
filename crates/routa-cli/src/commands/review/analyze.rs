use routa_core::state::AppState;
use routa_core::workflow::agent_caller::{AcpAgentCaller, AgentCallConfig};
use routa_core::workflow::specialist::SpecialistDef;

use super::output::print_review_result;
use super::shared::{
    build_review_input_payload, load_dotenv, load_specialist_by_id, resolve_repo_root,
    ReviewAnalyzeOptions, ReviewInputPayload, ReviewWorkerType,
};

pub async fn analyze(_state: &AppState, options: ReviewAnalyzeOptions<'_>) -> Result<(), String> {
    load_dotenv();

    let repo_root = resolve_repo_root(options.repo_path)?;
    let payload =
        build_review_input_payload(&repo_root, options.base, options.head, options.rules_file)?;
    let specialist = load_pr_reviewer(options.specialist_dir)?;
    let caller = AcpAgentCaller::new();

    let context_prompt = build_worker_prompt(ReviewWorkerType::Context, &payload, None, None)?;
    let context_output = call_review_worker(
        &caller,
        &specialist,
        ReviewWorkerType::Context,
        &context_prompt,
        options.model,
        options.verbose,
    )
    .await?;

    let candidates_prompt = build_worker_prompt(
        ReviewWorkerType::Candidates,
        &payload,
        Some(&context_output),
        None,
    )?;
    let candidates_output = call_review_worker(
        &caller,
        &specialist,
        ReviewWorkerType::Candidates,
        &candidates_prompt,
        options.model,
        options.verbose,
    )
    .await?;

    let validator_prompt = build_worker_prompt(
        ReviewWorkerType::Validator,
        &payload,
        Some(&context_output),
        Some(&candidates_output),
    )?;
    let final_output = call_review_worker(
        &caller,
        &specialist,
        ReviewWorkerType::Validator,
        &validator_prompt,
        options.validator_model.or(options.model),
        options.verbose,
    )
    .await?;

    if final_output.is_empty() {
        return Err("Review workflow completed without producing an output.".to_string());
    }

    print_review_result(
        "Review Result",
        &final_output,
        options.as_json,
        "review output",
    )?;
    Ok(())
}

fn load_pr_reviewer(specialist_dir: Option<&str>) -> Result<SpecialistDef, String> {
    load_specialist_by_id("pr-reviewer", specialist_dir)
}

async fn call_review_worker(
    caller: &AcpAgentCaller,
    specialist: &SpecialistDef,
    worker_type: ReviewWorkerType,
    user_request: &str,
    model_override: Option<&str>,
    verbose: bool,
) -> Result<String, String> {
    let config = build_agent_call_config(specialist, model_override)?;
    let prompt = build_specialist_prompt(specialist, worker_type, user_request);

    if verbose {
        println!(
            "── Internal Review Worker: {} (model: {}) ──",
            worker_type.as_str(),
            config.model
        );
    }

    let response = caller.call(&config, &prompt).await?;
    if !response.success {
        return Err(response
            .error
            .unwrap_or_else(|| format!("Review worker {} failed", worker_type.as_str())));
    }

    Ok(response.content.trim().to_string())
}

fn build_agent_call_config(
    specialist: &SpecialistDef,
    model_override: Option<&str>,
) -> Result<AgentCallConfig, String> {
    let use_mock_adapter = std::env::var("ROUTA_REVIEW_MOCK")
        .ok()
        .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"));

    let api_key = if use_mock_adapter {
        "mock-key".to_string()
    } else {
        std::env::var("ANTHROPIC_AUTH_TOKEN")
            .or_else(|_| std::env::var("ANTHROPIC_API_KEY"))
            .map_err(|_| {
                "No API key found. Set ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY.".to_string()
            })?
    };

    let adapter = if use_mock_adapter {
        "mock".to_string()
    } else {
        specialist
            .default_adapter
            .clone()
            .unwrap_or_else(|| "claude-code-sdk".to_string())
    };

    Ok(AgentCallConfig {
        adapter,
        base_url: std::env::var("ANTHROPIC_BASE_URL")
            .unwrap_or_else(|_| "https://api.anthropic.com".to_string()),
        api_key,
        model: model_override
            .map(ToString::to_string)
            .or_else(|| specialist.default_model.clone())
            .unwrap_or_else(|| {
                std::env::var("ANTHROPIC_MODEL").unwrap_or_else(|_| "glm-5.1".to_string())
            }),
        max_turns: 1,
        max_tokens: 8192,
        temperature: None,
        system_prompt: specialist.system_prompt.clone(),
        env: std::collections::HashMap::new(),
        timeout_secs: 300,
    })
}

fn build_specialist_prompt(
    specialist: &SpecialistDef,
    worker_type: ReviewWorkerType,
    user_request: &str,
) -> String {
    let mut prompt = specialist.system_prompt.clone();
    prompt.push_str("\n\n---\n");
    prompt.push_str(&format!(
        "You are operating as the **{}** worker in the PR review pipeline.",
        worker_type.as_str()
    ));
    prompt.push_str("\nRespond strictly in JSON when requested.\n\n");
    prompt.push_str(user_request);
    prompt
}

fn build_worker_prompt(
    worker_type: ReviewWorkerType,
    payload: &ReviewInputPayload,
    context_output: Option<&str>,
    candidates_output: Option<&str>,
) -> Result<String, String> {
    let payload_json = serde_json::to_string_pretty(payload)
        .map_err(|err| format!("Failed to serialize review payload: {err}"))?;

    let prompt = match worker_type {
        ReviewWorkerType::Context => [
            "You are acting as the Context Analysis sub-agent for PR review.",
            "Summarize architectural context, modified modules, and likely risk hotspots.",
            "Return strict JSON only.",
            "## Review Payload",
            &payload_json,
        ]
        .join("\n\n"),
        ReviewWorkerType::Candidates => [
            "You are acting as the Candidate Generation sub-agent for PR review.",
            "Use context and diff to enumerate potential issues with confidence scores.",
            "Return strict JSON only.",
            "## Project Context",
            context_output.unwrap_or("{}"),
            "## Review Payload",
            &payload_json,
        ]
        .join("\n\n"),
        ReviewWorkerType::Validator => [
            "You are acting as the Finding Validation sub-agent for PR review.",
            "Filter review candidates using confidence scoring and exclusion rules.",
            "Return strict JSON only.",
            "## Project Context",
            context_output.unwrap_or("{}"),
            "## Raw Candidates",
            candidates_output.unwrap_or("{}"),
            "## Review Payload",
            &payload_json,
        ]
        .join("\n\n"),
    };

    Ok(prompt)
}
