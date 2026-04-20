//! Terminal output formatting helpers for `routa review`.

use serde::Serialize;
use std::path::Path;

pub(crate) fn print_pretty_json<T: Serialize>(
    value: &T,
    error_context: &str,
) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string_pretty(value)
            .map_err(|err| format!("Failed to format {error_context}: {err}"))?
    );
    Ok(())
}

pub(crate) fn print_review_result(
    title: &str,
    output: &str,
    as_json: bool,
    error_context: &str,
) -> Result<(), String> {
    println!();
    println!("═══ {title} ═══");
    if as_json {
        match serde_json::from_str::<serde_json::Value>(output) {
            Ok(value) => print_pretty_json(&value, error_context)?,
            Err(_) => println!("{output}"),
        }
    } else {
        println!("{output}");
    }
    Ok(())
}

pub(crate) fn print_security_acp_runtime_diagnostics(
    provider: &str,
    cwd: &str,
    runtime_binary: &str,
    runtime_in_path: Option<&Path>,
) {
    let env_home = std::env::var("HOME").unwrap_or_else(|_| "<unset>".to_string());
    let env_path = std::env::var("PATH").unwrap_or_else(|_| "<unset>".to_string());
    let trimmed_path = if env_path.len() > 140 {
        format!("{}...", &env_path[..137])
    } else {
        env_path
    };
    let env_xdg_config = std::env::var("XDG_CONFIG_HOME").unwrap_or_else(|_| "<unset>".to_string());
    let env_xdg_data = std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| "<unset>".to_string());
    let env_xdg_cache = std::env::var("XDG_CACHE_HOME").unwrap_or_else(|_| "<unset>".to_string());
    let opencode_bin = std::env::var("OPENCODE_BIN").unwrap_or_else(|_| "-".to_string());
    let codex_acp_bin = std::env::var("CODEX_ACP_BIN").unwrap_or_else(|_| "-".to_string());

    let runtime_path = runtime_in_path
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "<not found in PATH>".to_string());
    let probe_path = std::path::PathBuf::from(&env_home).join(".config");
    let probe_status = match std::fs::metadata(&probe_path) {
        Ok(meta) if meta.is_dir() => {
            match std::fs::create_dir_all(probe_path.join("routa-acp-debug")) {
                Ok(()) => "ok".to_string(),
                Err(err) => format!("write-failed: {err}"),
            }
        }
        Ok(_) => "invalid-config-dir".to_string(),
        Err(err) => format!("missing-config-dir: {err}"),
    };

    println!("┌──────────────── ACP Runtime Diagnostics ────────────────┐");
    println!("│ provider       = {:<34} │", truncate(provider, 34));
    println!("│ runtime binary = {:<34} │", truncate(runtime_binary, 34));
    println!("│ resolved       = {:<34} │", truncate(&runtime_path, 34));
    println!("│ HOME          = {:<34} │", truncate(&env_home, 34));
    println!("│ XDG_CONFIG    = {:<34} │", truncate(&env_xdg_config, 34));
    println!("│ XDG_DATA_HOME = {:<34} │", truncate(&env_xdg_data, 34));
    println!("│ XDG_CACHE_HOME= {:<34} │", truncate(&env_xdg_cache, 34));
    println!("│ CWD           = {:<34} │", truncate(cwd, 34));
    println!("│ PATH          = {:<34} │", truncate(&trimmed_path, 34));
    println!("│ OPENCODE_BIN  = {:<34} │", truncate(&opencode_bin, 34));
    println!("│ CODEX_ACP_BIN = {:<34} │", truncate(&codex_acp_bin, 34));
    println!("│ $HOME/.config = {:<34} │", truncate(&probe_status, 34));
    println!("└───────────────────────────────────────────────────────┘");
}

pub(crate) fn truncate(content: &str, max_chars: usize) -> String {
    if content.chars().count() <= max_chars {
        content.to_string()
    } else {
        let truncated: String = content.chars().take(max_chars).collect();
        format!("{truncated}\n\n[truncated]")
    }
}

#[cfg(test)]
mod tests {
    use super::truncate;

    #[test]
    fn truncate_marks_truncated_content() {
        let content = "abcdefghijklmnopqrstuvwxyz";
        let truncated = truncate(content, 8);
        assert!(truncated.contains("[truncated]"));
        assert!(truncated.starts_with("abcdefgh"));
    }
}
