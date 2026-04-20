//! `routa specialist` — direct specialist file execution helpers.

use std::path::Path;

use routa_core::state::AppState;

use super::agent;

#[derive(Clone, Copy)]
pub struct RunArgs<'a> {
    pub specialist_target: &'a str,
    pub prompt: Option<&'a str>,
    pub workspace_id: &'a str,
    pub provider: Option<&'a str>,
    pub output_json: bool,
    pub cwd_override: Option<&'a str>,
    pub provider_timeout_ms: Option<u64>,
    pub provider_retries: u8,
    pub repeat_count: u8,
}

pub async fn run(state: &AppState, args: RunArgs<'_>) -> Result<(), String> {
    let RunArgs {
        specialist_target,
        prompt,
        workspace_id,
        provider,
        output_json,
        cwd_override,
        provider_timeout_ms,
        provider_retries,
        repeat_count,
    } = args;
    if looks_like_existing_specialist_file(specialist_target) {
        return agent::run(
            state,
            agent::RunArgs {
                specialist: None,
                specialist_file: Some(specialist_target),
                prompt,
                workspace_id,
                provider,
                output_json,
                cwd_override,
                specialist_dir: None,
                provider_timeout_ms,
                provider_retries,
                repeat_count,
            },
        )
        .await;
    }

    agent::run(
        state,
        agent::RunArgs {
            specialist: Some(specialist_target),
            specialist_file: None,
            prompt,
            workspace_id,
            provider,
            output_json,
            cwd_override,
            specialist_dir: None,
            provider_timeout_ms,
            provider_retries,
            repeat_count,
        },
    )
    .await
}

pub async fn run_for_json(
    state: &AppState,
    args: RunArgs<'_>,
) -> Result<serde_json::Value, String> {
    let RunArgs {
        specialist_target,
        prompt,
        workspace_id,
        provider,
        cwd_override,
        provider_timeout_ms,
        provider_retries,
        repeat_count,
        ..
    } = args;

    if looks_like_existing_specialist_file(specialist_target) {
        return agent::run_for_json(
            state,
            agent::RunArgs {
                specialist: None,
                specialist_file: Some(specialist_target),
                prompt,
                workspace_id,
                provider,
                output_json: true,
                cwd_override,
                specialist_dir: None,
                provider_timeout_ms,
                provider_retries,
                repeat_count,
            },
        )
        .await;
    }

    agent::run_for_json(
        state,
        agent::RunArgs {
            specialist: Some(specialist_target),
            specialist_file: None,
            prompt,
            workspace_id,
            provider,
            output_json: true,
            cwd_override,
            specialist_dir: None,
            provider_timeout_ms,
            provider_retries,
            repeat_count,
        },
    )
    .await
}

fn looks_like_existing_specialist_file(target: &str) -> bool {
    let path = Path::new(target);
    path.is_file()
        && path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| matches!(ext, "yaml" | "yml"))
}

#[cfg(test)]
mod tests {
    use super::looks_like_existing_specialist_file;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn detects_existing_specialist_file_targets() {
        let temp_dir = tempfile::tempdir().unwrap();
        let path = PathBuf::from(temp_dir.path()).join("ui-journey-evaluator.yaml");
        fs::write(&path, "id: ui-journey-evaluator\n").unwrap();
        assert!(looks_like_existing_specialist_file(&path.to_string_lossy()));

        let yml_path = PathBuf::from(temp_dir.path()).join("qa-checklist.yml");
        fs::write(&yml_path, "id: qa-checklist\n").unwrap();
        assert!(looks_like_existing_specialist_file(
            &yml_path.to_string_lossy()
        ));
    }

    #[test]
    fn treats_non_path_input_as_specialist_id() {
        assert!(!looks_like_existing_specialist_file("ui-journey-evaluator"));
    }
}
