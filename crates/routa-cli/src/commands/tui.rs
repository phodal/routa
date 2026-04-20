//! `TuiRenderer` — streaming terminal UI renderer for ACP session updates.
//!
//! Mirrors the ChatPanel streaming behaviour from the web UI:
//! - Agent message chunks are printed inline without newlines (streaming)
//! - Tool calls show a pending indicator that is overwritten on completion
//! - Thoughts are printed in dimmed style
//! - Process output is printed in gray to stderr
//! - A status bar at the bottom shows the current activity

use std::borrow::Cow;
use std::io::Write;
use std::time::Instant;

use console::{style, Term};

/// Stateful streaming renderer for a single ACP session.
pub struct TuiRenderer {
    term: Term,
    /// Whether the last printed character ended with a newline.
    at_line_start: bool,
    /// The tool call currently being rendered (id, label, start time).
    active_tool: Option<ActiveTool>,
}

/// Tracks how long an interactive command should wait before concluding a turn is idle.
pub(crate) struct IdleExitPolicy {
    initial_idle_threshold: u32,
    steady_idle_threshold: u32,
    idle_ticks: u32,
    has_seen_update: bool,
}

struct ActiveTool {
    id: Option<String>,
    label: String,
    started_at: Instant,
}

impl Default for TuiRenderer {
    fn default() -> Self {
        Self::new()
    }
}

impl IdleExitPolicy {
    pub(crate) fn new(initial_idle_threshold: u32, steady_idle_threshold: u32) -> Self {
        Self {
            initial_idle_threshold,
            steady_idle_threshold,
            idle_ticks: 0,
            has_seen_update: false,
        }
    }

    pub(crate) fn record_update(&mut self) {
        self.idle_ticks = 0;
        self.has_seen_update = true;
    }

    pub(crate) fn should_exit_on_idle_tick(&mut self) -> bool {
        self.idle_ticks += 1;
        let threshold = if self.has_seen_update {
            self.steady_idle_threshold
        } else {
            self.initial_idle_threshold
        };
        self.idle_ticks >= threshold
    }
}

impl TuiRenderer {
    pub fn new() -> Self {
        Self {
            term: Term::stdout(),
            at_line_start: true,
            active_tool: None,
        }
    }

    /// Handle one `session/update` notification value.
    pub fn handle_update(&mut self, update: &serde_json::Value) {
        let params = match update.get("params") {
            Some(p) => p,
            None => return,
        };
        let inner = match params.get("update") {
            Some(u) => u,
            None => return,
        };
        let kind = inner
            .get("sessionUpdate")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        match kind {
            "agent_message_chunk" => {
                let text = extract_text(inner);
                if !text.is_empty() {
                    self.ensure_agent_prefix();
                    print!("{text}");
                    std::io::stdout().flush().ok();
                    self.at_line_start = text.ends_with('\n');
                }
            }
            "agent_message" => {
                let text = extract_text(inner);
                if !text.is_empty() {
                    self.finish_active_tool();
                    self.ensure_newline();
                    println!("{} {}", style("▶").cyan().bold(), text);
                    self.at_line_start = true;
                }
            }
            "agent_thought_chunk" => {
                let text = extract_text(inner);
                if !text.is_empty() {
                    print!("{}", style(text).dim());
                    std::io::stdout().flush().ok();
                    self.at_line_start = false;
                }
            }
            "tool_call" | "tool_call_start" => {
                let label = tool_label(inner)
                    .map(|label| label.into_owned())
                    .unwrap_or_else(|| "tool".to_string());
                let status = inner
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("running");
                self.finish_active_tool();
                self.ensure_newline();

                match status {
                    "completed" => {
                        println!("  {} {}", style("✔").green(), style(&label).dim());
                        self.print_tool_result(inner);
                    }
                    "failed" => {
                        println!("  {} {}", style("✘").red(), style(&label).dim());
                        self.print_tool_result(inner);
                    }
                    _ => {
                        print!("  {} {} …", style("⠿").yellow(), style(&label).dim());
                        std::io::stdout().flush().ok();
                        self.active_tool = Some(ActiveTool {
                            id: tool_call_id(inner).map(str::to_string),
                            label,
                            started_at: Instant::now(),
                        });
                        self.at_line_start = false;
                    }
                }
            }
            "tool_call_update" => {
                let label = self
                    .resolve_tool_label(inner)
                    .unwrap_or_else(|| "tool".to_string());
                let status = inner
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("running");

                match status {
                    "completed" | "failed" => {
                        if self.active_tool.is_some() {
                            // Clear the pending "…" line
                            self.term.clear_line().ok();
                            let elapsed = self
                                .active_tool
                                .as_ref()
                                .map(|tool| tool.started_at.elapsed().as_millis())
                                .unwrap_or(0);
                            let icon = if status == "completed" {
                                style("✔").green()
                            } else {
                                style("✘").red()
                            };
                            println!(
                                "\r  {} {} {}",
                                icon,
                                style(&label).dim(),
                                style(format!("({elapsed} ms)")).dim()
                            );
                            self.active_tool = None;
                            self.at_line_start = true;
                        } else {
                            let icon = if status == "completed" {
                                style("✔").green()
                            } else {
                                style("✘").red()
                            };
                            println!("  {} {}", icon, style(&label).dim());
                            self.at_line_start = true;
                        }
                        self.print_tool_result(inner);
                    }
                    _ => {}
                }
            }
            "process_output" => {
                let data = inner.get("data").and_then(|v| v.as_str()).unwrap_or("");
                if !data.is_empty() {
                    self.render_process_output(data);
                }
            }
            "turn_complete" => {
                self.finish_active_tool();
                self.ensure_newline();
                println!("{}", style("── turn complete ──").dim());
                self.at_line_start = true;
            }
            "usage_update" => {
                if let (Some(input), Some(output)) = (
                    inner.get("inputTokens").and_then(|v| v.as_u64()),
                    inner.get("outputTokens").and_then(|v| v.as_u64()),
                ) {
                    self.ensure_newline();
                    println!(
                        "{}",
                        style(format!("  tokens: {input} in / {output} out")).dim()
                    );
                    self.at_line_start = true;
                }
            }
            _ => {
                tracing::debug!("TuiRenderer: unhandled update kind: {}", kind);
            }
        }
    }

    /// Ensure we are at the start of a new line before printing a block element.
    fn ensure_newline(&mut self) {
        if !self.at_line_start {
            println!();
            self.at_line_start = true;
        }
    }

    /// Clear any active pending tool spinner line.
    fn finish_active_tool(&mut self) {
        if self.active_tool.take().is_some() {
            self.term.clear_line().ok();
            self.at_line_start = true;
        }
    }

    /// Print the "▶ " agent prefix once at the start of a new agent message stream.
    fn ensure_agent_prefix(&mut self) {
        if self.at_line_start {
            print!("{} ", style("▶").cyan().bold());
            self.at_line_start = false;
        }
    }

    /// Call at end of session to flush any dangling lines.
    pub fn finish(&mut self) {
        self.finish_active_tool();
        self.ensure_newline();
    }

    fn resolve_tool_label(&self, inner: &serde_json::Value) -> Option<String> {
        if let Some(label) = tool_label(inner) {
            return Some(label.into_owned());
        }

        let tool_call_id = tool_call_id(inner)?;
        let active_tool = self.active_tool.as_ref()?;
        if active_tool.id.as_deref() == Some(tool_call_id) {
            Some(active_tool.label.clone())
        } else {
            None
        }
    }

    fn print_tool_result(&mut self, inner: &serde_json::Value) {
        if let Some(result) = tool_result_text(inner) {
            self.ensure_newline();
            for line in result.lines().filter(|line| !line.trim().is_empty()) {
                println!("    {}", style(line).dim());
            }
            self.at_line_start = true;
        }
    }

    fn render_process_output(&mut self, data: &str) {
        let lines = visible_process_output_lines(data);

        if lines.is_empty() {
            return;
        }

        self.finish_active_tool();
        self.ensure_newline();
        for line in lines {
            eprintln!("{}", style(line).color256(240));
        }
        self.at_line_start = true;
    }
}

pub(crate) fn update_has_visible_terminal_activity(update: &serde_json::Value) -> bool {
    let Some(inner) = update.get("params").and_then(|params| params.get("update")) else {
        return false;
    };

    let kind = inner
        .get("sessionUpdate")
        .and_then(|value| value.as_str())
        .unwrap_or("");

    match kind {
        "agent_message_chunk"
        | "agent_message"
        | "agent_thought_chunk"
        | "tool_call"
        | "tool_call_start"
        | "tool_call_update"
        | "turn_complete"
        | "usage_update" => true,
        "process_output" => inner
            .get("data")
            .and_then(|value| value.as_str())
            .map(|data| !visible_process_output_lines(data).is_empty())
            .unwrap_or(false),
        _ => false,
    }
}

fn extract_text(inner: &serde_json::Value) -> &str {
    inner
        .get("content")
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str())
        .or_else(|| inner.get("text").and_then(|t| t.as_str()))
        .unwrap_or("")
}

fn tool_label(inner: &serde_json::Value) -> Option<Cow<'_, str>> {
    if let Some(title) = inner.get("title").and_then(|v| v.as_str()) {
        return Some(Cow::Borrowed(title));
    }

    inner
        .get("kind")
        .or_else(|| inner.get("name"))
        .or_else(|| inner.get("toolName"))
        .or_else(|| inner.get("tool"))
        .and_then(|v| v.as_str())
        .map(Cow::Borrowed)
        .or_else(|| {
            let raw_input = inner.get("rawInput")?;
            raw_input
                .get("title")
                .or_else(|| raw_input.get("name"))
                .or_else(|| raw_input.get("toolName"))
                .or_else(|| raw_input.get("tool"))
                .and_then(|v| v.as_str())
                .map(Cow::Borrowed)
                .or_else(|| {
                    raw_input
                        .get("command")
                        .and_then(|v| v.as_str())
                        .map(|command| Cow::Owned(format!("exec {command}")))
                })
        })
        .or_else(|| {
            tool_call_id(inner).map(|tool_call_id| {
                let tool_name = tool_call_id
                    .split_once('-')
                    .map(|(prefix, _)| prefix)
                    .unwrap_or(tool_call_id);
                Cow::Owned(tool_name.to_string())
            })
        })
}

fn tool_call_id(inner: &serde_json::Value) -> Option<&str> {
    inner
        .get("toolCallId")
        .or_else(|| inner.get("tool_call_id"))
        .and_then(|v| v.as_str())
}

fn tool_result_text(inner: &serde_json::Value) -> Option<String> {
    if let Some(error) = inner.get("error") {
        if let Some(message) = error
            .get("message")
            .and_then(|value| value.as_str())
            .or_else(|| error.as_str())
        {
            return Some(message.to_string());
        }
    }

    if let Some(raw_output) = inner.get("rawOutput") {
        if let Some(text) = raw_output.as_str() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }

        let serialized = serde_json::to_string_pretty(raw_output).ok()?;
        let trimmed = serialized.trim();
        if !trimmed.is_empty() && trimmed != "null" && trimmed != "\"\"" {
            return Some(trimmed.to_string());
        }
    }

    extract_tool_content_text(inner)
}

fn extract_tool_content_text(inner: &serde_json::Value) -> Option<String> {
    inner
        .get("content")
        .and_then(|value| value.as_array())
        .and_then(|items| {
            let lines: Vec<String> = items
                .iter()
                .filter_map(|item| {
                    item.get("content")
                        .and_then(|content| content.get("text"))
                        .and_then(|text| text.as_str())
                        .or_else(|| item.get("text").and_then(|text| text.as_str()))
                        .map(str::trim)
                        .filter(|text| !text.is_empty())
                        .map(str::to_string)
                })
                .collect();

            if lines.is_empty() {
                None
            } else {
                Some(lines.join("\n"))
            }
        })
}

fn looks_like_provider_log(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }

    if trimmed.starts_with("[AcpProcess:")
        || trimmed.starts_with("[ClaudeCode:")
        || trimmed.starts_with("[TerminalManager]")
    {
        return true;
    }

    if trimmed.starts_with("202")
        && (trimmed.contains(" INFO ")
            || trimmed.contains(" DEBUG ")
            || trimmed.contains(" WARN ")
            || trimmed.contains(" ERROR ")
            || trimmed.contains("TRACE "))
    {
        return true;
    }

    trimmed.contains("codex_acp::")
        || trimmed.contains("codex_otel::")
        || trimmed.contains("codex_rmcp_client::")
        || trimmed.contains("session_loop{")
        || trimmed.contains("MCP server stderr")
}

fn visible_process_output_lines(data: &str) -> Vec<&str> {
    let show_all = std::env::var_os("ROUTA_CLI_SHOW_PROCESS_OUTPUT").is_some();
    data.lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty() && (show_all || !looks_like_provider_log(line)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{update_has_visible_terminal_activity, IdleExitPolicy};

    #[test]
    fn waits_longer_before_first_update_than_after_streaming_starts() {
        let mut policy = IdleExitPolicy::new(30, 5);

        for _ in 0..29 {
            assert!(
                !policy.should_exit_on_idle_tick(),
                "should keep waiting before the first update arrives"
            );
        }
        assert!(
            policy.should_exit_on_idle_tick(),
            "should stop once the initial idle budget is exhausted"
        );

        let mut policy = IdleExitPolicy::new(30, 5);
        policy.record_update();

        for _ in 0..4 {
            assert!(
                !policy.should_exit_on_idle_tick(),
                "should tolerate a short idle gap after streaming has started"
            );
        }
        assert!(
            policy.should_exit_on_idle_tick(),
            "should stop once the steady-state idle budget is exhausted"
        );
    }

    #[test]
    fn receiving_an_update_resets_idle_counter() {
        let mut policy = IdleExitPolicy::new(30, 5);

        for _ in 0..10 {
            assert!(!policy.should_exit_on_idle_tick());
        }

        policy.record_update();

        for _ in 0..4 {
            assert!(
                !policy.should_exit_on_idle_tick(),
                "a streamed update should reset the idle budget"
            );
        }
        assert!(policy.should_exit_on_idle_tick());
    }

    #[test]
    fn codex_provider_logs_do_not_count_as_visible_terminal_activity() {
        let update = serde_json::json!({
            "params": {
                "update": {
                    "sessionUpdate": "process_output",
                    "data": "2026-04-06T13:30:02.891928Z  INFO codex_acp::thread: Submitted prompt with submission_id: 123\n"
                }
            }
        });

        assert!(!update_has_visible_terminal_activity(&update));
    }

    #[test]
    fn agent_message_chunks_count_as_visible_terminal_activity() {
        let update = serde_json::json!({
            "params": {
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {
                        "type": "text",
                        "text": "hello"
                    }
                }
            }
        });

        assert!(update_has_visible_terminal_activity(&update));
    }
}
