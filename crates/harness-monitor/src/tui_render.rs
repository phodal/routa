use super::fitness;
use super::*;
use crate::domain::evidence::{EvidenceRequirement, EvidenceType};
use crate::domain::policy::{EffectClass, PolicyDecisionKind};
use crate::domain::run::Role;
use crate::domain::workspace::WorkspaceState;
use crate::models::{AttributionConfidence, FileView};
use crate::state::FocusPane;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap};
use std::path::Path;

#[derive(Clone, Copy, PartialEq, Eq)]
enum LayoutMode {
    Full,
    Medium,
    Compact,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FileRowDensity {
    SingleLine,
    TwoLine,
}

#[derive(Clone, Copy)]
pub(super) struct UiPalette {
    bg: Color,
    surface: Color,
    border: Color,
    text: Color,
    muted: Color,
    accent: Color,
    selection_focus: Color,
    selection_blur: Color,
}

#[derive(Clone)]
struct EvidenceRequirementStatus {
    requirement: EvidenceRequirement,
    satisfied: bool,
}

struct RunOperatorModel {
    role: Role,
    origin_label: &'static str,
    operator_state: String,
    workspace_path: String,
    process_cwd: Option<String>,
    workspace_state: WorkspaceState,
    effect_classes: Vec<EffectClass>,
    policy_decision: PolicyDecisionKind,
    approval_label: String,
    block_reason: Option<String>,
    eval_summary: Option<String>,
    evidence: Vec<EvidenceRequirementStatus>,
    integrity_warning: Option<String>,
    next_action: String,
    handoff_summary: Option<String>,
    changed_files: Vec<String>,
}

pub(super) fn palette(theme_mode: ThemeMode) -> UiPalette {
    match theme_mode {
        ThemeMode::Dark => UiPalette {
            bg: Color::Rgb(12, 19, 26),
            surface: Color::Rgb(21, 30, 39),
            border: Color::Rgb(69, 86, 104),
            text: Color::Rgb(219, 228, 236),
            muted: Color::Rgb(132, 149, 164),
            accent: Color::Rgb(157, 189, 213),
            selection_focus: Color::Rgb(73, 98, 122),
            selection_blur: Color::Rgb(45, 61, 78),
        },
        ThemeMode::Light => UiPalette {
            bg: Color::Rgb(238, 242, 246),
            surface: Color::Rgb(248, 250, 252),
            border: Color::Rgb(145, 161, 176),
            text: Color::Rgb(35, 50, 64),
            muted: Color::Rgb(101, 118, 135),
            accent: Color::Rgb(90, 126, 156),
            selection_focus: Color::Rgb(214, 225, 235),
            selection_blur: Color::Rgb(226, 234, 241),
        },
    }
}

pub(super) fn render(
    frame: &mut Frame,
    state: &RuntimeState,
    _feed: &RuntimeFeed,
    cache: &mut AppCache,
) {
    let colors = palette(state.theme_mode);
    frame.render_widget(
        Block::default().style(Style::default().bg(colors.bg).fg(colors.text)),
        frame.area(),
    );
    let layout_mode = layout_mode_for(frame.area());
    let log_height = match layout_mode {
        LayoutMode::Full => 5,
        LayoutMode::Medium | LayoutMode::Compact => 0,
    };
    let outer = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(8),
            Constraint::Length(log_height),
            Constraint::Length(1),
        ])
        .split(frame.area());

    render_title_bar(frame, outer[0], state);
    render_main_area(frame, outer[1], state, cache, layout_mode);
    if outer[2].height > 0 {
        render_log(frame, outer[2], state);
    }
    render_footer(frame, outer[3], state);
}

fn layout_mode_for(area: Rect) -> LayoutMode {
    if area.width < 110 {
        LayoutMode::Compact
    } else if area.width < 165 {
        LayoutMode::Medium
    } else {
        LayoutMode::Full
    }
}

fn render_main_area(
    frame: &mut Frame,
    area: Rect,
    state: &RuntimeState,
    cache: &mut AppCache,
    layout_mode: LayoutMode,
) {
    if layout_mode == LayoutMode::Compact {
        let split = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Percentage(56), Constraint::Percentage(44)])
            .split(area);
        let lower = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Percentage(34),
                Constraint::Percentage(33),
                Constraint::Percentage(33),
            ])
            .split(split[1]);
        render_files(frame, split[0], state, cache, FileRowDensity::TwoLine);
        render_fitness_panel(frame, lower[0], state, cache);
        render_preview_panel(frame, lower[1], state, cache);
        render_details_panel(frame, lower[2], state, cache);
        return;
    }

    if layout_mode == LayoutMode::Medium {
        let columns = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(72), Constraint::Percentage(28)])
            .split(area);
        let left = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Percentage(68), Constraint::Percentage(32)])
            .split(columns[0]);
        let right = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(columns[1]);
        render_files(frame, left[0], state, cache, FileRowDensity::SingleLine);
        render_fitness_panel(frame, left[1], state, cache);
        render_preview_panel(frame, right[0], state, cache);
        render_details_panel(frame, right[1], state, cache);
        return;
    }

    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(25),
            Constraint::Percentage(42),
            Constraint::Percentage(33),
        ])
        .split(area);
    let center = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(70), Constraint::Percentage(30)])
        .split(columns[1]);
    let right = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(60), Constraint::Percentage(40)])
        .split(columns[2]);
    // Left column: Runs pane (Phase 0: list sessions as unmanaged runs).
    // Agents widget is embedded as the bottom sub-panel inside Runs for space efficiency.
    let left_split = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(60), Constraint::Percentage(40)])
        .split(columns[0]);
    render_runs_panel(frame, left_split[0], state);
    render_agents_panel(frame, left_split[1], state);
    render_files(frame, center[0], state, cache, FileRowDensity::TwoLine);
    render_details_panel(frame, center[1], state, cache);
    render_preview_panel(frame, right[0], state, cache);
    render_fitness_panel(frame, right[1], state, cache);
}

fn render_fitness_panel(frame: &mut Frame, area: Rect, state: &RuntimeState, cache: &AppCache) {
    let colors = palette(state.theme_mode);
    let block = panel_block(
        format!("Fitness ({})", state.fitness_view_mode.label()),
        state.focus == FocusPane::Fitness,
        colors,
    );
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let mut lines = Vec::new();
    if let Some(error) = cache.fitness_error() {
        lines.push(Line::from(vec![
            Span::styled("Health Run: ", Style::default().fg(colors.muted)),
            Span::styled("failed", Style::default().fg(STOPPED)),
        ]));
        lines.push(Line::from(vec![Span::styled(
            error.to_string(),
            Style::default().fg(colors.text),
        )]));
        lines.push(Line::from(""));
    }

    if let Some(snapshot) = cache.fitness_snapshot() {
        let score = snapshot.final_score;
        let score_color = if snapshot.hard_gate_blocked || snapshot.score_blocked {
            STOPPED
        } else if score >= 90.0 {
            ACTIVE
        } else if score >= 70.0 {
            INFERRED
        } else {
            STOPPED
        };
        let status = if snapshot.hard_gate_blocked {
            "BLOCKED(hard gate)"
        } else if snapshot.score_blocked {
            "BLOCKED(score)"
        } else {
            "PASS"
        };
        let compact_height = inner.height <= 8;
        let medium_height = inner.height <= 13;
        let bar_width = inner.width.saturating_sub(36).clamp(8, 28) as usize;

        lines.push(Line::from(vec![
            Span::styled("Score: ", Style::default().fg(colors.muted)),
            Span::styled(
                format!("{status} "),
                Style::default()
                    .fg(score_color)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(format!("{score:.1}% "), Style::default().fg(score_color)),
            Span::raw(format!(
                "({}/{})",
                fitness::passed_metric_count(snapshot),
                snapshot.metric_count
            )),
            Span::styled(" ", Style::default()),
            Span::styled(
                format!("{}ms", snapshot.duration_ms.round() as u64),
                Style::default().fg(colors.muted),
            ),
        ]));
        lines.push(Line::from(vec![
            fitness_bar_label(score),
            Span::raw(" "),
            render_score_bar(score, bar_width),
        ]));

        if let Some(last_run_ms) = cache.fitness_last_run_ms() {
            lines.push(Line::from(vec![
                Span::styled(
                    format!("last run: {}", format_ts(last_run_ms)),
                    Style::default().fg(colors.muted),
                ),
                Span::raw("  "),
                Span::styled(
                    if snapshot.coverage_summary.has_any_sampled_source() {
                        fitness::coverage_status_line(snapshot)
                    } else {
                        "coverage evidence missing".to_string()
                    },
                    Style::default().fg(if snapshot.coverage_summary.has_any_sampled_source() {
                        INFERRED
                    } else {
                        colors.muted
                    }),
                ),
            ]));
            if let Some(coverage_generated_at_ms) = snapshot.coverage_summary.generated_at_ms {
                lines.push(Line::from(vec![
                    Span::styled("coverage updated: ", Style::default().fg(colors.muted)),
                    Span::styled(
                        format_ts(coverage_generated_at_ms),
                        Style::default().fg(colors.text),
                    ),
                ]));
            }
        }
        lines.push(Line::from(vec![
            Span::styled("mode: ", Style::default().fg(colors.muted)),
            Span::styled(snapshot.mode.label(), Style::default().fg(colors.accent)),
            Span::raw("  "),
            Span::styled("press ", Style::default().fg(colors.muted)),
            Span::styled("m", Style::default().fg(colors.accent)),
            Span::styled(" to switch", Style::default().fg(colors.muted)),
        ]));
        let trend = cache.fitness_trend();
        if trend.len() >= 2 && !compact_height {
            let latest = trend.last().copied().unwrap_or(0.0);
            let prev = trend
                .get(trend.len().saturating_sub(2))
                .copied()
                .unwrap_or(0.0);
            let delta = latest - prev;
            let delta_text = if delta >= 0.0 {
                format!("+{delta:.1}")
            } else {
                format!("{delta:.1}")
            };
            let delta_color = if delta >= 0.0 { ACTIVE } else { STOPPED };
            lines.push(Line::from(vec![
                Span::styled("Trend:", Style::default().fg(colors.text)),
                Span::raw(" "),
                render_score_sparkline(trend),
                Span::raw(" "),
                Span::styled(format!("({delta_text})"), Style::default().fg(delta_color)),
                Span::raw(" "),
                Span::styled(
                    format!("n={}", trend.len()),
                    Style::default().fg(colors.muted),
                ),
            ]));
        }

        lines.push(Line::from(vec![Span::styled(
            "Dimension scores:",
            Style::default()
                .fg(colors.text)
                .add_modifier(Modifier::BOLD),
        )]));
        let dimension_limit = if snapshot.mode == fitness::FitnessRunMode::Full {
            snapshot.dimensions.len()
        } else if compact_height {
            2
        } else if medium_height {
            3
        } else {
            4
        };
        for dim in snapshot.dimensions.iter().take(dimension_limit) {
            let dim_name_width = inner.width.saturating_sub(36).clamp(14, 22) as usize;
            let dim_bar_width = inner
                .width
                .saturating_sub(dim_name_width as u16 + 16)
                .clamp(8, 28) as usize;
            let warning = if dim.hard_gate_failures.is_empty() {
                String::new()
            } else {
                format!("  !{}", dim.hard_gate_failures.join(","))
            };
            let mut row = vec![Span::styled(
                format!("{:>3}%", dim.score.round() as u8),
                Style::default().fg(score_color_for_value(dim.score)),
            )];
            row.push(Span::raw(" "));
            row.push(Span::styled(
                format!(
                    "{:<dim_name_width$}",
                    truncate_short(&dim.name, dim_name_width)
                ),
                Style::default().fg(colors.text),
            ));
            row.push(Span::raw(" "));
            row.push(Span::styled(
                format!("w{:>2}", dim.weight),
                Style::default().fg(colors.muted),
            ));
            row.push(Span::raw(" "));
            row.push(Span::styled(
                format!("{:>2}/{:<2}", dim.passed, dim.total),
                Style::default().fg(colors.muted),
            ));
            row.push(Span::raw(" "));
            row.push(render_score_bar(dim.score, dim_bar_width));
            if !warning.is_empty() {
                row.push(Span::styled(warning, Style::default().fg(STOPPED)));
            }
            lines.push(Line::from(row));
        }

        if !compact_height {
            lines.push(Line::from(vec![
                Span::styled("Slowest:", Style::default().fg(colors.text)),
                Span::raw(" "),
                Span::styled(
                    fitness::critical_metric_hint(snapshot),
                    Style::default().fg(colors.muted),
                ),
            ]));
            let slow_metric_limit = if medium_height { 3 } else { 5 };
            let slowest_metrics = snapshot
                .slowest_metrics
                .iter()
                .take(slow_metric_limit)
                .collect::<Vec<_>>();
            if !slowest_metrics.is_empty() {
                let mut max_duration = slowest_metrics
                    .iter()
                    .map(|metric| metric.duration_ms)
                    .reduce(f64::max)
                    .unwrap_or(1.0);
                if max_duration <= 0.0 {
                    max_duration = 1.0;
                }
                lines.push(Line::from(vec![Span::styled(
                    format!("Top {slow_metric_limit} slowest metrics:"),
                    Style::default().fg(colors.text),
                )]));
                let metric_bar_width = inner.width.saturating_sub(48).clamp(8, 20) as usize;
                for metric in slowest_metrics {
                    let mut metric_name = metric.name.clone();
                    if metric_name.is_empty() {
                        metric_name = "<unnamed>".to_string();
                    }
                    let metric_color = metric_color(metric);
                    lines.push(Line::from(vec![
                        Span::styled(
                            format!("{:>7.1}", metric.duration_ms),
                            Style::default().fg(metric_color),
                        ),
                        Span::raw("ms "),
                        Span::styled(
                            format!("{:<18}", truncate_short(&metric_name, 18)),
                            Style::default().fg(colors.text),
                        ),
                        Span::raw(" "),
                        render_metric_bar(
                            metric.duration_ms,
                            max_duration,
                            metric_bar_width,
                            metric_color,
                        ),
                        Span::raw(" "),
                        Span::styled(
                            format!("[{}]", metric.state),
                            Style::default().fg(metric_color),
                        ),
                    ]));
                }
            } else {
                lines.push(Line::from(vec![Span::styled(
                    "no slow metrics in this run",
                    Style::default().fg(colors.muted),
                )]));
            }
        }

        if cache.is_fitness_running() {
            lines.push(Line::from(vec![
                Span::raw(" "),
                Span::styled("refresh queued", Style::default().fg(INFERRED)),
            ]));
        }
        frame.render_widget(
            Paragraph::new(lines)
                .block(Block::default())
                .scroll((state.fitness_scroll, 0))
                .style(Style::default().bg(colors.surface).fg(colors.text))
                .wrap(Wrap { trim: true }),
            inner,
        );
        return;
    }

    if cache.is_fitness_running() {
        lines.push(Line::from(vec![
            Span::styled("Health Run: ", Style::default().fg(colors.muted)),
            Span::styled("running...", Style::default().fg(colors.accent)),
        ]));
    } else {
        lines.push(Line::from(vec![
            Span::styled("Health Run: ", Style::default().fg(colors.muted)),
            Span::styled("idle", Style::default().fg(colors.accent)),
            Span::raw(" (press "),
            Span::styled("g", Style::default().fg(colors.accent)),
            Span::raw(" refresh, "),
            Span::styled("m", Style::default().fg(colors.accent)),
            Span::raw(" switch mode)"),
        ]));
    }
    frame.render_widget(
        Paragraph::new(lines)
            .block(Block::default())
            .scroll((state.fitness_scroll, 0))
            .style(Style::default().bg(colors.surface).fg(colors.text))
            .wrap(Wrap { trim: true }),
        inner,
    );
}

fn render_metric_bar(value: f64, max_value: f64, width: usize, color: Color) -> Span<'static> {
    let width = width.clamp(6, 30);
    let filled = if max_value <= 0.0 {
        0
    } else {
        ((value / max_value) * width as f64).round() as usize
    };
    let filled = filled.min(width);
    let empty = width.saturating_sub(filled);
    Span::styled(
        format!("{}{}", "█".repeat(filled), "░".repeat(empty)),
        Style::default().fg(color),
    )
}

fn render_score_sparkline(values: &[f64]) -> Span<'static> {
    if values.len() < 2 {
        return Span::styled("-", Style::default().fg(STOPPED));
    }

    let min = values.iter().copied().fold(f64::INFINITY, f64::min);
    let max = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let range = (max - min).max(0.01);
    let bars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    let mut spark = String::new();
    for value in values.iter().copied() {
        let ratio = ((value - min) / range).clamp(0.0, 1.0);
        let idx = (ratio * (bars.len() as f64 - 1.0)).round() as usize;
        let idx = idx.min(bars.len() - 1);
        spark.push(bars[idx]);
    }
    Span::styled(
        spark,
        Style::default().fg(score_color_for_value(*values.last().unwrap_or(&0.0))),
    )
}

fn render_score_bar(score: f64, width: usize) -> Span<'static> {
    let width = width.clamp(6, 30);
    let filled = ((score / 100.0) * width as f64).round() as usize;
    let filled = filled.min(width);
    let empty = width.saturating_sub(filled);
    let bar = format!("{}{}", "█".repeat(filled), "░".repeat(empty));
    Span::styled(
        format!("{bar:>width$}"),
        Style::default().fg(score_color_for_value(score)),
    )
}

fn fitness_bar_label(score: f64) -> Span<'static> {
    Span::styled(
        format!("[{score:>5.1}%]"),
        Style::default().fg(score_color_for_value(score)),
    )
}

fn score_color_for_value(score: f64) -> Color {
    if score >= 90.0 {
        ACTIVE
    } else if score >= 70.0 {
        INFERRED
    } else {
        STOPPED
    }
}

fn metric_color(metric: &fitness::FitnessMetricSummary) -> Color {
    if metric.passed {
        ACTIVE
    } else if metric.hard_gate {
        STOPPED
    } else {
        INFERRED
    }
}

fn truncate_short(value: &str, max_len: usize) -> String {
    if value.len() <= max_len {
        value.to_string()
    } else {
        let keep = max_len.saturating_sub(3);
        format!("{}...", &value[..keep])
    }
}

fn render_agents_panel(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let outer_block = panel_block("Agents", false, colors);
    let inner = outer_block.inner(area);
    frame.render_widget(outer_block, area);
    let split = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(2), Constraint::Min(6)])
        .split(inner);
    frame.render_widget(
        Paragraph::new(render_agent_stats_line(state, colors))
            .style(Style::default().bg(colors.surface).fg(colors.text)),
        split[0],
    );
    let agent_lines = render_agent_rows(state, colors);
    frame.render_widget(
        Paragraph::new(agent_lines)
            .style(Style::default().bg(colors.surface).fg(colors.text))
            .wrap(Wrap { trim: true }),
        split[1],
    );
}

/// Renders the Runs pane — presents active sessions through the Run/Task vocabulary.
///
/// In Phase 0 every session is an **unmanaged run**. The pane shows role,
/// mode, client, file attribution summary, and eval-readiness. When managed
/// mode is implemented (Phase 3) this will also show managed runs.
fn render_runs_panel(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let focused = state.focus == FocusPane::Runs;
    let title = if focused { "Runs [Tab]" } else { "Runs" };
    let outer_block = panel_block(title, focused, colors);
    let inner = outer_block.inner(area);
    frame.render_widget(outer_block, area);

    let sessions = state.runs();
    let worktrees = state.worktree_count.unwrap_or(1);

    // Header summary line
    let split = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(2), Constraint::Min(1)])
        .split(inner);

    let active_runs = sessions.iter().filter(|s| s.status == "active").count();
    let summary_line = Line::from(vec![
        Span::styled(
            format!(" {} active", active_runs),
            Style::default().fg(if active_runs > 0 {
                ACTIVE
            } else {
                colors.muted
            }),
        ),
        Span::styled(
            format!("  {} total", sessions.len()),
            Style::default().fg(colors.text),
        ),
        Span::styled(
            format!("  {} worktree(s)", worktrees),
            Style::default().fg(colors.muted),
        ),
        Span::styled("  mode:", Style::default().fg(colors.muted)),
        Span::styled("unmanaged", Style::default().fg(colors.accent)),
    ]);
    let visible_height = split[1].height as usize;
    let start = run_window_start(sessions.len(), state.selected_run, visible_height.max(1));
    let end = (start + visible_height).min(sessions.len());
    let progress_text = if sessions.is_empty() {
        "0/0".to_string()
    } else {
        format!("{}-{}/{}", start + 1, end, sessions.len())
    };
    let controls_line = Line::from(vec![
        Span::styled(" filter:", Style::default().fg(colors.muted)),
        Span::styled(
            state.run_filter_mode.label(),
            Style::default().fg(colors.accent),
        ),
        Span::styled("  sort:", Style::default().fg(colors.muted)),
        Span::styled(
            state.run_sort_mode.label(),
            Style::default().fg(colors.accent),
        ),
        Span::styled("  view:", Style::default().fg(colors.muted)),
        Span::styled(progress_text, Style::default().fg(colors.text)),
    ]);
    frame.render_widget(
        Paragraph::new(vec![summary_line, controls_line])
            .style(Style::default().bg(colors.surface)),
        split[0],
    );

    // Run rows
    let items: Vec<ListItem> = sessions[start..end]
        .iter()
        .enumerate()
        .map(|(idx, session)| {
            let absolute_idx = start + idx;
            let selected = absolute_idx == state.selected_run && focused;
            let bg = if selected {
                colors.selection_focus
            } else {
                colors.surface
            };

            let list_state = run_list_state_label(state, session);
            let status_color = run_status_color(list_state);
            let icon = crate::models::HookClient::from_str(&session.client).icon();
            let run_name = if session.is_unknown_bucket {
                "unattributed".to_string()
            } else {
                session.display_name.clone()
            };
            let role = infer_run_role(session);
            let origin = run_origin_label(state, session);
            let run_label_width = split[1].width.saturating_sub(18) as usize;
            let event_label = match (&session.last_event_name, &session.last_tool_name) {
                (Some(event), Some(tool)) if !tool.is_empty() => format!("{event}/{tool}"),
                (Some(event), _) => event.clone(),
                _ => "-".to_string(),
            };

            let primary = Line::from(vec![
                Span::styled(
                    if selected { "▶ " } else { "  " },
                    Style::default().fg(colors.accent).bg(bg),
                ),
                Span::styled(
                    format!(
                        "{} {}",
                        icon,
                        pad_right(
                            &shorten_path(&run_name, run_label_width.max(12)),
                            run_label_width
                        )
                    ),
                    Style::default()
                        .fg(if session.is_unknown_bucket {
                            colors.muted
                        } else {
                            colors.text
                        })
                        .bg(bg)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!(" {}", list_state),
                    Style::default().fg(status_color).bg(bg),
                ),
                Span::styled(
                    format!("  {}", pad_left(&time_ago(session.last_seen_at_ms), 4)),
                    Style::default().fg(colors.muted).bg(bg),
                ),
            ]);
            let secondary = Line::from(vec![
                Span::styled(
                    format!(
                        "  {}  {}  {}  files:{}  e/i/?:{}/{}/{}",
                        role.as_str(),
                        origin,
                        session.client,
                        session.touched_files_count,
                        session.exact_count,
                        session.inferred_count,
                        session.unknown_count
                    ),
                    Style::default().fg(colors.muted).bg(bg),
                ),
                if !event_label.is_empty() && event_label != "-" {
                    Span::styled(
                        format!("  {}", shorten_path(&event_label, 18)),
                        Style::default().fg(colors.accent).bg(bg),
                    )
                } else {
                    Span::styled("", Style::default().bg(bg))
                },
                if let Some(agent_summary) = &session.agent_summary {
                    Span::styled(
                        format!("  {}", shorten_path(agent_summary, 18)),
                        Style::default()
                            .fg(if session.unknown_count > 0 {
                                INFERRED
                            } else {
                                colors.muted
                            })
                            .bg(bg),
                    )
                } else {
                    Span::styled("", Style::default().bg(bg))
                },
            ]);
            ListItem::new(vec![primary, secondary])
        })
        .collect();

    if items.is_empty() {
        frame.render_widget(
            Paragraph::new(Line::from(vec![Span::styled(
                " No active runs. Start an agent or use `harness-monitor hook` to register one.",
                Style::default().fg(colors.muted),
            )]))
            .wrap(Wrap { trim: true })
            .style(Style::default().bg(colors.surface)),
            split[1],
        );
    } else {
        frame.render_widget(
            List::new(items).style(Style::default().bg(colors.surface)),
            split[1],
        );
    }
}

fn run_window_start(total: usize, selected: usize, visible: usize) -> usize {
    if total <= visible {
        return 0;
    }
    // Rows per item = 2 (primary + secondary line)
    let items_visible = (visible / 2).max(1);
    if selected < items_visible {
        0
    } else {
        (selected - items_visible + 1).min(total.saturating_sub(items_visible))
    }
}

fn render_files(
    frame: &mut Frame,
    area: ratatui::layout::Rect,
    state: &RuntimeState,
    cache: &AppCache,
    density: FileRowDensity,
) {
    let colors = palette(state.theme_mode);
    let outer_block = panel_block("Git Status", state.focus == FocusPane::Files, colors);
    let inner = outer_block.inner(area);
    frame.render_widget(outer_block, area);
    let split = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(1)])
        .split(inner);
    frame.render_widget(
        Paragraph::new(render_file_header_line(state, cache, split[0].width))
            .style(Style::default().bg(colors.surface).fg(colors.text)),
        split[0],
    );
    let visible_rows = split[1].height.saturating_sub(1) as usize;
    let rows_per_item = match density {
        FileRowDensity::SingleLine => 1,
        FileRowDensity::TwoLine => 2,
    };
    let items_per_page = (visible_rows / rows_per_item).max(1);
    let all_files = state.file_items();
    let start = file_window_start(all_files.len(), state.selected_file, items_per_page);
    let end = (start + items_per_page).min(all_files.len());
    let items: Vec<ListItem> = all_files[start..end]
        .iter()
        .enumerate()
        .map(|(idx, file)| {
            let absolute_idx = start + idx;
            let selected = absolute_idx == state.selected_file;
            let diff_stat = cache
                .diff_stat(file)
                .cloned()
                .unwrap_or_else(|| DiffStatSummary {
                    status: display_status_code(file),
                    additions: None,
                    deletions: None,
                });
            let (file_name, parent_dir) = split_display_path(file);
            let rows = match density {
                FileRowDensity::SingleLine => vec![render_file_single_line(
                    selected,
                    &file_name,
                    file,
                    &diff_stat,
                    colors,
                    state.focus == FocusPane::Files,
                    split[1].width as usize,
                )],
                FileRowDensity::TwoLine => {
                    let primary = Line::from(vec![Span::styled(
                        format!(
                            "{} {}",
                            if selected { ">" } else { " " },
                            shorten_path(&file_name, split[1].width.saturating_sub(6) as usize)
                        ),
                        row_style(selected, state.focus == FocusPane::Files, colors)
                            .add_modifier(Modifier::BOLD),
                    )]);
                    let secondary = render_file_meta_line(file, &parent_dir, &diff_stat, colors);
                    vec![primary, secondary]
                }
            };
            let mut item = ListItem::new(rows);
            if selected {
                item = item.style(row_style(selected, state.focus == FocusPane::Files, colors));
            }
            item
        })
        .collect();

    let list = List::new(items).block(
        Block::default()
            .borders(Borders::TOP)
            .border_style(Style::default().fg(colors.border))
            .style(Style::default().bg(colors.surface)),
    );
    frame.render_widget(list, split[1]);
}

fn render_details_panel(frame: &mut Frame, area: Rect, state: &RuntimeState, cache: &AppCache) {
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
        if let Some(facts) = cache.file_facts(file) {
            lines.push(Line::from(vec![
                Span::styled("Type: ", Style::default().fg(colors.muted)),
                Span::styled(
                    if facts.entry_kind.is_directory() {
                        "directory"
                    } else {
                        "file"
                    },
                    Style::default().fg(colors.text),
                ),
            ]));
            if facts.entry_kind.is_directory() {
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
        } else {
            lines.push(Line::from(Span::styled(
                "Lines: ...  Size: ...  Git changes: ...",
                Style::default().fg(colors.muted),
            )));
        }
    } else {
        lines.push(Line::from(Span::styled(
            "No file selected",
            Style::default().fg(colors.muted),
        )));
    }

    let block = panel_block("Details", false, colors);
    frame.render_widget(
        Paragraph::new(lines)
            .block(block)
            .style(Style::default().bg(colors.surface).fg(colors.text))
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn render_preview_panel(frame: &mut Frame, area: Rect, state: &RuntimeState, cache: &mut AppCache) {
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

fn render_log(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
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

fn render_file_header_line(state: &RuntimeState, cache: &AppCache, _width: u16) -> Line<'static> {
    let colors = palette(state.theme_mode);
    let files = state.file_items();
    let _ = cache;
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
        "{}, {}, workspace: {}, {} agent{}, branch: {}, {}",
        pluralize(files.len(), "file"),
        pluralize_count_text(&commit_total, "commit"),
        state.selected_workspace_scope_label(),
        workspace_agents,
        if workspace_agents == 1 { "" } else { "s" },
        state.branch,
        pluralize_count_text(&worktree_total, "worktree"),
    );
    Line::from(vec![Span::styled(
        format!(" {summary} "),
        Style::default()
            .fg(colors.text)
            .bg(colors.border)
            .add_modifier(Modifier::BOLD),
    )])
}

fn pluralize(count: usize, noun: &str) -> String {
    if count == 1 {
        format!("{count} {noun}")
    } else {
        format!("{count} {noun}s")
    }
}

fn pluralize_count_text(count: &str, noun: &str) -> String {
    match count.parse::<usize>() {
        Ok(value) => pluralize(value, noun),
        Err(_) => format!("{count} {noun}s"),
    }
}

fn render_footer(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
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

fn render_agent_stats_line(state: &RuntimeState, colors: UiPalette) -> Line<'static> {
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
    let workspace_path = shorten_path(&model.workspace_path, width.saturating_sub(18) as usize);
    let process_cwd = model
        .process_cwd
        .as_deref()
        .map(|path| shorten_path(path, width.saturating_sub(20) as usize))
        .unwrap_or_else(|| "-".to_string());
    let next_text = model
        .handoff_summary
        .as_ref()
        .map(|handoff| format!("{}  {}", model.next_action, handoff))
        .unwrap_or_else(|| model.next_action.clone());

    if run.is_synthetic_agent_run {
        return render_process_scan_run_details(state, run, &model, width, colors);
    }

    let mut lines = vec![
        Line::from(Span::styled(
            shorten_path(&run.display_name, width.saturating_sub(4) as usize),
            Style::default()
                .fg(colors.text)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(vec![
            Span::styled(
                shorten_path(&run.session_id, 18),
                Style::default().fg(colors.muted),
            ),
            Span::raw("  "),
            Span::styled(model.role.as_str(), Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled(model.origin_label, Style::default().fg(colors.accent)),
        ]),
        Line::from(vec![
            Span::styled("State: ", Style::default().fg(colors.muted)),
            Span::styled(
                model.operator_state.clone(),
                Style::default().fg(state_color),
            ),
            Span::raw("  "),
            Span::styled("Block: ", Style::default().fg(colors.muted)),
            Span::styled(block_text, Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled("Mode: ", Style::default().fg(colors.muted)),
            Span::styled("unmanaged", Style::default().fg(colors.text)),
        ]),
        Line::from(vec![
            Span::styled("Workspace: ", Style::default().fg(colors.muted)),
            Span::styled(
                model.workspace_state.as_str(),
                Style::default().fg(colors.accent),
            ),
            Span::raw("  "),
            Span::styled("Path: ", Style::default().fg(colors.muted)),
            Span::styled(workspace_path, Style::default().fg(colors.text)),
        ]),
        Line::from(vec![
            Span::styled("Process CWD: ", Style::default().fg(colors.muted)),
            Span::styled(process_cwd, Style::default().fg(colors.text)),
        ]),
        Line::from(vec![
            Span::styled("Eval: ", Style::default().fg(colors.muted)),
            Span::styled(
                model
                    .eval_summary
                    .clone()
                    .unwrap_or_else(|| "pending".to_string()),
                Style::default().fg(colors.text),
            ),
            Span::raw("  "),
            Span::styled("Evidence: ", Style::default().fg(colors.muted)),
            Span::styled(
                evidence_inline_summary(&model.evidence),
                Style::default().fg(colors.text),
            ),
        ]),
        Line::from(vec![
            Span::styled("Policy: ", Style::default().fg(colors.muted)),
            Span::styled(
                model.policy_decision.as_str(),
                Style::default().fg(colors.accent),
            ),
            Span::raw("  "),
            Span::styled("Approval: ", Style::default().fg(colors.muted)),
            Span::styled(
                model.approval_label.clone(),
                Style::default().fg(colors.text),
            ),
        ]),
        Line::from(vec![
            Span::styled("Effects: ", Style::default().fg(colors.muted)),
            Span::styled(
                effect_classes_summary(&model.effect_classes),
                Style::default().fg(colors.text),
            ),
            Span::raw("  "),
            Span::styled("Next: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(&next_text, width.saturating_sub(20) as usize),
                Style::default().fg(colors.text),
            ),
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

    if let Some(summary) = &run.agent_summary {
        lines.push(Line::from(vec![
            Span::styled("Agents: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(summary, width.saturating_sub(12) as usize),
                Style::default().fg(colors.text),
            ),
        ]));
    }

    if let Some(warning) = &model.integrity_warning {
        lines.push(Line::from(vec![
            Span::styled("Guard: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(warning, width.saturating_sub(12) as usize),
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
    run: &crate::state::SessionListItem,
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
    let run_type = if model.origin_label == "mcp-service" {
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
            Span::styled(model.origin_label, Style::default().fg(colors.muted)),
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

fn run_status_color(status: &str) -> Color {
    match status {
        "active" | "executing" | "succeeded" => ACTIVE,
        "stopped" | "ended" | "failed" => STOPPED,
        "unknown" | "attention" | "evaluating" | "awaiting_approval" => INFERRED,
        _ => IDLE,
    }
}

fn build_run_operator_model(
    state: &RuntimeState,
    cache: &AppCache,
    run: &crate::state::SessionListItem,
) -> RunOperatorModel {
    let changed_files = changed_files_for_run(state, run);
    let role = infer_run_role(run);
    let origin_label = run_origin_label(state, run);
    let workspace_path = workspace_path_for_run(state, run);
    let process_cwd = process_cwd_for_run(state, run);
    let effect_classes = infer_effect_classes(run, &changed_files);
    let policy_decision = infer_policy_decision(run, &effect_classes);
    let evidence = build_evidence_requirements(cache, run, &changed_files, policy_decision.clone());
    let integrity_warning = integrity_warning_for_run(state, run, &changed_files);
    let workspace_state = infer_workspace_state(
        cache,
        state,
        run,
        &changed_files,
        integrity_warning.as_ref(),
    );
    let block_reason = infer_block_reason(state, cache, run, policy_decision.clone(), &evidence);
    let operator_state = infer_operator_state(state, cache, run, block_reason.as_deref());
    let approval_label = approval_label_for(policy_decision.clone(), &evidence);
    let next_action = next_action_for(run, policy_decision.clone(), block_reason.as_deref());
    let handoff_summary = handoff_summary_for(
        role.clone(),
        operator_state.as_str(),
        block_reason.as_deref(),
    );

    RunOperatorModel {
        role,
        origin_label,
        operator_state,
        workspace_path,
        process_cwd,
        workspace_state,
        effect_classes,
        policy_decision,
        approval_label,
        block_reason,
        eval_summary: if is_auggie_mcp_service_run(state, run) {
            Some("workspace-shared".to_string())
        } else {
            cache.fitness_snapshot().map(summarize_eval_snapshot)
        },
        evidence,
        integrity_warning,
        next_action,
        handoff_summary,
        changed_files,
    }
}

fn run_list_state_label(
    state: &RuntimeState,
    run: &crate::state::SessionListItem,
) -> &'static str {
    if run.is_unknown_bucket {
        "attention"
    } else if is_auggie_mcp_service_run(state, run) {
        "service"
    } else if run.is_synthetic_agent_run {
        if run.status == "active" {
            "executing"
        } else {
            "observing"
        }
    } else {
        match run.status.as_str() {
            "active" => "executing",
            "idle" | "stopped" | "ended" => "evaluating",
            "unknown" => "attention",
            _ => "idle",
        }
    }
}

fn changed_files_for_run(state: &RuntimeState, run: &crate::state::SessionListItem) -> Vec<String> {
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

fn file_matches_run(file: &FileView, run: &crate::state::SessionListItem) -> bool {
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

fn infer_run_role(run: &crate::state::SessionListItem) -> Role {
    let mut haystack = run.display_name.to_ascii_lowercase();
    haystack.push(' ');
    haystack.push_str(&run.session_id.to_ascii_lowercase());
    if let Some(event) = &run.last_event_name {
        haystack.push(' ');
        haystack.push_str(&event.to_ascii_lowercase());
    }

    if haystack.contains("planner") || haystack.contains("plan") {
        Role::Planner
    } else if haystack.contains("review") || haystack.contains("test") {
        Role::Reviewer
    } else if haystack.contains("fix") {
        Role::Fixer
    } else if haystack.contains("release") {
        Role::Release
    } else if haystack.contains("care") || haystack.contains("cleanup") {
        Role::Caretaker
    } else {
        Role::Builder
    }
}

fn run_origin_label(state: &RuntimeState, run: &crate::state::SessionListItem) -> &'static str {
    if run.is_unknown_bucket {
        "attribution-review"
    } else if is_auggie_mcp_service_run(state, run) {
        "mcp-service"
    } else if run.is_synthetic_agent_run {
        "process-scan"
    } else {
        "hook-backed"
    }
}

fn workspace_path_for_run(state: &RuntimeState, run: &crate::state::SessionListItem) -> String {
    let _ = run;
    state
        .selected_workspace_path()
        .unwrap_or_else(|| state.repo_root.clone())
}

fn process_cwd_for_run(
    state: &RuntimeState,
    run: &crate::state::SessionListItem,
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

fn is_auggie_mcp_service_run(state: &RuntimeState, run: &crate::state::SessionListItem) -> bool {
    run.attached_agent_key
        .as_ref()
        .and_then(|key| state.detected_agents.iter().find(|agent| &agent.key == key))
        .is_some_and(|agent| {
            agent.name.eq_ignore_ascii_case("auggie")
                && agent.command.to_ascii_lowercase().contains("--mcp")
        })
}

fn infer_effect_classes(
    run: &crate::state::SessionListItem,
    changed_files: &[String],
) -> Vec<EffectClass> {
    let mut effects = Vec::new();
    if !changed_files.is_empty() || run.touched_files_count > 0 || run.is_unknown_bucket {
        effects.push(EffectClass::RepoWrite);
    }
    match run
        .last_tool_name
        .as_deref()
        .map(|value| value.to_ascii_lowercase())
    {
        Some(tool) if tool == "websearch" => effects.push(EffectClass::NetworkRead),
        Some(tool) if matches!(tool.as_str(), "write" | "edit" | "multiedit") => {
            effects.push(EffectClass::RepoWrite)
        }
        Some(tool) if tool == "bash" => effects.push(EffectClass::LocalWrite),
        Some(tool) if matches!(tool.as_str(), "read" | "search" | "grep" | "glob" | "ls") => {
            effects.push(EffectClass::ReadOnly)
        }
        _ => {}
    }
    if effects.is_empty() {
        effects.push(EffectClass::ReadOnly);
    }
    effects.sort();
    effects.dedup();
    effects
}

fn infer_policy_decision(
    run: &crate::state::SessionListItem,
    effect_classes: &[EffectClass],
) -> PolicyDecisionKind {
    if run.is_unknown_bucket {
        return PolicyDecisionKind::Deny;
    }
    if effect_classes
        .iter()
        .any(EffectClass::requires_explicit_allow)
    {
        PolicyDecisionKind::RequireApproval
    } else if effect_classes.iter().any(|effect| {
        matches!(
            effect,
            EffectClass::RepoWrite
                | EffectClass::GitWrite
                | EffectClass::PrCreate
                | EffectClass::Merge
                | EffectClass::Deploy
                | EffectClass::ProdWrite
        )
    }) {
        PolicyDecisionKind::AllowWithEvidence
    } else {
        PolicyDecisionKind::Allow
    }
}

fn build_evidence_requirements(
    cache: &AppCache,
    run: &crate::state::SessionListItem,
    changed_files: &[String],
    policy_decision: PolicyDecisionKind,
) -> Vec<EvidenceRequirementStatus> {
    let mut evidence = Vec::new();
    let has_eval = cache.fitness_snapshot().is_some();
    let has_coverage = cache
        .fitness_snapshot()
        .is_some_and(|snapshot| snapshot.coverage_summary.has_any_sampled_source());

    if !changed_files.is_empty() || run.touched_files_count > 0 || run.is_unknown_bucket {
        evidence.push(EvidenceRequirementStatus {
            requirement: EvidenceRequirement {
                kind: EvidenceType::DiffSummary,
                description: "dirty diff recorded".to_string(),
                required: true,
            },
            satisfied: !changed_files.is_empty() || run.is_unknown_bucket,
        });
        evidence.push(EvidenceRequirementStatus {
            requirement: EvidenceRequirement {
                kind: EvidenceType::TestReport,
                description: "fitness evidence attached".to_string(),
                required: true,
            },
            satisfied: has_eval,
        });
        evidence.push(EvidenceRequirementStatus {
            requirement: EvidenceRequirement {
                kind: EvidenceType::CoverageReport,
                description: "coverage evidence attached".to_string(),
                required: true,
            },
            satisfied: has_coverage,
        });
    }

    if changed_files.iter().any(|path| path.contains("/api/")) {
        evidence.push(EvidenceRequirementStatus {
            requirement: EvidenceRequirement {
                kind: EvidenceType::ContractReport,
                description: "API contract verified".to_string(),
                required: true,
            },
            satisfied: cache
                .fitness_snapshot()
                .is_some_and(api_contract_dimension_passed),
        });
    }

    if matches!(
        policy_decision,
        PolicyDecisionKind::RequireApproval | PolicyDecisionKind::Deny
    ) {
        evidence.push(EvidenceRequirementStatus {
            requirement: EvidenceRequirement {
                kind: EvidenceType::HumanApproval,
                description: "operator approval recorded".to_string(),
                required: true,
            },
            satisfied: false,
        });
    }

    evidence
}

fn api_contract_dimension_passed(snapshot: &fitness::FitnessSnapshot) -> bool {
    snapshot
        .dimensions
        .iter()
        .find(|dim| dim.name.eq_ignore_ascii_case("api_contract"))
        .is_some_and(|dim| dim.hard_gate_failures.is_empty())
}

fn integrity_warning_for_run(
    state: &RuntimeState,
    run: &crate::state::SessionListItem,
    changed_files: &[String],
) -> Option<String> {
    if run.is_unknown_bucket {
        Some(format!(
            "{} dirty file(s) need ownership review",
            run.unknown_count.max(changed_files.len())
        ))
    } else if is_auggie_mcp_service_run(state, run) {
        Some("workspace MCP service".to_string())
    } else if run.is_synthetic_agent_run {
        Some("process detected without hook-backed session".to_string())
    } else if run.unknown_count > 0 {
        Some(format!(
            "{} file(s) lack confident attribution",
            run.unknown_count
        ))
    } else {
        None
    }
}

fn infer_workspace_state(
    cache: &AppCache,
    state: &RuntimeState,
    run: &crate::state::SessionListItem,
    changed_files: &[String],
    integrity_warning: Option<&String>,
) -> WorkspaceState {
    if integrity_warning.is_some() {
        return WorkspaceState::Dirty;
    }
    if !changed_files.is_empty() || run.touched_files_count > 0 || run.is_unknown_bucket {
        return WorkspaceState::Dirty;
    }
    if cache.fitness_snapshot().is_some_and(|snapshot| {
        !snapshot.hard_gate_blocked && !snapshot.score_blocked && state.file_items().is_empty()
    }) {
        WorkspaceState::Validated
    } else {
        WorkspaceState::Ready
    }
}

fn infer_block_reason(
    state: &RuntimeState,
    cache: &AppCache,
    run: &crate::state::SessionListItem,
    policy_decision: PolicyDecisionKind,
    evidence: &[EvidenceRequirementStatus],
) -> Option<String> {
    if run.is_unknown_bucket {
        return Some("ownership ambiguity".to_string());
    }
    if is_auggie_mcp_service_run(state, run) {
        return Some("background MCP service".to_string());
    }
    if matches!(policy_decision, PolicyDecisionKind::RequireApproval) {
        return Some("approval required".to_string());
    }
    if matches!(policy_decision, PolicyDecisionKind::Deny) {
        return Some("manual review required".to_string());
    }
    if let Some(snapshot) = cache.fitness_snapshot() {
        if snapshot.hard_gate_blocked {
            return Some("hard gate failure".to_string());
        }
        if snapshot.score_blocked {
            return Some("score threshold failed".to_string());
        }
    }
    evidence
        .iter()
        .find(|item| item.requirement.required && !item.satisfied)
        .map(|item| format!("missing {}", item.requirement.kind.as_str()))
}

fn infer_operator_state(
    state: &RuntimeState,
    cache: &AppCache,
    run: &crate::state::SessionListItem,
    block_reason: Option<&str>,
) -> String {
    if is_auggie_mcp_service_run(state, run) {
        return "service".to_string();
    }
    if run
        .last_event_name
        .as_deref()
        .is_some_and(|event| event.to_ascii_lowercase().contains("replay"))
    {
        return "replayed".to_string();
    }
    if block_reason.is_some_and(|reason| reason.contains("approval")) {
        return "awaiting_approval".to_string();
    }
    if cache
        .fitness_snapshot()
        .is_some_and(|snapshot| snapshot.hard_gate_blocked || snapshot.score_blocked)
    {
        return "failed".to_string();
    }
    if run.status == "active" {
        return "executing".to_string();
    }
    if run.is_synthetic_agent_run {
        return "observing".to_string();
    }
    if matches!(run.status.as_str(), "idle" | "stopped" | "ended") {
        return "evaluating".to_string();
    }
    "ready".to_string()
}

fn approval_label_for(
    policy_decision: PolicyDecisionKind,
    evidence: &[EvidenceRequirementStatus],
) -> String {
    if matches!(policy_decision, PolicyDecisionKind::RequireApproval) {
        "required".to_string()
    } else if evidence
        .iter()
        .any(|item| item.requirement.required && !item.satisfied)
    {
        "waiting_on_evidence".to_string()
    } else if matches!(policy_decision, PolicyDecisionKind::Deny) {
        "blocked".to_string()
    } else {
        "not_required".to_string()
    }
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

fn evidence_inline_summary(evidence: &[EvidenceRequirementStatus]) -> String {
    if evidence.is_empty() {
        return "none".to_string();
    }
    evidence
        .iter()
        .map(|item| {
            let status = if item.satisfied { "ok" } else { "missing" };
            format!("{status}:{}", item.requirement.kind.as_str())
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn effect_classes_summary(effect_classes: &[EffectClass]) -> String {
    effect_classes
        .iter()
        .map(EffectClass::as_str)
        .collect::<Vec<_>>()
        .join(",")
}

fn next_action_for(
    run: &crate::state::SessionListItem,
    policy_decision: PolicyDecisionKind,
    block_reason: Option<&str>,
) -> String {
    if matches!(policy_decision, PolicyDecisionKind::RequireApproval) {
        "grant approval or reduce effect scope".to_string()
    } else if block_reason.is_some_and(|reason| reason.contains("hard gate")) {
        "fix failing hard gates and rerun fast eval".to_string()
    } else if block_reason.is_some_and(|reason| reason.contains("score")) {
        "improve fitness score before continuing".to_string()
    } else if block_reason.is_some_and(|reason| reason.contains("coverage")) {
        "generate coverage evidence".to_string()
    } else if run.is_synthetic_agent_run {
        "attach hooks or keep observing unmanaged run".to_string()
    } else if run.is_unknown_bucket {
        "resolve file ownership before continuing".to_string()
    } else {
        "handoff to reviewer or continue execution".to_string()
    }
}

fn handoff_summary_for(
    role: Role,
    operator_state: &str,
    block_reason: Option<&str>,
) -> Option<String> {
    let next_role = if block_reason.is_some() || operator_state == "failed" {
        Some(Role::Fixer)
    } else if matches!(operator_state, "evaluating" | "ready") {
        Some(Role::Reviewer)
    } else if role == Role::Planner && operator_state == "executing" {
        Some(Role::Builder)
    } else {
        None
    }?;

    if next_role.as_str() == role.as_str() {
        None
    } else {
        Some(format!(
            "handoff {} -> {}",
            role.as_str(),
            next_role.as_str()
        ))
    }
}

fn render_agent_rows(state: &RuntimeState, colors: UiPalette) -> Vec<Line<'static>> {
    if state.detected_agents.is_empty() {
        return vec![Line::from(Span::styled(
            "no repo-local agents detected",
            Style::default().fg(colors.muted),
        ))];
    }

    state
        .detected_agents
        .iter()
        .flat_map(|agent| {
            let status_color = if agent.status == "ACTIVE" {
                ACTIVE
            } else {
                IDLE
            };
            [
                Line::from(vec![
                    Span::styled(
                        pad_left(&agent.pid.to_string(), 5),
                        Style::default().fg(colors.muted),
                    ),
                    Span::raw(" "),
                    Span::styled(
                        format!("{} {}", agent.icon, agent.name),
                        Style::default()
                            .fg(colors.accent)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw("  "),
                    Span::styled(agent.status.clone(), Style::default().fg(status_color)),
                ]),
                Line::from(vec![
                    Span::styled("cpu ", Style::default().fg(colors.muted)),
                    Span::styled(
                        format!("{:>4.1}%", agent.cpu_percent),
                        Style::default().fg(status_color),
                    ),
                    Span::raw("  "),
                    Span::styled("mem ", Style::default().fg(colors.muted)),
                    Span::styled(
                        format!("{:.0}MB", agent.mem_mb),
                        Style::default().fg(colors.text),
                    ),
                    Span::raw("  "),
                    Span::styled("up ", Style::default().fg(colors.muted)),
                    Span::styled(
                        crate::detect::format_uptime(agent.uptime_seconds),
                        Style::default().fg(colors.text),
                    ),
                ]),
                Line::from(vec![
                    Span::styled("proj ", Style::default().fg(colors.muted)),
                    Span::styled(
                        shorten_path(&agent.project, 10),
                        Style::default().fg(colors.text),
                    ),
                    Span::raw("  "),
                    Span::styled("conf ", Style::default().fg(colors.muted)),
                    Span::styled(
                        format!("{}%", agent.confidence),
                        Style::default().fg(INFERRED),
                    ),
                ]),
                Line::from(""),
            ]
        })
        .collect()
}

fn render_title_bar(frame: &mut Frame, area: Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let dirty = state.file_items().len();
    let unknown = state
        .file_items()
        .into_iter()
        .filter(|file| {
            file.conflicted
                || matches!(
                    file.confidence,
                    crate::models::AttributionConfidence::Unknown
                )
                || file.last_session_id.is_none()
        })
        .count();
    let line = Line::from(vec![
        Span::styled(
            " Harness Monitor ",
            Style::default()
                .fg(colors.text)
                .bg(colors.accent)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("  repo:{}  branch:{}  ", state.repo_name, state.branch),
            Style::default().fg(colors.text).bg(colors.surface),
        ),
        Span::styled(
            format!(
                "agents:{} active:{}  ",
                state.agent_stats.total, state.agent_stats.active
            ),
            Style::default().fg(colors.text).bg(colors.surface),
        ),
        Span::styled(
            format!("dirty:{}  unknown:{}  ", dirty, unknown),
            Style::default().fg(colors.text).bg(colors.surface),
        ),
        Span::styled(
            format!("synced {} ago  ", time_ago(state.last_refresh_at_ms)),
            Style::default().fg(colors.muted).bg(colors.surface),
        ),
    ]);
    frame.render_widget(
        Paragraph::new(line).style(Style::default().bg(colors.surface)),
        area,
    );
}

fn panel_block<T: Into<ratatui::text::Line<'static>>>(
    title: T,
    focused: bool,
    colors: UiPalette,
) -> Block<'static> {
    Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(panel_border_style(focused, colors))
        .style(Style::default().bg(colors.surface).fg(colors.text))
}

fn panel_border_style(active: bool, colors: UiPalette) -> Style {
    if active {
        Style::default()
            .fg(colors.accent)
            .bg(colors.surface)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(colors.border)
    }
}

fn row_style(selected: bool, focused: bool, colors: UiPalette) -> Style {
    if selected {
        Style::default()
            .fg(colors.text)
            .bg(if focused {
                colors.selection_focus
            } else {
                colors.selection_blur
            })
            .add_modifier(if focused {
                Modifier::BOLD
            } else {
                Modifier::empty()
            })
    } else {
        Style::default().fg(colors.text).bg(colors.surface)
    }
}

fn format_ts(timestamp_ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(timestamp_ms)
        .map(|dt| dt.format("%H:%M:%S").to_string())
        .unwrap_or_else(|| "--:--:--".to_string())
}

pub(super) fn time_ago(timestamp_ms: i64) -> String {
    let delta = (chrono::Utc::now().timestamp_millis() - timestamp_ms).max(0) / 1000;
    if delta < 60 {
        "<1m".to_string()
    } else if delta < 3600 {
        format!("{}m", delta / 60)
    } else if delta < 86_400 {
        format!("{}h", delta / 3600)
    } else {
        format!("{}d", delta / 86_400)
    }
}

fn render_file_secondary_line(
    file: &crate::models::FileView,
    diff_stat: &DiffStatSummary,
    colors: UiPalette,
) -> Line<'static> {
    let age = pad_left(&time_ago(file.last_modified_at_ms), 5);
    let mut spans = render_diff_stat_spans(diff_stat);
    spans.push(Span::raw(" "));
    spans.push(Span::styled(age, Style::default().fg(colors.muted)));
    if file.conflicted {
        spans.push(Span::raw("  "));
        spans.push(Span::styled("CONFLICT", Style::default().fg(STOPPED)));
    }
    Line::from(spans)
}

fn render_file_meta_line(
    file: &crate::models::FileView,
    parent_dir: &str,
    diff_stat: &DiffStatSummary,
    colors: UiPalette,
) -> Line<'static> {
    let mut spans = Vec::new();
    spans.push(Span::styled(
        format!("  {}", shorten_path(parent_dir, 16)),
        Style::default().fg(colors.muted),
    ));
    spans.push(Span::styled("  ", Style::default().fg(colors.muted)));
    spans.extend(render_file_secondary_line(file, diff_stat, colors).spans);
    Line::from(spans)
}

fn render_file_single_line(
    selected: bool,
    file_name: &str,
    file: &crate::models::FileView,
    diff_stat: &DiffStatSummary,
    colors: UiPalette,
    focused: bool,
    area_width: usize,
) -> Line<'static> {
    let (_, parent_dir) = split_display_path(file);
    let folder_label = compact_folder_label(&parent_dir);
    let folder_width = if folder_label == "/" {
        0
    } else {
        area_width.saturating_sub(40).clamp(8, 14)
    };
    let name_width = area_width.saturating_sub(25 + folder_width).clamp(20, 52);
    let mut spans = vec![Span::styled(
        format!(
            "{} {}",
            if selected { ">" } else { " " },
            pad_right(&shorten_path(file_name, name_width), name_width + 1)
        ),
        row_style(selected, focused, colors).add_modifier(Modifier::BOLD),
    )];
    if folder_width > 0 {
        spans.push(Span::styled(
            pad_right(
                &format!("{}/", shorten_path(&folder_label, folder_width)),
                folder_width + 2,
            ),
            Style::default().fg(colors.muted),
        ));
        spans.push(Span::raw(" "));
    }
    spans.extend(render_file_secondary_line(file, diff_stat, colors).spans);
    Line::from(spans)
}

fn render_event_line(entry: &crate::models::EventLogEntry, colors: UiPalette) -> Line<'static> {
    let (action, subject) = split_event_message(&entry.message);
    Line::from(vec![
        Span::styled(
            format_ts(entry.observed_at_ms),
            Style::default().fg(colors.muted),
        ),
        Span::raw("  "),
        Span::styled(
            pad_right(&entry.source.label().to_ascii_uppercase(), 6),
            Style::default()
                .fg(source_color(entry.source))
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" "),
        Span::styled(pad_right(&action, 8), Style::default().fg(colors.accent)),
        Span::raw(" "),
        Span::styled(subject, Style::default().fg(colors.text)),
    ])
}

fn split_event_message(message: &str) -> (String, String) {
    let mut parts = message.split_whitespace();
    let first = parts.next().unwrap_or("-");
    let second = parts.next().unwrap_or("-");
    let rest = parts.collect::<Vec<_>>().join(" ");
    if first == "watch" || first == "git" {
        (second.to_string(), rest)
    } else {
        (
            first.to_string(),
            [second, rest.as_str()].join(" ").trim().to_string(),
        )
    }
}

fn file_window_start(total: usize, selected: usize, page_size: usize) -> usize {
    if total <= page_size {
        return 0;
    }
    let centered = selected.saturating_sub(page_size / 2);
    centered.min(total.saturating_sub(page_size))
}

fn split_display_path(file: &crate::models::FileView) -> (String, String) {
    let path = Path::new(&file.rel_path);
    let mut file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    if file.entry_kind.is_directory() && !file_name.ends_with('/') {
        file_name.push('/');
    }
    let parent = path
        .parent()
        .map(|parent| {
            let value = parent.to_string_lossy().to_string();
            if value == "." || value.is_empty() {
                "/".to_string()
            } else {
                value
            }
        })
        .unwrap_or_else(|| "/".to_string());
    (file_name, parent)
}

fn compact_folder_label(parent_dir: &str) -> String {
    if parent_dir == "/" {
        return "/".to_string();
    }
    Path::new(parent_dir)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| parent_dir.to_string())
}

fn pad_right(value: &str, width: usize) -> String {
    format!("{value:<width$}")
}

fn pad_left(value: &str, width: usize) -> String {
    format!("{value:>width$}")
}

fn format_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    if bytes as f64 >= MB {
        format!("{:.1} MB", bytes as f64 / MB)
    } else if bytes as f64 >= KB {
        format!("{:.1} KB", bytes as f64 / KB)
    } else {
        format!("{bytes} B")
    }
}

pub(super) fn render_diff_stat_spans(diff_stat: &DiffStatSummary) -> Vec<Span<'static>> {
    let mut spans = vec![Span::styled(
        pad_right(&diff_stat.status, 2),
        Style::default()
            .fg(change_color_from_status(diff_stat.status.as_str()))
            .add_modifier(Modifier::BOLD),
    )];
    if let Some(add) = diff_stat.additions {
        spans.push(Span::raw(" "));
        spans.push(Span::styled(format!("+{add}"), Style::default().fg(ACTIVE)));
    }
    if let Some(del) = diff_stat.deletions {
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            format!("-{del}"),
            Style::default().fg(STOPPED),
        ));
    }
    spans.push(Span::styled(
        pad_right(
            "",
            9usize.saturating_sub(diff_stat_display_width(diff_stat)),
        ),
        Style::default(),
    ));
    spans
}

fn diff_stat_display_width(diff_stat: &DiffStatSummary) -> usize {
    let mut width = diff_stat.status.len();
    if let Some(add) = diff_stat.additions {
        width += 1 + format!("+{add}").len();
    }
    if let Some(del) = diff_stat.deletions {
        width += 1 + format!("-{del}").len();
    }
    width
}

fn change_color_from_status(status: &str) -> Color {
    match status {
        "D" => STOPPED,
        "A" => ACTIVE,
        "DIR" => Color::Rgb(126, 156, 181),
        _ => INFERRED,
    }
}

fn source_color(source: crate::models::EventSource) -> Color {
    match source {
        crate::models::EventSource::Hook => Color::Rgb(126, 156, 181),
        crate::models::EventSource::Git => INFERRED,
        crate::models::EventSource::Watch => ACTIVE,
        crate::models::EventSource::Attribution => Color::Rgb(188, 162, 104),
        crate::models::EventSource::Fitness => Color::Rgb(91, 192, 190),
    }
}

fn shorten_path(path: &str, max_len: usize) -> String {
    if path.len() <= max_len {
        return path.to_string();
    }
    let keep = max_len.saturating_sub(3);
    format!("...{}", &path[path.len().saturating_sub(keep)..])
}

#[cfg(test)]
#[path = "tui_render_tests.rs"]
mod tests;
