//! Minimal MCP setup for ACP providers in the Rust desktop backend.
//!
//! This mirrors the Next.js behavior closely enough to expose the Routa MCP
//! server with workspace/session/tool profile context for providers that read
//! a config file (OpenCode) and providers that accept inline JSON (Claude).

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

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
        params.push(format!("toolMode={}", mode));
    }

    if let Some(profile) =
        mcp_profile.filter(|value| *value == "kanban-planning" || *value == "team-coordination")
    {
        params.push(format!("mcpProfile={}", profile));
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
        .map_err(|err| format!("encode OpenCode MCP config: {}", err))?;
    tokio::fs::write(&config_file, encoded)
        .await
        .map_err(|err| format!("write {}: {}", config_file.display(), err))?;

    Ok(format!(
        "opencode: wrote MCP config to {}",
        display_path(&config_file)
    ))
}

fn codex_project_config_path(cwd: &str) -> PathBuf {
    Path::new(cwd).join(".codex").join("config.toml")
}

fn build_codex_mcp_config_contents(
    workspace_id: &str,
    session_id: &str,
    tool_mode: Option<&str>,
    mcp_profile: Option<&str>,
) -> String {
    let endpoint = build_mcp_endpoint(workspace_id, session_id, tool_mode, mcp_profile);
    format!(
        "[mcp_servers.routa-coordination]\nurl = \"{}\"\nenabled = true\n",
        endpoint
    )
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

async fn ensure_mcp_for_codex(
    cwd: &str,
    workspace_id: &str,
    session_id: &str,
    tool_mode: Option<&str>,
    mcp_profile: Option<&str>,
) -> Result<String, String> {
    let config_file = codex_project_config_path(cwd);
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
        "codex-acp: wrote MCP config to {}",
        display_path(&config_file)
    ))
}

pub fn codex_project_trust_override(cwd: &str) -> String {
    let escaped = cwd.replace('\\', "\\\\").replace('"', "\\\"");
    format!("projects.\"{}\".trust_level=\"trusted\"", escaped)
}

pub fn codex_cli_overrides(
    cwd: &str,
    workspace_id: &str,
    session_id: &str,
    tool_mode: Option<&str>,
    mcp_profile: Option<&str>,
) -> Vec<String> {
    let endpoint = build_mcp_endpoint(workspace_id, session_id, tool_mode, mcp_profile);
    let escaped_endpoint = endpoint.replace('\\', "\\\\").replace('"', "\\\"");

    vec![
        codex_project_trust_override(cwd),
        format!(
            "mcp_servers.routa-coordination.url=\"{}\"",
            escaped_endpoint
        ),
        "mcp_servers.routa-coordination.enabled=true".to_string(),
    ]
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
) -> Result<Option<String>, String> {
    let base_id = provider_id.strip_suffix("-registry").unwrap_or(provider_id);

    match base_id {
        "opencode" => ensure_mcp_for_opencode(workspace_id, session_id, tool_mode, mcp_profile)
            .await
            .map(Some),
        "codex" | "codex-acp" => {
            ensure_mcp_for_codex(cwd, workspace_id, session_id, tool_mode, mcp_profile)
                .await
                .map(Some)
        }
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_claude_mcp_config, build_codex_mcp_config_contents, build_mcp_endpoint,
        codex_cli_overrides, codex_project_config_path, codex_project_trust_override,
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
    fn codex_trust_override_marks_worktree_as_trusted() {
        let override_arg = codex_project_trust_override("/tmp/example/project");
        assert_eq!(
            override_arg,
            "projects.\"/tmp/example/project\".trust_level=\"trusted\""
        );
    }

    #[test]
    fn codex_cli_overrides_include_trust_and_mcp_server() {
        let overrides = codex_cli_overrides(
            "/tmp/example/project",
            "default",
            "session-123",
            Some("full"),
            Some("kanban-planning"),
        );

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
    async fn codex_provider_writes_project_scoped_config() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        let cwd = tempdir.path().to_string_lossy().to_string();

        let summary = ensure_mcp_for_provider(
            "codex-acp",
            &cwd,
            "default",
            "session-123",
            Some("full"),
            Some("kanban-planning"),
        )
        .await
        .expect("ensure codex mcp")
        .expect("summary");

        let config_path = codex_project_config_path(&cwd);
        let written = std::fs::read_to_string(&config_path).expect("read codex config");
        assert!(summary.contains(".codex/config.toml"));
        assert!(written.contains("[mcp_servers.routa-coordination]"));
        assert!(written.contains("wsId=default"));
        assert!(written.contains("sid=session-123"));
        assert!(written.contains("mcpProfile=kanban-planning"));
    }
}
