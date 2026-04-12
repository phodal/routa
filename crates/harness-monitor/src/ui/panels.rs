use super::fitness;
use super::*;
use crate::attribute::attribution::{
    assess_run, summarize_planes, PlaneAssessment, RunAssessmentInput, RunOrigin, WorkspaceType,
};
use crate::evaluate::gates::{
    effect_classes_summary, evidence_inline_summary, EvidenceRequirementStatus,
};
use crate::run::run::{Role, RunMode};
use crate::run::workspace::WorkspaceState;
use crate::shared::models::{AttributionConfidence, FileView};
use crate::ui::state::{FitnessViewMode, FocusPane};
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Clear, List, ListItem, Paragraph, Wrap};

#[allow(dead_code)]
pub(super) struct RunOperatorModel {
    pub(super) role: Role,
    pub(super) mode: RunMode,
    pub(super) origin: RunOrigin,
    pub(super) operator_state: String,
    pub(super) workspace_path: String,
    pub(super) process_cwd: Option<String>,
    pub(super) workspace_state: WorkspaceState,
    pub(super) effect_classes: Vec<crate::run::policy::EffectClass>,
    pub(super) policy_decision: crate::run::policy::PolicyDecisionKind,
    pub(super) approval_label: String,
    pub(super) block_reason: Option<String>,
    pub(super) eval_summary: Option<String>,
    pub(super) evidence: Vec<EvidenceRequirementStatus>,
    pub(super) integrity_warning: Option<String>,
    pub(super) next_action: String,
    pub(super) handoff_summary: Option<String>,
    pub(super) recovery_hints: Vec<String>,
    pub(super) changed_files: Vec<String>,
    pub(super) planes: Vec<PlaneAssessment>,
}

pub(super) fn render_details_panel(
    frame: &mut Frame,
    area: Rect,
    state: &RuntimeState,
    cache: &AppCache,
) {
    let colors = palette(state.theme_mode);
    if state.focus == FocusPane::Runs {
        let block = panel_block("Run Details", false, colors);
        let lines = render_run_details(state, cache, area.width, colors);
        frame.render_widget(
            Paragraph::new(lines)
                .block(block)
                .style(Style::default().bg(colors.surface).fg(colors.text))
                .wrap(Wrap { trim: true }),
            area,
        );
        return;
    }

    let mut lines = Vec::new();
    if let Some(file) = state.selected_file() {
        let visible_files = state.file_items();
        let (file_name, parent_dir) = split_display_path(file);
        lines.push(Line::from(Span::styled(
            shorten_path(&file_name, area.width.saturating_sub(4) as usize),
            Style::default()
                .fg(colors.text)
                .add_modifier(Modifier::BOLD),
        )));
        lines.push(Line::from(Span::styled(
            shorten_path(&parent_dir, area.width.saturating_sub(4) as usize),
            Style::default().fg(colors.muted),
        )));
        if let Some(task) = state.task_for_file(file) {
            lines.push(Line::from(vec![
                Span::styled("Task: ", Style::default().fg(colors.muted)),
                Span::styled(
                    shorten_path(&task.title, area.width.saturating_sub(12) as usize),
                    Style::default().fg(colors.accent),
                ),
            ]));
        }
        if let Some(facts) = cache.file_facts(file) {
            lines.push(Line::from(vec![
                Span::styled("Type: ", Style::default().fg(colors.muted)),
                Span::styled(
                    if facts.entry_kind.is_submodule() {
                        "submodule"
                    } else if facts.entry_kind.is_directory() {
                        "directory"
                    } else {
                        "file"
                    },
                    Style::default().fg(colors.text),
                ),
            ]));
            if facts.entry_kind.is_container() {
                lines.push(Line::from(vec![
                    Span::styled("Entries: ", Style::default().fg(colors.muted)),
                    Span::styled(
                        facts.child_count.unwrap_or(0).to_string(),
                        Style::default().fg(colors.text),
                    ),
                    Span::raw("  "),
                    Span::styled("Size: ", Style::default().fg(colors.muted)),
                    Span::styled(
                        format_bytes(facts.byte_size),
                        Style::default().fg(colors.text),
                    ),
                ]));
            } else {
                lines.push(Line::from(vec![
                    Span::styled("Lines: ", Style::default().fg(colors.muted)),
                    Span::styled(
                        facts.line_count.to_string(),
                        Style::default().fg(colors.text),
                    ),
                    Span::raw("  "),
                    Span::styled("Size: ", Style::default().fg(colors.muted)),
                    Span::styled(
                        format_bytes(facts.byte_size),
                        Style::default().fg(colors.text),
                    ),
                ]));
            }
            lines.push(Line::from(vec![
                Span::styled("Git changes: ", Style::default().fg(colors.muted)),
                Span::styled(
                    facts.git_change_count.to_string(),
                    Style::default().fg(colors.accent),
                ),
            ]));
            if let Some(review_hint) = cache.review_hint(file) {
                let review_color = match review_hint.level {
                    crate::ui::tui::review::ReviewRiskLevel::High => STOPPED,
                    crate::ui::tui::review::ReviewRiskLevel::Medium => INFERRED,
                };
                lines.push(Line::from(vec![
                    Span::styled("Review: ", Style::default().fg(colors.muted)),
                    Span::styled(review_hint.label, Style::default().fg(review_color)),
                    Span::raw("  "),
                    Span::styled(review_hint.rule_name, Style::default().fg(colors.text)),
                ]));
            }
            let repo_context = cache.repo_review_context_for_file(file, &visible_files);
            if !repo_context.is_empty() {
                let mut row = vec![Span::styled(
                    "Review context: ",
                    Style::default().fg(colors.muted),
                )];
                for (index, hint) in repo_context.into_iter().take(2).enumerate() {
                    if index > 0 {
                        row.push(Span::raw("  "));
                    }
                    let color = match hint.level {
                        crate::ui::tui::review::ReviewRiskLevel::High => STOPPED,
                        crate::ui::tui::review::ReviewRiskLevel::Medium => INFERRED,
                    };
                    row.push(Span::styled(hint.label, Style::default().fg(color)));
                    row.push(Span::raw(" "));
                    row.push(Span::styled(
                        hint.rule_name,
                        Style::default().fg(colors.text),
                    ));
                }
                lines.push(Line::from(row));
            }
        } else {
            lines.push(Line::from(Span::styled(
                "Lines: ...  Size: ...  Git changes: ...",
                Style::default().fg(colors.muted),
            )));
        }
        if cache.is_changed_test_file(file) {
            lines.push(Line::from(vec![
                Span::styled("Test mapping: ", Style::default().fg(colors.muted)),
                Span::styled("changed test file", Style::default().fg(ACTIVE)),
            ]));
        } else if let Some(mapping) = cache.test_mapping(file) {
            let status_color = match mapping.status.as_str() {
                "missing" => STOPPED,
                "unknown" => INFERRED,
                _ => ACTIVE,
            };
            lines.push(Line::from(vec![
                Span::styled("Test mapping: ", Style::default().fg(colors.muted)),
                Span::styled(mapping.status.clone(), Style::default().fg(status_color)),
                Span::raw("  "),
                Span::styled(mapping.language.clone(), Style::default().fg(colors.text)),
            ]));
            lines.push(Line::from(vec![
                Span::styled("Resolver: ", Style::default().fg(colors.muted)),
                Span::styled(
                    mapping.resolver_kind.clone(),
                    Style::default().fg(colors.text),
                ),
                Span::raw("  "),
                Span::styled("Confidence: ", Style::default().fg(colors.muted)),
                Span::styled(mapping.confidence.clone(), Style::default().fg(colors.text)),
            ]));
            if !mapping.related_test_files.is_empty() {
                let preview = summarize_test_paths(&mapping.related_test_files, 2);
                lines.push(Line::from(vec![
                    Span::styled("Tests: ", Style::default().fg(colors.muted)),
                    Span::styled(preview, Style::default().fg(colors.text)),
                ]));
            }
        }
    } else {
        lines.push(Line::from(Span::styled(
            "No file selected",
            Style::default().fg(colors.muted),
        )));
    }

    let block = panel_block("File Detail", false, colors);
    frame.render_widget(
        Paragraph::new(lines)
            .block(block)
            .style(Style::default().bg(colors.surface).fg(colors.text))
            .wrap(Wrap { trim: true }),
        area,
    );
}

pub(super) fn render_preview_panel(
    frame: &mut Frame,
    area: Rect,
    state: &RuntimeState,
    cache: &mut AppCache,
) {
    let colors = palette(state.theme_mode);
    let title = match state.detail_mode {
        DetailMode::File => "File Preview",
        DetailMode::Diff => "Diff Preview",
    };
    let block = panel_block(title, state.focus == FocusPane::Detail, colors);
    let inner = block.inner(area);
    let text = if let Some(file) = state.selected_file() {
        match cache.highlighted_detail_text(file, state.detail_mode, state.theme_mode) {
            Some(content) if !content.lines.is_empty() => {
                visible_text_slice(content, state.detail_scroll as usize, inner.height as usize)
            }
            Some(_) => Text::from(Line::from(Span::styled(
                "<empty>",
                Style::default().fg(colors.muted),
            ))),
            None => Text::from(Line::from(Span::styled(
                "loading preview...",
                Style::default().fg(colors.muted),
            ))),
        }
    } else {
        Text::from(Line::from(Span::styled(
            "No file selected",
            Style::default().fg(colors.muted),
        )))
    };

    frame.render_widget(
        Paragraph::new(text)
            .block(block)
            .style(Style::default().bg(colors.surface).fg(colors.text))
            .wrap(Wrap { trim: false }),
        area,
    );
}

fn visible_text_slice(text: &Text<'static>, start: usize, max_lines: usize) -> Text<'static> {
    if max_lines == 0 || text.lines.is_empty() {
        return Text::default();
    }
    let start = start.min(text.lines.len().saturating_sub(1));
    let end = (start + max_lines).min(text.lines.len());
    Text::from(text.lines[start..end].to_vec())
}

pub(super) fn render_log(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let items: Vec<ListItem> = state
        .visible_event_log_items()
        .iter()
        .take(3)
        .map(|entry| ListItem::new(render_event_line(entry, colors)))
        .collect();

    let list = List::new(items).block(panel_block(
        format!("Event Stream ({})", state.event_log_filter.label()),
        false,
        colors,
    ));
    frame.render_widget(Clear, area);
    frame.render_widget(list, area);
}

pub(super) fn render_file_header_line(
    state: &RuntimeState,
    cache: &AppCache,
    width: u16,
) -> Line<'static> {
    let colors = palette(state.theme_mode);
    let available_width = width.saturating_sub(2) as usize;
    let files = state.file_items();
    let untracked = files
        .iter()
        .filter(|file| file.state_code == "untracked")
        .count();
    let commit_total = state
        .ahead_count
        .map(|count| count.to_string())
        .unwrap_or_else(|| "...".to_string());
    let workspace_agents = state.selected_workspace_agent_count();
    let worktree_total = state
        .worktree_count
        .map(|count| count.to_string())
        .unwrap_or_else(|| "...".to_string());
    let summary = format!(
        "{}, {}, {}, {} agent{}, branch: {}, {}",
        pluralize(files.len(), "file"),
        count_label(untracked, "untracked"),
        pluralize_count_text(&commit_total, "commit"),
        workspace_agents,
        if workspace_agents == 1 { "" } else { "s" },
        state.branch,
        pluralize_count_text(&worktree_total, "worktree"),
    );
    let summary_text = if available_width <= 20 {
        truncate_header_text(&summary, available_width.max(8))
    } else {
        summary
    };
    let mut spans = vec![Span::styled(
        format!(" {summary_text} "),
        Style::default()
            .fg(colors.text)
            .bg(colors.border)
            .add_modifier(Modifier::BOLD),
    )];
    let mut used_width = spans
        .iter()
        .map(|span| span.content.as_ref().chars().count())
        .sum::<usize>();
    for hint in cache.repo_review_hints(&files).into_iter().take(2) {
        let hint_text = format!("[{}:{}]", hint.label, hint.rule_name);
        let extra_width = 1 + hint_text.chars().count();
        if used_width + extra_width > available_width {
            break;
        }
        let color = match hint.level {
            crate::ui::tui::review::ReviewRiskLevel::High => STOPPED,
            crate::ui::tui::review::ReviewRiskLevel::Medium => INFERRED,
        };
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            hint_text,
            Style::default().fg(color).bg(colors.surface),
        ));
        used_width += extra_width;
    }
    if let Some(test_counts) = cache.test_mapping_status_counts() {
        let missing = test_counts.get("missing").copied().unwrap_or(0);
        let changed = test_counts.get("changed").copied().unwrap_or(0);
        let inline = test_counts.get("inline").copied().unwrap_or(0);
        let color = if missing > 0 {
            STOPPED
        } else if changed > 0 || inline > 0 {
            ACTIVE
        } else {
            colors.muted
        };
        let mut parts = Vec::new();
        if missing > 0 {
            parts.push(format!("{missing} miss"));
        }
        if changed > 0 {
            parts.push(format!("{changed} changed"));
        }
        if inline > 0 {
            parts.push(format!("{inline} inline"));
        }
        if !parts.is_empty() {
            let test_text = format!("[tests:{}]", parts.join(" "));
            let extra_width = 1 + test_text.chars().count();
            if used_width + extra_width <= available_width {
                spans.push(Span::raw(" "));
                spans.push(Span::styled(
                    test_text,
                    Style::default().fg(color).bg(colors.surface),
                ));
            }
        }
    }
    Line::from(spans)
}

fn truncate_header_text(value: &str, max_len: usize) -> String {
    if value.chars().count() <= max_len {
        return value.to_string();
    }
    let keep = max_len.saturating_sub(3);
    let truncated = value.chars().take(keep).collect::<String>();
    format!("{truncated}...")
}

fn pluralize(count: usize, noun: &str) -> String {
    if count == 1 {
        format!("{count} {noun}")
    } else {
        format!("{count} {noun}s")
    }
}

fn count_label(count: usize, label: &str) -> String {
    format!("{count} {label}")
}

fn pluralize_count_text(count: &str, noun: &str) -> String {
    match count.parse::<usize>() {
        Ok(value) => pluralize(value, noun),
        Err(_) => format!("{count} {noun}s"),
    }
}

pub(super) fn render_footer(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let line = if area.width < 110 {
        Line::from(vec![
            Span::styled("↑↓", Style::default().fg(colors.accent)),
            Span::styled(" select  ", Style::default().fg(colors.muted)),
            Span::styled("S", Style::default().fg(colors.accent)),
            Span::styled(" run sort  ", Style::default().fg(colors.muted)),
            Span::styled("v", Style::default().fg(colors.accent)),
            Span::styled(" run filter  ", Style::default().fg(colors.muted)),
            Span::styled("u", Style::default().fg(colors.accent)),
            Span::styled(" unknown  ", Style::default().fg(colors.muted)),
            Span::styled("d", Style::default().fg(colors.accent)),
            Span::styled(" preview  ", Style::default().fg(colors.muted)),
            Span::styled("Pg", Style::default().fg(colors.accent)),
            Span::styled(" scroll  ", Style::default().fg(colors.muted)),
            Span::styled("g", Style::default().fg(colors.accent)),
            Span::styled(" refresh fitness  ", Style::default().fg(colors.muted)),
            Span::styled("m", Style::default().fg(colors.accent)),
            Span::styled(" fast/full  ", Style::default().fg(colors.muted)),
            Span::styled("q", Style::default().fg(colors.accent)),
            Span::styled(" quit", Style::default().fg(colors.muted)),
        ])
    } else {
        Line::from(vec![
            Span::styled("Tab", Style::default().fg(colors.accent)),
            Span::styled(
                " Runs/Files/Detail/Fitness  ",
                Style::default().fg(colors.muted),
            ),
            Span::styled("↑↓", Style::default().fg(colors.accent)),
            Span::styled(" select  ", Style::default().fg(colors.muted)),
            Span::styled("S", Style::default().fg(colors.accent)),
            Span::styled(" run sort  ", Style::default().fg(colors.muted)),
            Span::styled("v", Style::default().fg(colors.accent)),
            Span::styled(" run filter  ", Style::default().fg(colors.muted)),
            Span::styled("u", Style::default().fg(colors.accent)),
            Span::styled(" unknown  ", Style::default().fg(colors.muted)),
            Span::styled("d", Style::default().fg(colors.accent)),
            Span::styled(" preview/diff  ", Style::default().fg(colors.muted)),
            Span::styled("Pg", Style::default().fg(colors.accent)),
            Span::styled(" scroll  ", Style::default().fg(colors.muted)),
            Span::styled("f", Style::default().fg(colors.accent)),
            Span::styled(
                if state.follow_mode {
                    " follow:on  "
                } else {
                    " follow:off  "
                },
                Style::default().fg(colors.muted),
            ),
            Span::styled("T", Style::default().fg(colors.accent)),
            Span::styled(" theme  ", Style::default().fg(colors.muted)),
            Span::styled("Esc", Style::default().fg(colors.accent)),
            Span::styled(" clear  ", Style::default().fg(colors.muted)),
            Span::styled("g", Style::default().fg(colors.accent)),
            Span::styled(" refresh fitness  ", Style::default().fg(colors.muted)),
            Span::styled("m", Style::default().fg(colors.accent)),
            Span::styled(" fast/full  ", Style::default().fg(colors.muted)),
            Span::styled("q", Style::default().fg(colors.accent)),
            Span::styled(" quit", Style::default().fg(colors.muted)),
        ])
    };
    frame.render_widget(
        Paragraph::new(line).style(Style::default().bg(colors.bg).fg(colors.text)),
        area,
    );
}

pub(super) fn render_agent_stats_line(state: &RuntimeState, colors: UiPalette) -> Line<'static> {
    let stats = &state.agent_stats;
    let vendors = if stats.by_vendor.is_empty() {
        "-".to_string()
    } else {
        let mut pairs = stats
            .by_vendor
            .iter()
            .map(|(vendor, count)| format!("{vendor}:{count}"))
            .collect::<Vec<_>>();
        pairs.sort();
        pairs.join(" ")
    };
    Line::from(vec![
        Span::styled(
            format!("{} total", stats.total),
            Style::default().fg(colors.text),
        ),
        Span::raw("  "),
        Span::styled(
            format!("{} active", stats.active),
            Style::default().fg(ACTIVE),
        ),
        Span::raw("  "),
        Span::styled(format!("{} idle", stats.idle), Style::default().fg(IDLE)),
        Span::raw("  "),
        Span::styled(
            format!("{:.1}% cpu", stats.total_cpu),
            Style::default().fg(colors.accent),
        ),
        Span::raw("  "),
        Span::styled(
            format!("{:.0}MB", stats.total_mem_mb),
            Style::default().fg(colors.text),
        ),
        Span::raw("  "),
        Span::styled(vendors, Style::default().fg(colors.muted)),
    ])
}

fn render_run_details(
    state: &RuntimeState,
    cache: &AppCache,
    width: u16,
    colors: UiPalette,
) -> Vec<Line<'static>> {
    let Some(run) = state.selected_run_item() else {
        return vec![Line::from(Span::styled(
            "No run selected",
            Style::default().fg(colors.muted),
        ))];
    };

    let model = build_run_operator_model(state, cache, run);
    let state_color = run_status_color(&model.operator_state);
    let block_text = model
        .block_reason
        .clone()
        .unwrap_or_else(|| "ready".to_string());

    if run.is_synthetic_agent_run {
        return render_process_scan_run_details(state, run, &model, width, colors);
    }

    let mut lines = vec![
        Line::from(Span::styled(
            shorten_path(
                run.task_title.as_deref().unwrap_or(&run.display_name),
                width.saturating_sub(4) as usize,
            ),
            Style::default()
                .fg(colors.text)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(vec![
            Span::styled(run.client.clone(), Style::default().fg(colors.accent)),
            Span::raw("  "),
            Span::styled(model.role.as_str(), Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled(model.origin.as_str(), Style::default().fg(colors.accent)),
        ]),
    ];

    if let Some(model_name) = &run.model {
        lines.push(Line::from(vec![
            Span::styled("Model: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(model_name, width.saturating_sub(12) as usize),
                Style::default().fg(colors.text),
            ),
        ]));
    }

    if model.operator_state != "active" && model.operator_state != "executing" {
        let status_text = if block_text == "ready" {
            model.operator_state.clone()
        } else {
            format!("{}  {}", model.operator_state, block_text)
        };
        lines.push(Line::from(vec![
            Span::styled("Status: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(&status_text, width.saturating_sub(12) as usize),
                Style::default().fg(state_color),
            ),
        ]));
    }

    if let Some(warning) = &model.integrity_warning {
        lines.push(Line::from(vec![
            Span::styled("Guard: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(warning, width.saturating_sub(14) as usize),
                Style::default().fg(INFERRED),
            ),
        ]));
    }

    if let Some(event) = &run.last_event_name {
        let tool = run
            .last_tool_name
            .clone()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "-".to_string());
        lines.push(Line::from(vec![
            Span::styled("Last: ", Style::default().fg(colors.muted)),
            Span::styled(event.clone(), Style::default().fg(colors.accent)),
            Span::raw("  "),
            Span::styled("Tool: ", Style::default().fg(colors.muted)),
            Span::styled(tool, Style::default().fg(colors.text)),
        ]));
    }

    if !model.recovery_hints.is_empty() && model.operator_state != "executing" {
        lines.push(Line::from(vec![
            Span::styled("Recovery: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(
                    &model.recovery_hints.join("; "),
                    width.saturating_sub(14) as usize,
                ),
                Style::default().fg(INFERRED),
            ),
        ]));
    }

    if run.is_synthetic_agent_run {
        if let Some(agent) = run
            .attached_agent_key
            .as_ref()
            .and_then(|key| state.detected_agents.iter().find(|agent| &agent.key == key))
        {
            lines.push(Line::from(vec![
                Span::styled("PID: ", Style::default().fg(colors.muted)),
                Span::styled(agent.pid.to_string(), Style::default().fg(colors.text)),
                Span::raw("  "),
                Span::styled("Status: ", Style::default().fg(colors.muted)),
                Span::styled(
                    agent.status.to_ascii_lowercase(),
                    Style::default().fg(run_status_color(&model.operator_state)),
                ),
                Span::raw("  "),
                Span::styled("CPU: ", Style::default().fg(colors.muted)),
                Span::styled(
                    format!("{:.1}%", agent.cpu_percent),
                    Style::default().fg(colors.text),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::styled("Cmd: ", Style::default().fg(colors.muted)),
                Span::styled(
                    shorten_path(&agent.command, width.saturating_sub(10) as usize),
                    Style::default().fg(colors.text),
                ),
            ]));
        }
    } else if !model.changed_files.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Files: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(
                    &model.changed_files.join(", "),
                    width.saturating_sub(12) as usize,
                ),
                Style::default().fg(colors.text),
            ),
        ]));
    }

    lines
}

fn render_process_scan_run_details(
    state: &RuntimeState,
    run: &crate::ui::state::SessionListItem,
    model: &RunOperatorModel,
    width: u16,
    colors: UiPalette,
) -> Vec<Line<'static>> {
    let workspace_path = shorten_path(&model.workspace_path, width.saturating_sub(18) as usize);
    let process_cwd = model
        .process_cwd
        .as_deref()
        .map(|path| shorten_path(path, width.saturating_sub(20) as usize))
        .unwrap_or_else(|| "-".to_string());
    let run_type = if model.origin == RunOrigin::McpService {
        "MCP service"
    } else {
        "process-scan agent"
    };
    let guard_text = model
        .integrity_warning
        .clone()
        .unwrap_or_else(|| "no hook-backed session".to_string());

    let mut lines = vec![
        Line::from(Span::styled(
            shorten_path(&run.display_name, width.saturating_sub(4) as usize),
            Style::default()
                .fg(colors.text)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(vec![
            Span::styled(run_type, Style::default().fg(colors.accent)),
            Span::raw("  "),
            Span::styled(model.role.as_str(), Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled(model.origin.as_str(), Style::default().fg(colors.muted)),
        ]),
        Line::from(vec![
            Span::styled("Workspace: ", Style::default().fg(colors.muted)),
            Span::styled(workspace_path, Style::default().fg(colors.text)),
        ]),
        Line::from(vec![
            Span::styled("Process CWD: ", Style::default().fg(colors.muted)),
            Span::styled(process_cwd, Style::default().fg(colors.text)),
        ]),
        Line::from(vec![
            Span::styled("Status: ", Style::default().fg(colors.muted)),
            Span::styled(
                run.status.to_ascii_lowercase(),
                Style::default().fg(run_status_color(&run.status)),
            ),
        ]),
    ];

    if let Some(agent) = run
        .attached_agent_key
        .as_ref()
        .and_then(|key| state.detected_agents.iter().find(|agent| &agent.key == key))
    {
        lines.push(Line::from(vec![
            Span::styled("PID: ", Style::default().fg(colors.muted)),
            Span::styled(agent.pid.to_string(), Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled("CPU: ", Style::default().fg(colors.muted)),
            Span::styled(
                format!("{:.1}%", agent.cpu_percent),
                Style::default().fg(colors.text),
            ),
            Span::raw("  "),
            Span::styled("Mem: ", Style::default().fg(colors.muted)),
            Span::styled(
                format!("{:.0}MB", agent.mem_mb),
                Style::default().fg(colors.text),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled("Cmd: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(&agent.command, width.saturating_sub(10) as usize),
                Style::default().fg(colors.text),
            ),
        ]));
    }

    lines.push(Line::from(vec![
        Span::styled("Guard: ", Style::default().fg(colors.muted)),
        Span::styled(
            shorten_path(&guard_text, width.saturating_sub(12) as usize),
            Style::default().fg(INFERRED),
        ),
    ]));

    lines
}

pub(super) fn run_status_color(status: &str) -> Color {
    match status {
        "active" | "executing" | "succeeded" => ACTIVE,
        "stopped" | "ended" | "failed" => STOPPED,
        "unknown" | "attention" | "evaluating" | "awaiting_approval" => INFERRED,
        _ => IDLE,
    }
}

pub(super) fn build_run_operator_model(
    state: &RuntimeState,
    cache: &AppCache,
    run: &crate::ui::state::SessionListItem,
) -> RunOperatorModel {
    let changed_files = changed_files_for_run(state, run);
    let workspace_path = workspace_path_for_run(state, run);
    let process_cwd = process_cwd_for_run(state, run);
    let assessment = assess_run(&RunAssessmentInput {
        run_id: &run.session_id,
        display_name: &run.display_name,
        client: &run.client,
        status: &run.status,
        last_event_name: run.last_event_name.as_deref(),
        last_tool_name: run.last_tool_name.as_deref(),
        changed_files: &changed_files,
        touched_files_count: run.touched_files_count,
        exact_files_count: run.exact_count,
        inferred_files_count: run.inferred_count,
        unknown_files_count: run.unknown_count,
        is_unknown_bucket: run.is_unknown_bucket,
        is_synthetic_run: run.is_synthetic_agent_run,
        is_service_run: is_auggie_mcp_service_run(state, run),
        workspace_path: &workspace_path,
        workspace_branch: None,
        workspace_type: WorkspaceType::Main,
        workspace_detached: false,
        workspace_missing: std::path::Path::new(&state.repo_root).exists()
            && !std::path::Path::new(&workspace_path).exists(),
        has_eval: cache.fitness_snapshot().is_some(),
        hard_gate_blocked: cache
            .fitness_snapshot()
            .is_some_and(|snapshot| snapshot.hard_gate_blocked),
        score_blocked: cache
            .fitness_snapshot()
            .is_some_and(|snapshot| snapshot.score_blocked),
        has_coverage: cache
            .fitness_snapshot()
            .is_some_and(|snapshot| snapshot.coverage_summary.has_any_sampled_source()),
        api_contract_passed: cache
            .fitness_snapshot()
            .is_some_and(api_contract_dimension_passed),
    });

    RunOperatorModel {
        role: assessment.role,
        mode: assessment.mode,
        origin: assessment.origin,
        operator_state: assessment.operator_state,
        workspace_path,
        process_cwd,
        workspace_state: assessment.workspace_state,
        effect_classes: assessment.effect_classes,
        policy_decision: assessment.policy_decision,
        approval_label: assessment.approval_label,
        block_reason: assessment.block_reason,
        eval_summary: if is_auggie_mcp_service_run(state, run) {
            Some("workspace-shared".to_string())
        } else {
            cache.fitness_snapshot().map(summarize_eval_snapshot)
        },
        evidence: assessment.evidence,
        integrity_warning: assessment.integrity_warning,
        next_action: assessment.next_action,
        handoff_summary: assessment.handoff_summary,
        recovery_hints: assessment.recovery_hints,
        changed_files,
        planes: assessment.planes,
    }
}

fn changed_files_for_run(
    state: &RuntimeState,
    run: &crate::ui::state::SessionListItem,
) -> Vec<String> {
    let mut files: Vec<&FileView> = state
        .files
        .values()
        .filter(|file| file.dirty || file.conflicted)
        .filter(|file| file_matches_run(file, run))
        .collect();
    files.sort_by(|a, b| {
        b.last_modified_at_ms
            .cmp(&a.last_modified_at_ms)
            .then_with(|| a.rel_path.cmp(&b.rel_path))
    });
    files
        .into_iter()
        .take(3)
        .map(|file| file.rel_path.clone())
        .collect()
}

fn file_matches_run(file: &FileView, run: &crate::ui::state::SessionListItem) -> bool {
    if run.is_unknown_bucket {
        return file.conflicted
            || matches!(file.confidence, AttributionConfidence::Unknown)
            || file.last_session_id.is_none()
            || file.touched_by.is_empty();
    }
    if run.is_synthetic_agent_run {
        return false;
    }
    file.last_session_id.as_deref() == Some(run.session_id.as_str())
        || file.touched_by.contains(&run.session_id)
}

fn workspace_path_for_run(state: &RuntimeState, run: &crate::ui::state::SessionListItem) -> String {
    let _ = run;
    state
        .selected_workspace_path()
        .unwrap_or_else(|| state.repo_root.clone())
}

fn process_cwd_for_run(
    state: &RuntimeState,
    run: &crate::ui::state::SessionListItem,
) -> Option<String> {
    if let Some(agent) = run
        .attached_agent_key
        .as_ref()
        .and_then(|key| state.detected_agents.iter().find(|agent| &agent.key == key))
    {
        return agent.cwd.clone();
    }
    state
        .sessions
        .get(&run.session_id)
        .map(|session| session.cwd.clone())
}

fn is_auggie_mcp_service_run(
    state: &RuntimeState,
    run: &crate::ui::state::SessionListItem,
) -> bool {
    run.attached_agent_key
        .as_ref()
        .and_then(|key| state.detected_agents.iter().find(|agent| &agent.key == key))
        .is_some_and(|agent| {
            agent.name.eq_ignore_ascii_case("auggie")
                && agent.command.to_ascii_lowercase().contains("--mcp")
        })
}

fn api_contract_dimension_passed(snapshot: &fitness::FitnessSnapshot) -> bool {
    snapshot
        .dimensions
        .iter()
        .find(|dim| dim.name.eq_ignore_ascii_case("api_contract"))
        .is_some_and(|dim| dim.hard_gate_failures.is_empty())
}

fn summarize_eval_snapshot(snapshot: &fitness::FitnessSnapshot) -> String {
    let status = if snapshot.hard_gate_blocked {
        "blocked(hard)"
    } else if snapshot.score_blocked {
        "blocked(score)"
    } else {
        "pass"
    };
    format!(
        "{} {} {:.1}%",
        snapshot.mode.as_str(),
        status,
        snapshot.final_score
    )
}

pub(super) fn render_title_bar(
    frame: &mut Frame,
    area: Rect,
    state: &RuntimeState,
    cache: &AppCache,
) {
    let colors = palette(state.theme_mode);
    let files = state.file_items();
    let dirty = files.len();
    let unattributed = files.iter().filter(|file| {
        file.conflicted
            || matches!(
                file.confidence,
                crate::shared::models::AttributionConfidence::Unknown
            )
            || file.last_session_id.is_none()
    });
    let dirty_label = format!("{dirty} dirty");
    let unattributed_label = format!("{} unattributed", unattributed.count());
    let lines_label = format!(
        "lines: {}",
        format_compact_count(cache.scc_summary().map(|summary| summary.lines))
    );
    let loc_label = format!(
        "loc: {}",
        format_compact_count(cache.scc_summary().map(|summary| summary.code))
    );
    let transport = format!("transport: {}", state.runtime_transport);
    let line = if area.width < 110 {
        Line::from(vec![
            Span::styled("routa.js", Style::default().fg(colors.accent)),
            Span::raw("  "),
            Span::styled(dirty_label, Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled(unattributed_label, Style::default().fg(INFERRED)),
            Span::raw("  "),
            Span::styled(lines_label, Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled(loc_label, Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled(transport, Style::default().fg(colors.muted)),
        ])
    } else {
        let current_mode = match state.fitness_view_mode {
            FitnessViewMode::Fast => "fast",
            FitnessViewMode::Full => "full",
        };
        Line::from(vec![
            Span::styled("routa.js", Style::default().fg(colors.accent)),
            Span::raw("  "),
            Span::styled(dirty_label, Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled(unattributed_label, Style::default().fg(INFERRED)),
            Span::raw("  "),
            Span::styled(lines_label, Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled(loc_label, Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled(
                format!("fitness: {current_mode}"),
                Style::default().fg(colors.accent),
            ),
            Span::raw("  "),
            Span::styled(transport, Style::default().fg(colors.muted)),
        ])
    };
    frame.render_widget(
        Paragraph::new(line).style(Style::default().bg(colors.bg).fg(colors.text)),
        area,
    );
}

fn format_compact_count(value: Option<usize>) -> String {
    let Some(value) = value else {
        return "--".to_string();
    };
    if value >= 1_000_000 {
        format!("{:.1}m", value as f64 / 1_000_000.0)
    } else if value >= 1_000 {
        format!("{:.0}k", value as f64 / 1_000.0)
    } else {
        value.to_string()
    }
}

fn summarize_test_paths(paths: &[String], limit: usize) -> String {
    let preview = paths
        .iter()
        .take(limit)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    if paths.len() > limit {
        format!("{preview} +{}", paths.len() - limit)
    } else {
        preview
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visible_text_slice_returns_requested_window() {
        let text = Text::from(vec![
            Line::from("line-1"),
            Line::from("line-2"),
            Line::from("line-3"),
        ]);

        let slice = visible_text_slice(&text, 1, 1);

        assert_eq!(slice.lines.len(), 1);
        assert_eq!(slice.lines[0], Line::from("line-2"));
    }

    #[test]
    fn run_status_color_marks_attention_as_inferred() {
        assert_eq!(run_status_color("attention"), INFERRED);
        assert_eq!(run_status_color("executing"), ACTIVE);
    }
}
