---
title: "Rust desktop Codex sessions did not inject Routa MCP config at launch"
date: "2026-04-10"
status: resolved
resolved_at: "2026-04-10"
severity: high
area: "acp"
tags: [rust, desktop, codex, mcp, config, tauri]
reported_by: "Codex"
related_issues: []
---

# Rust desktop Codex sessions did not inject Routa MCP config at launch

## What Happened

Kanban Codex sessions created from the Rust desktop backend started successfully, but inside the Codex conversation the built-in Routa MCP tools were missing.

The session transcript showed Codex falling back to generic MCP discovery calls and then reporting that no board tools such as `create_card` were exposed.

## Expected Behavior

- Codex desktop sessions should always see the `routa-coordination` MCP server when Routa launches the provider for a workspace session.
- Kanban planning agents should be able to create backlog cards immediately instead of stalling on missing tool exposure.

## Why This Happened

- Rust desktop setup wrote Codex MCP configuration into project-scoped `.codex/config.toml`.
- The actual Codex launch path only injected one CLI override: project trust.
- That meant the launch depended on Codex discovering and loading the project config file correctly in this runtime path.
- In the failing Tauri/WebView flow, that assumption was not reliable enough, so Codex started without the `mcp_servers.routa-coordination` entry active.

This diverged from the stronger precedence model documented by Codex:

1. CLI flags and `--config` overrides
2. profile values
3. project config files
4. user config
5. system config
6. built-in defaults

## Resolution

The Rust desktop backend now injects the Routa MCP server directly through Codex CLI config overrides on launch:

- `projects."<cwd>".trust_level="trusted"`
- `mcp_servers.routa-coordination.url="..."`
- `mcp_servers.routa-coordination.enabled=true`

Project-scoped `.codex/config.toml` writing remains as a fallback, but desktop Codex startup no longer depends on that file being discovered.

## Relevant Files

- `crates/routa-core/src/acp/mcp_setup.rs`
- `crates/routa-core/src/acp/mod.rs`

## Verification

- `cargo test -p routa-core codex_cli_overrides_include_trust_and_mcp_server`

