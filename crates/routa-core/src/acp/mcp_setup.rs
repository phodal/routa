//! Minimal MCP setup for ACP providers in the Rust desktop backend.
//!
//! This mirrors the Next.js behavior closely enough to expose the Routa MCP
//! server with workspace/session/tool profile context for providers that read
//! a config file (OpenCode) and providers that accept inline JSON (Claude).

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

const QODER_MCP_SERVER_NAME: &str = "routa-coordination";
const QODER_MCP_SCOPE: &str = "local";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McpCleanupAction {
    QoderRemove {
        cwd: String,
        server_name: String,
        scope: String,
    },
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct McpSetupResult {
    pub summary: Option<String>,
    pub cleanup: Option<McpCleanupAction>,
}

fn build_mcp_endpoint(
    workspace_id: &str,
    session_id: &str,
    tool_mode: Option<&str>,
    mcp_profile: Option<&str>,
) -> String {
    let base_url =
        std::env::var("ROUTA_SERVER_URL").unwrap_or_else(|_| "http://127.0.0.1:3210".to_string());

    let mut params = vec![
        format!("wsId={}", workspace_id),
        format!("sid={}", session_id),
    ];

    if let Some(mode) = tool_mode.filter(|value| *value == "essential" || *value == "full") {
        params.push(format!("toolMode={mode}"));
    }

    if let Some(profile) =
        mcp_profile.filter(|value| *value == "kanban-planning" || *value == "team-coordination")
    {
        params.push(format!("mcpProfile={profile}"));
    }

    format!("{}/api/mcp?{}", base_url, params.join("&"))
}

pub fn build_claude_mcp_config(
    workspace_id: &str,
    session_id: &str,
    tool_mode: Option<&str>,
    mcp_profile: Option<&str>,
) -> String {
    serde_json::json!({
        "mcpServers": {
            "routa-coordination": {
                "url": build_mcp_endpoint(workspace_id, session_id, tool_mode, mcp_profile),
                "type": "http",
                "env": {
                    "ROUTA_WORKSPACE_ID": workspace_id,
                },
            }
        }
    })
    .to_string()
}

pub fn build_acp_http_mcp_servers(
    workspace_id: &str,
    session_id: &str,
    tool_mode: Option<&str>,
    mcp_profile: Option<&str>,
) -> Vec<serde_json::Value> {
    vec![serde_json::json!({
        "type": "http",
        "name": "routa-coordination",
        "url": build_mcp_endpoint(workspace_id, session_id, tool_mode, mcp_profile),
        "headers": []
    })]
}

async fn ensure_mcp_for_opencode(
    workspace_id: &str,
    session_id: &str,
    tool_mode: Option<&str>,
    mcp_profile: Option<&str>,
) -> Result<String, String> {
    let home_dir =
        dirs::home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
    let config_dir = home_dir.join(".config").join("opencode");
    let config_file = config_dir.join("opencode.json");

    let mut existing: Map<String, Value> = match tokio::fs::read_to_string(&config_file).await {
        Ok(raw) => serde_json::from_str::<Value>(&raw)
            .ok()
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default(),
        Err(_) => Map::new(),
    };

    let mut mcp = existing
        .remove("mcp")
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();

    mcp.insert(
        "routa-coordination".to_string(),
        serde_json::json!({
            "type": "remote",
            "url": build_mcp_endpoint(workspace_id, session_id, tool_mode, mcp_profile),
            "enabled": true
        }),
    );

    existing.insert("mcp".to_string(), Value::Object(mcp));

    tokio::fs::create_dir_all(&config_dir)
        .await
        .map_err(|err| format!("mkdir {}: {}", config_dir.display(), err))?;
    let encoded = serde_json::to_vec_pretty(&Value::Object(existing))
        .map_err(|err| format!("encode OpenCode MCP config: {err}"))?;
    tokio::fs::write(&config_file, encoded)
        .await
        .map_err(|err| format!("write {}: {}", config_file.display(), err))?;

    Ok(format!(
        "opencode: wrote MCP config to {}",
        display_path(&config_file)
    ))
}

fn codex_config_path_for_home(home_dir: &Path) -> PathBuf {
    home_dir.join(".routa").join("codex").join("config.toml")
}

fn codex_private_config_path() -> Result<PathBuf, String> {
    let home_dir =
        dirs::home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
    Ok(codex_config_path_for_home(&home_dir))
}

fn build_codex_mcp_config_contents(
    workspace_id: &str,
    session_id: &str,
    tool_mode: Option<&str>,
    mcp_profile: Option<&str>,
) -> String {
    let endpoint = build_mcp_endpoint(workspace_id, session_id, tool_mode, mcp_profile);
    format!("[mcp_servers.routa-coordination]\nurl = \"{endpoint}\"\nenabled = true\n")
}

fn upsert_codex_mcp_section(existing: &str, rendered_section: &str) -> String {
    let section_header = "[mcp_servers.routa-coordination]";
    if let Some(start) = existing.find(section_header) {
        let after_header = &existing[start + section_header.len()..];
        let next_section_offset = after_header
            .find("\n[")
            .map(|offset| start + section_header.len() + offset + 1);
        let end = next_section_offset.unwrap_or(existing.len());
        let mut updated = String::with_capacity(existing.len() + rendered_section.len());
        updated.push_str(existing[..start].trim_end());
        if !updated.is_empty() {
            updated.push_str("\n\n");
        }
        updated.push_str(rendered_section.trim_end());
        if end < existing.len() {
            updated.push_str("\n\n");
            updated.push_str(existing[end..].trim_start());
        } else {
            updated.push('\n');
        }
        return updated;
    }

    let trimmed = existing.trim_end();
    if trimmed.is_empty() {
        format!("{}\n", rendered_section.trim_end())
    } else {
        format!("{}\n\n{}\n", trimmed, rendered_section.trim_end())
    }
}

async fn ensure_mcp_for_codex_at(
    config_file: &Path,
    workspace_id: &str,
    session_id: &str,
    tool_mode: Option<&str>,
    mcp_profile: Option<&str>,
) -> Result<String, String> {
    let config_dir = config_file
        .parent()
        .ok_or_else(|| format!("Invalid Codex config path: {}", config_file.display()))?;

    let existing = tokio::fs::read_to_string(&config_file)
        .await
        .unwrap_or_default();
    let rendered_section =
        build_codex_mcp_config_contents(workspace_id, session_id, tool_mode, mcp_profile);
    let updated = upsert_codex_mcp_section(&existing, &rendered_section);

    tokio::fs::create_dir_all(config_dir)
        .await
        .map_err(|err| format!("mkdir {}: {}", config_dir.display(), err))?;
    tokio::fs::write(&config_file, updated)
        .await
        .map_err(|err| format!("write {}: {}", config_file.display(), err))?;

    Ok(format!(
        "codex-acp: wrote private MCP config to {}",
        display_path(config_file)
    ))
}

async fn ensure_mcp_for_codex(
    workspace_id: &str,
    session_id: &str,
    tool_mode: Option<&str>,
    mcp_profile: Option<&str>,
) -> Result<String, String> {
    let config_file = codex_private_config_path()?;
    ensure_mcp_for_codex_at(
        &config_file,
        workspace_id,
        session_id,
        tool_mode,
        mcp_profile,
    )
    .await
}

fn qoder_command() -> String {
    std::env::var("QODER_BIN").unwrap_or_else(|_| "qodercli".to_string())
}

async fn run_qoder_mcp_command(cwd: &str, args: &[String]) -> Result<(), String> {
    let pwd = std::fs::canonicalize(cwd)
        .unwrap_or_else(|_| PathBuf::from(cwd))
        .to_string_lossy()
        .to_string();
    let output = tokio::process::Command::new(qoder_command())
        .args(args)
        .current_dir(cwd)
        // Keep PWD aligned with current_dir for CLIs that scope project-local
        // config from the inherited environment instead of getcwd().
        .env("PWD", &pwd)
        .output()
        .await
        .map_err(|err| format!("spawn qodercli: {err}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let combined = [stderr, stdout]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    Err(if combined.is_empty() {
        format!("qodercli exited with status {}", output.status)
    } else {
        format!(
            "qodercli exited with status {}: {}",
            output.status, combined
        )
    })
}

async fn ensure_mcp_for_qoder(
    cwd: &str,
    workspace_id: &str,
    session_id: &str,
    tool_mode: Option<&str>,
    mcp_profile: Option<&str>,
) -> McpSetupResult {
    let endpoint = build_mcp_endpoint(workspace_id, session_id, tool_mode, mcp_profile);
    let args = vec![
        "mcp".to_string(),
        "add".to_string(),
        QODER_MCP_SERVER_NAME.to_string(),
        endpoint,
        "-t".to_string(),
        "streamable-http".to_string(),
        "-s".to_string(),
        QODER_MCP_SCOPE.to_string(),
    ];

    match run_qoder_mcp_command(cwd, &args).await {
        Ok(()) => McpSetupResult {
            summary: Some(format!(
                "qoder: added {QODER_MCP_SERVER_NAME} via {QODER_MCP_SCOPE} config"
            )),
            cleanup: Some(McpCleanupAction::QoderRemove {
                cwd: cwd.to_string(),
                server_name: QODER_MCP_SERVER_NAME.to_string(),
                scope: QODER_MCP_SCOPE.to_string(),
            }),
        },
        Err(err) => McpSetupResult {
            summary: Some(format!("qoder: mcp add failed – {err}")),
            cleanup: None,
        },
    }
}

pub fn codex_project_trust_override(cwd: &str) -> String {
    let escaped = cwd.replace('\\', "\\\\").replace('"', "\\\"");
    format!("projects.\"{escaped}\".trust_level=\"trusted\"")
}

fn codex_extract_routa_section_value(contents: &str, key: &str) -> Option<String> {
    let section_header = "[mcp_servers.routa-coordination]";
    let start = contents.find(section_header)?;
    let after_header = &contents[start + section_header.len()..];
    let next_section_offset = after_header
        .find("\n[")
        .map(|offset| start + section_header.len() + offset + 1);
    let end = next_section_offset.unwrap_or(contents.len());
    let section = &contents[start + section_header.len()..end];

    section.lines().find_map(|line| {
        let trimmed = line.trim();
        let expected_prefix = format!("{key} = ");
        let raw_value = trimmed.strip_prefix(&expected_prefix)?.trim();
        Some(raw_value.trim_matches('"').to_string())
    })
}

fn codex_cli_overrides_from_config(config_file: &Path, cwd: &str) -> Result<Vec<String>, String> {
    let contents = std::fs::read_to_string(config_file)
        .map_err(|err| format!("read {}: {}", config_file.display(), err))?;
    let endpoint = codex_extract_routa_section_value(&contents, "url").ok_or_else(|| {
        format!(
            "Missing mcp_servers.routa-coordination.url in {}",
            config_file.display()
        )
    })?;
    let enabled = codex_extract_routa_section_value(&contents, "enabled")
        .map(|value| value == "true")
        .unwrap_or(true);
    let escaped_endpoint = endpoint.replace('\\', "\\\\").replace('"', "\\\"");

    Ok(vec![
        codex_project_trust_override(cwd),
        format!(
            "mcp_servers.routa-coordination.url=\"{}\"",
            escaped_endpoint
        ),
        format!("mcp_servers.routa-coordination.enabled={enabled}"),
    ])
}

pub fn codex_cli_overrides(cwd: &str) -> Result<Vec<String>, String> {
    let config_file = codex_private_config_path()?;
    codex_cli_overrides_from_config(&config_file, cwd)
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

pub async fn ensure_mcp_for_provider(
    provider_id: &str,
    cwd: &str,
    workspace_id: &str,
    session_id: &str,
    tool_mode: Option<&str>,
    mcp_profile: Option<&str>,
) -> Result<McpSetupResult, String> {
    let base_id = provider_id.strip_suffix("-registry").unwrap_or(provider_id);

    match base_id {
        "opencode" => ensure_mcp_for_opencode(workspace_id, session_id, tool_mode, mcp_profile)
            .await
            .map(|summary| McpSetupResult {
                summary: Some(summary),
                cleanup: None,
            }),
        "codex" | "codex-acp" => {
            let _ = cwd;
            ensure_mcp_for_codex(workspace_id, session_id, tool_mode, mcp_profile)
                .await
                .map(|summary| McpSetupResult {
                    summary: Some(summary),
                    cleanup: None,
                })
        }
        "qoder" => {
            Ok(ensure_mcp_for_qoder(cwd, workspace_id, session_id, tool_mode, mcp_profile).await)
        }
        _ => Ok(McpSetupResult::default()),
    }
}

pub async fn cleanup_mcp_for_provider(cleanup: &McpCleanupAction) -> String {
    match cleanup {
        McpCleanupAction::QoderRemove {
            cwd,
            server_name,
            scope,
        } => {
            let args = vec![
                "mcp".to_string(),
                "remove".to_string(),
                server_name.clone(),
                "-s".to_string(),
                scope.clone(),
            ];

            match run_qoder_mcp_command(cwd, &args).await {
                Ok(()) => format!("qoder: removed {server_name} from {scope} config"),
                Err(err) => format!("qoder: mcp remove failed – {err}"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_acp_http_mcp_servers, build_claude_mcp_config, build_codex_mcp_config_contents,
        build_mcp_endpoint, cleanup_mcp_for_provider, codex_cli_overrides_from_config,
        codex_config_path_for_home, codex_project_trust_override, ensure_mcp_for_codex_at,
        ensure_mcp_for_provider, upsert_codex_mcp_section,
    };

    #[test]
    fn team_coordination_profile_is_forwarded_in_mcp_endpoint() {
        let endpoint = build_mcp_endpoint(
            "default",
            "session-123",
            Some("essential"),
            Some("team-coordination"),
        );
        assert!(endpoint.contains("wsId=default"));
        assert!(endpoint.contains("sid=session-123"));
        assert!(endpoint.contains("toolMode=essential"));
        assert!(endpoint.contains("mcpProfile=team-coordination"));
    }

    #[test]
    fn claude_inline_config_uses_routa_coordination_server() {
        let config = build_claude_mcp_config(
            "default",
            "session-123",
            Some("essential"),
            Some("team-coordination"),
        );
        assert!(config.contains("\"routa-coordination\""));
        assert!(config.contains("\"type\":\"http\""));
        assert!(config.contains("mcpProfile=team-coordination"));
    }

    #[test]
    fn acp_http_mcp_servers_use_streamable_http_shape() {
        let servers = build_acp_http_mcp_servers(
            "default",
            "session-123",
            Some("full"),
            Some("kanban-planning"),
        );

        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0]["type"], "http");
        assert_eq!(servers[0]["name"], "routa-coordination");
        assert_eq!(servers[0]["headers"], serde_json::json!([]));
        assert!(servers[0]["url"]
            .as_str()
            .is_some_and(|url| url.contains("mcpProfile=kanban-planning")));
    }

    #[test]
    fn codex_trust_override_marks_worktree_as_trusted() {
        let override_arg = codex_project_trust_override("/tmp/example/project");
        assert_eq!(
            override_arg,
            "projects.\"/tmp/example/project\".trust_level=\"trusted\""
        );
    }

    #[tokio::test]
    async fn codex_cli_overrides_include_trust_and_mcp_server() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        let config_path = codex_config_path_for_home(tempdir.path());
        ensure_mcp_for_codex_at(
            &config_path,
            "default",
            "session-123",
            Some("full"),
            Some("kanban-planning"),
        )
        .await
        .expect("ensure codex mcp");
        let overrides = codex_cli_overrides_from_config(&config_path, "/tmp/example/project")
            .expect("cli overrides");

        assert_eq!(overrides.len(), 3);
        assert_eq!(
            overrides[0],
            "projects.\"/tmp/example/project\".trust_level=\"trusted\""
        );
        assert!(overrides[1]
            .contains("mcp_servers.routa-coordination.url=\"http://127.0.0.1:3210/api/mcp?"));
        assert!(overrides[1].contains("wsId=default"));
        assert!(overrides[1].contains("sid=session-123"));
        assert!(overrides[1].contains("toolMode=full"));
        assert!(overrides[1].contains("mcpProfile=kanban-planning"));
        assert_eq!(overrides[2], "mcp_servers.routa-coordination.enabled=true");
    }

    #[test]
    fn codex_config_upsert_replaces_existing_routa_section() {
        let existing = "[mcp_servers.routa-coordination]\nurl = \"http://old\"\nenabled = true\n\n[model_providers.test]\nname = \"test\"\n";
        let replacement = build_codex_mcp_config_contents(
            "default",
            "session-123",
            Some("full"),
            Some("kanban-planning"),
        );
        let updated = upsert_codex_mcp_section(existing, &replacement);
        assert!(updated.contains("sid=session-123"));
        assert!(!updated.contains("http://old"));
        assert!(updated.contains("[model_providers.test]"));
    }

    #[tokio::test]
    async fn codex_provider_writes_private_overlay_config() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        let config_path = codex_config_path_for_home(tempdir.path());

        let summary = ensure_mcp_for_codex_at(
            &config_path,
            "default",
            "session-123",
            Some("full"),
            Some("kanban-planning"),
        )
        .await
        .expect("ensure codex mcp");

        let written = std::fs::read_to_string(&config_path).expect("read codex config");
        assert!(summary.contains(".routa/codex/config.toml"));
        assert!(written.contains("[mcp_servers.routa-coordination]"));
        assert!(written.contains("wsId=default"));
        assert!(written.contains("sid=session-123"));
        assert!(written.contains("mcpProfile=kanban-planning"));
    }

    #[cfg(not(windows))]
    #[tokio::test]
    async fn qoder_provider_adds_and_removes_local_mcp_server() {
        use std::os::unix::fs::PermissionsExt;

        let tempdir = tempfile::tempdir().expect("tempdir");
        let qoder_bin = tempdir.path().join("qodercli");
        let qoder_log = tempdir.path().join("qoder.log");
        let project_dir = tempdir.path().join("project");
        std::fs::create_dir_all(&project_dir).expect("create project dir");
        let real_project_dir = std::fs::canonicalize(&project_dir).expect("canonicalize project");
        let script = format!(
            r#"#!/usr/bin/env node
const fs = require("node:fs");
const payload = JSON.stringify({{
  cwd: process.cwd(),
  pwd: process.env.PWD || "",
  args: process.argv.slice(2),
}});
fs.appendFileSync({}, payload + "\n");
"#,
            serde_json::to_string(&qoder_log.display().to_string())
                .expect("serialize qoder log path")
        );
        std::fs::write(&qoder_bin, script).expect("write qoder stub");
        std::fs::set_permissions(&qoder_bin, std::fs::Permissions::from_mode(0o755))
            .expect("chmod qoder stub");

        let previous_qoder_bin = std::env::var_os("QODER_BIN");
        let previous_pwd = std::env::var_os("PWD");
        unsafe {
            std::env::set_var("QODER_BIN", &qoder_bin);
            std::env::set_var("PWD", tempdir.path());
        }

        let setup = ensure_mcp_for_provider(
            "qoder",
            project_dir.to_str().expect("project dir path"),
            "default",
            "session-123",
            Some("full"),
            Some("kanban-planning"),
        )
        .await
        .expect("ensure qoder mcp");

        let cleanup = setup.cleanup.clone().expect("qoder cleanup action");
        assert!(setup
            .summary
            .as_deref()
            .is_some_and(|summary| summary.contains("qoder: added")));

        let cleanup_summary = cleanup_mcp_for_provider(&cleanup).await;
        assert!(cleanup_summary.contains("qoder: removed"));

        let log = std::fs::read_to_string(&qoder_log).expect("read qoder log");
        let log_lines: Vec<serde_json::Value> = log
            .trim()
            .lines()
            .map(|line| serde_json::from_str(line).expect("parse qoder stub log"))
            .collect();
        assert_eq!(log_lines.len(), 2);
        assert_eq!(
            log_lines[0]["cwd"],
            real_project_dir.to_string_lossy().to_string()
        );
        assert_eq!(
            log_lines[0]["pwd"],
            real_project_dir.to_string_lossy().to_string()
        );
        assert_eq!(
            log_lines[0]["args"],
            serde_json::json!([
                "mcp",
                "add",
                "routa-coordination",
                "http://127.0.0.1:3210/api/mcp?wsId=default&sid=session-123&toolMode=full&mcpProfile=kanban-planning",
                "-t",
                "streamable-http",
                "-s",
                "local"
            ])
        );
        assert_eq!(
            log_lines[1]["cwd"],
            real_project_dir.to_string_lossy().to_string()
        );
        assert_eq!(
            log_lines[1]["pwd"],
            real_project_dir.to_string_lossy().to_string()
        );
        assert_eq!(
            log_lines[1]["args"],
            serde_json::json!(["mcp", "remove", "routa-coordination", "-s", "local"])
        );

        match previous_qoder_bin {
            Some(value) => unsafe {
                std::env::set_var("QODER_BIN", value);
            },
            None => unsafe {
                std::env::remove_var("QODER_BIN");
            },
        }
        match previous_pwd {
            Some(value) => unsafe {
                std::env::set_var("PWD", value);
            },
            None => unsafe {
                std::env::remove_var("PWD");
            },
        }
    }
}
