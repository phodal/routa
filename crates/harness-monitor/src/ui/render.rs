use super::fitness;
use super::run_details::{
    display_run_origin_label, display_run_status_label, run_status_color, semantic_run_status,
};
use super::*;
use crate::ui::state::FocusPane;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph, Wrap};
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
    pub(super) bg: Color,
    pub(super) surface: Color,
    pub(super) border: Color,
    pub(super) text: Color,
    pub(super) muted: Color,
    pub(super) accent: Color,
    pub(super) selection_focus: Color,
    pub(super) selection_blur: Color,
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

    render_title_bar(frame, outer[0], state, cache);
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
        let rows = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Percentage(58), Constraint::Percentage(42)])
            .split(area);
        let top = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(70), Constraint::Percentage(30)])
            .split(rows[0]);
        let bottom = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(70), Constraint::Percentage(30)])
            .split(rows[1]);
        render_files(frame, top[0], state, cache, FileRowDensity::TwoLine);
        render_preview_panel(frame, top[1], state, cache);
        render_fitness_panel(frame, bottom[0], state, cache);
        render_details_panel(frame, bottom[1], state, cache);
        return;
    }

    if layout_mode == LayoutMode::Medium {
        let rows = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Percentage(60), Constraint::Percentage(40)])
            .split(area);
        let top = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(72), Constraint::Percentage(28)])
            .split(rows[0]);
        let bottom = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(72), Constraint::Percentage(28)])
            .split(rows[1]);
        render_files(frame, top[0], state, cache, FileRowDensity::SingleLine);
        render_preview_panel(frame, top[1], state, cache);
        render_fitness_panel(frame, bottom[0], state, cache);
        render_details_panel(frame, bottom[1], state, cache);
        return;
    }

    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Length(((area.width as usize * 24) / 100).clamp(36, 44) as u16),
            Constraint::Min(64),
            Constraint::Length(((area.width as usize * 28) / 100).clamp(42, 56) as u16),
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
    // Left column: Runs pane plus prompt-bounded Sessions for the selected run.
    let left_split = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(60), Constraint::Percentage(40)])
        .split(columns[0]);
    render_runs_panel(frame, left_split[0], state, cache);
    render_sessions_panel(frame, left_split[1], state);
    render_files(frame, center[0], state, cache, FileRowDensity::SingleLine);
    render_details_panel(frame, center[1], state, cache);
    render_preview_panel(frame, right[0], state, cache);
    render_fitness_panel(frame, right[1], state, cache);
}

fn render_fitness_panel(frame: &mut Frame, area: Rect, state: &RuntimeState, cache: &AppCache) {
    let colors = palette(state.theme_mode);

    // Build title with score if available
    let title = if let Some(snapshot) = cache.fitness_snapshot() {
        let score = snapshot.final_score;
        let status = if snapshot.hard_gate_blocked {
            "BLOCKED(hard gate)"
        } else if snapshot.score_blocked {
            "BLOCKED(score)"
        } else {
            "PASS"
        };
        format!(
            "Fitness ({}) - {} {:.1}% ({}/{}) {}ms",
            state.fitness_view_mode.label(),
            status,
            score,
            fitness::passed_metric_count(snapshot),
            snapshot.metric_count,
            snapshot.duration_ms.round() as u64
        )
    } else {
        format!("Fitness ({})", state.fitness_view_mode.label())
    };

    let block = panel_block(title, state.focus == FocusPane::Fitness, colors);
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
        let compact_height = inner.height <= 8;
        let medium_height = inner.height <= 13;

        // Combine last run and coverage info on one line
        if let Some(last_run_ms) = cache.fitness_last_run_ms() {
            let mut line_spans = vec![
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
            ];

            // Add coverage updated timestamp if available
            if let Some(coverage_generated_at_ms) = snapshot.coverage_summary.generated_at_ms {
                line_spans.push(Span::raw("  "));
                line_spans.push(Span::styled(
                    "coverage updated: ",
                    Style::default().fg(colors.muted),
                ));
                line_spans.push(Span::styled(
                    format_ts(coverage_generated_at_ms),
                    Style::default().fg(colors.text),
                ));
            }

            lines.push(Line::from(line_spans));
        }
        if !snapshot.changed_files_preview.is_empty() && !compact_height {
            lines.push(Line::from(vec![
                Span::styled("Files: ", Style::default().fg(colors.muted)),
                Span::styled(
                    snapshot.changed_files_preview.join(", "),
                    Style::default().fg(colors.text),
                ),
            ]));
        }
        if !compact_height && !snapshot.failing_metrics.is_empty() {
            lines.push(Line::from(vec![Span::styled(
                "Failures:",
                Style::default()
                    .fg(colors.text)
                    .add_modifier(Modifier::BOLD),
            )]));
            let failing_limit = if medium_height { 2 } else { 3 };
            for metric in snapshot.failing_metrics.iter().take(failing_limit) {
                let mut row = vec![
                    Span::styled(
                        format!("[{}]", metric.state),
                        Style::default().fg(metric_color(metric)),
                    ),
                    Span::raw(" "),
                    Span::styled(metric.name.clone(), Style::default().fg(colors.text)),
                ];
                if metric.hard_gate {
                    row.push(Span::raw(" "));
                    row.push(Span::styled("hard-gate", Style::default().fg(STOPPED)));
                }
                row.push(Span::raw(" "));
                row.push(Span::styled(
                    format!("{:.1}ms", metric.duration_ms),
                    Style::default().fg(colors.muted),
                ));
                lines.push(Line::from(row));
                if let Some(excerpt) = &metric.output_excerpt {
                    lines.push(Line::from(vec![
                        Span::styled("  > ", Style::default().fg(colors.muted)),
                        Span::styled(excerpt.clone(), Style::default().fg(colors.muted)),
                    ]));
                }
            }
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
            let failure_count = dimension_failure_count(dim);
            let warning = if failure_count == 0 {
                String::new()
            } else if dim.name.eq_ignore_ascii_case("code_quality") {
                format!(
                    "  !{} failure{}",
                    failure_count,
                    if failure_count == 1 { "" } else { "s" }
                )
            } else if !dim.hard_gate_failures.is_empty() {
                format!("  !{}", dim.hard_gate_failures.join(","))
            } else {
                format!(
                    "  !{} metric{} failed",
                    failure_count,
                    if failure_count == 1 { "" } else { "s" }
                )
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
            let trend = cache.fitness_trend();
            if !snapshot.hard_gate_blocked && !snapshot.score_blocked && trend.len() >= 2 {
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

fn dimension_failure_count(dimension: &fitness::FitnessDimensionSummary) -> usize {
    dimension
        .metrics
        .iter()
        .filter(|metric| !metric.passed)
        .count()
}

fn truncate_short(value: &str, max_len: usize) -> String {
    if value.chars().count() <= max_len {
        value.to_string()
    } else {
        let keep = max_len.saturating_sub(3);
        let truncated = value.chars().take(keep).collect::<String>();
        format!("{truncated}...")
    }
}

fn render_sessions_panel(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let focused = state.focus == FocusPane::Sessions;
    let title = if focused {
        "Sessions [Tab]"
    } else {
        "Sessions"
    };
    let outer_block = panel_block(title, focused, colors);
    let inner = outer_block.inner(area);
    frame.render_widget(outer_block, area);
    let split = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(2), Constraint::Min(6)])
        .split(inner);
    let items = state.prompt_sessions();
    let prompt_count = items
        .iter()
        .filter(|item| !item.is_all_prompt_bucket)
        .count();
    let source_label = state
        .selected_run_item()
        .map(|run| run.client.as_str())
        .unwrap_or("unknown");
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                format!(
                    " {} prompt{}",
                    prompt_count,
                    if prompt_count == 1 { "" } else { "s" }
                ),
                Style::default().fg(if prompt_count > 0 {
                    ACTIVE
                } else {
                    colors.muted
                }),
            ),
            Span::styled("  source:", Style::default().fg(colors.muted)),
            Span::styled(source_label, Style::default().fg(colors.accent)),
        ]))
        .style(Style::default().bg(colors.surface).fg(colors.text)),
        split[0],
    );
    if items.is_empty() {
        frame.render_widget(
            Paragraph::new(vec![Line::from(Span::styled(
                "no prompt sessions for selected run",
                Style::default().fg(colors.muted),
            ))])
            .style(Style::default().bg(colors.surface).fg(colors.text))
            .wrap(Wrap { trim: true }),
            split[1],
        );
        return;
    }

    let visible_items = (split[1].height as usize / 2).max(1);
    let start = file_window_start(items.len(), state.selected_prompt_session, visible_items);
    let end = (start + visible_items).min(items.len());
    let list_items: Vec<ListItem> = items[start..end]
        .iter()
        .enumerate()
        .map(|(idx, item)| {
            let absolute_idx = start + idx;
            let selected = absolute_idx == state.selected_prompt_session;
            let bg = if selected {
                if focused {
                    colors.selection_focus
                } else {
                    colors.selection_blur
                }
            } else {
                colors.surface
            };
            let primary = Line::from(vec![
                Span::styled(
                    if selected { "▶ " } else { "  " },
                    Style::default().fg(colors.accent).bg(bg),
                ),
                Span::styled(
                    pad_right(
                        &shorten_path(
                            item.primary_label(),
                            split[1].width.saturating_sub(10) as usize,
                        ),
                        split[1].width.saturating_sub(10) as usize,
                    ),
                    Style::default()
                        .fg(colors.text)
                        .bg(bg)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!("  {}", pad_left(&time_ago(item.updated_at_ms), 4)),
                    Style::default().fg(colors.muted).bg(bg),
                ),
            ]);
            let mut secondary_text = format!(
                "  {}  {}  files:{}",
                item.client, item.status, item.changed_files_count
            );
            if item.recovered_from_transcript {
                secondary_text.push_str("  recovered");
            }
            if let Some(summary) = item.recent_git_summary.as_deref() {
                secondary_text.push_str("  ");
                secondary_text.push_str(summary);
            }
            let secondary = Line::from(Span::styled(
                shorten_path(&secondary_text, split[1].width.saturating_sub(2) as usize),
                Style::default().fg(colors.muted).bg(bg),
            ));
            ListItem::new(vec![primary, secondary]).style(row_style(selected, focused, colors))
        })
        .collect();
    frame.render_widget(
        List::new(list_items).block(
            Block::default()
                .borders(Borders::TOP)
                .border_style(Style::default().fg(colors.border))
                .style(Style::default().bg(colors.surface)),
        ),
        split[1],
    );
}

/// Renders the Runs pane — presents active sessions through the Run/Task vocabulary.
///
/// In Phase 0 every session is an **unmanaged run**. The pane shows role,
/// mode, client, file attribution summary, and eval-readiness. When managed
/// mode is implemented (Phase 3) this will also show managed runs.
fn render_runs_panel(
    frame: &mut Frame,
    area: ratatui::layout::Rect,
    state: &RuntimeState,
    cache: &AppCache,
) {
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

    let visible_runs = sessions
        .iter()
        .filter(|session| !session.is_all_runs_bucket)
        .collect::<Vec<_>>();
    let active_runs = visible_runs
        .iter()
        .filter(|session| {
            let model = build_run_operator_model(state, cache, session);
            semantic_run_status(session, &model) == "active"
        })
        .count();
    let summary_line = Line::from(vec![
        Span::styled(
            format!(" {active_runs} active"),
            Style::default().fg(if active_runs > 0 {
                ACTIVE
            } else {
                colors.muted
            }),
        ),
        Span::styled(
            format!("  {} total", visible_runs.len()),
            Style::default().fg(colors.text),
        ),
        Span::styled(
            format!("  {worktrees} worktree(s)"),
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
        Span::styled(" recent first", Style::default().fg(colors.muted)),
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

            let model = build_run_operator_model(state, cache, session);
            let semantic_status = semantic_run_status(session, &model);
            let status_label = display_run_status_label(semantic_status);
            let origin_label = display_run_origin_label(model.origin);
            let client_label = if session.is_unknown_bucket {
                "unassigned"
            } else {
                session.client.as_str()
            };
            let icon = if session.is_all_runs_bucket {
                "="
            } else {
                crate::shared::models::HookClient::from_str(&session.client).icon()
            };
            let run_name = session.primary_label().to_string();
            let session_label = if session.has_task_context() {
                shorten_path(&session.session_id, 14)
            } else {
                String::new()
            };
            let status_width = status_label.chars().count().max(8);
            let reserved_width = 10usize + status_width + 3;
            let run_label_width =
                split[1].width.saturating_sub(reserved_width as u16).max(12) as usize;
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
                    format!("  {}", pad_left(&status_label, status_width)),
                    Style::default()
                        .fg(run_status_color(semantic_status))
                        .bg(bg)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!("  {}", pad_left(&time_ago(session.last_seen_at_ms), 4)),
                    Style::default().fg(colors.muted).bg(bg),
                ),
            ]);
            let secondary = Line::from(vec![
                Span::styled(
                    format!(
                        "  {}  {}  {}  files:{}  e/i/?:{}/{}/{}{}",
                        model.role.as_str(),
                        origin_label,
                        client_label,
                        session.touched_files_count,
                        session.exact_count,
                        session.inferred_count,
                        session.unknown_count,
                        if session.recovered_from_transcript && semantic_status != "recovered" {
                            "  recovered"
                        } else {
                            ""
                        }
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
                if !session_label.is_empty() {
                    Span::styled(
                        format!("  {session_label}"),
                        Style::default().fg(colors.muted).bg(bg),
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
    let panel_title = if state.has_selected_prompt_scope() {
        "Change Status"
    } else {
        "Git Status"
    };
    let outer_block = panel_block(
        render_file_panel_title(state, cache, panel_title, area.width, colors),
        state.focus == FocusPane::Files,
        colors,
    );
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
            let review_hint = cache.review_hint(file);
            let test_mapping = cache.test_mapping(file);
            let changed_test_file = cache.is_changed_test_file(file);
            let display_path = display_file_path(state, file);
            let rows = match density {
                FileRowDensity::SingleLine => vec![render_file_single_line(
                    selected,
                    &display_path,
                    file,
                    &diff_stat,
                    review_hint.as_ref(),
                    test_mapping,
                    changed_test_file,
                    colors,
                    state.focus == FocusPane::Files,
                    split[1].width as usize,
                )],
                FileRowDensity::TwoLine => {
                    if file.entry_kind.is_submodule() {
                        vec![render_file_single_line(
                            selected,
                            &display_path,
                            file,
                            &diff_stat,
                            review_hint.as_ref(),
                            test_mapping,
                            changed_test_file,
                            colors,
                            state.focus == FocusPane::Files,
                            split[1].width as usize,
                        )]
                    } else {
                        let primary = Line::from(vec![Span::styled(
                            format!(
                                "{} {}",
                                if selected { ">" } else { " " },
                                compact_rel_path(
                                    &display_path,
                                    split[1].width.saturating_sub(6) as usize
                                )
                            ),
                            row_style(selected, state.focus == FocusPane::Files, colors)
                                .add_modifier(Modifier::BOLD),
                        )]);
                        let secondary = render_file_meta_line(
                            file,
                            &diff_stat,
                            review_hint.as_ref(),
                            test_mapping,
                            changed_test_file,
                            colors,
                        );
                        vec![primary, secondary]
                    }
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

pub(super) fn render_file_panel_title(
    state: &RuntimeState,
    cache: &AppCache,
    label: &str,
    area_width: u16,
    colors: UiPalette,
) -> Line<'static> {
    let mut spans = vec![Span::styled(
        label.to_string(),
        Style::default().fg(colors.muted),
    )];
    if area_width < 28 {
        return Line::from(spans);
    }

    let (additions, deletions, has_diff_data) = aggregate_visible_diff_stats(state, cache);
    if !has_diff_data && state.committed_change_summary.is_none() {
        return Line::from(spans);
    }

    if has_diff_data {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(
            format!("+{additions}"),
            Style::default().fg(ACTIVE).add_modifier(Modifier::BOLD),
        ));
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            format!("-{deletions}"),
            Style::default().fg(STOPPED).add_modifier(Modifier::BOLD),
        ));
    }
    if let Some((total_additions, total_deletions)) = state.committed_change_summary {
        spans.push(Span::raw(" "));
        spans.push(Span::styled("(Total:", Style::default().fg(colors.muted)));
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            format!("+{total_additions}"),
            Style::default().fg(ACTIVE).add_modifier(Modifier::BOLD),
        ));
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            format!("-{total_deletions}"),
            Style::default().fg(STOPPED).add_modifier(Modifier::BOLD),
        ));
        spans.push(Span::styled(")", Style::default().fg(colors.muted)));
    }
    Line::from(spans)
}

fn aggregate_visible_diff_stats(state: &RuntimeState, cache: &AppCache) -> (usize, usize, bool) {
    let mut additions = 0usize;
    let mut deletions = 0usize;
    let mut has_diff_data = false;

    for file in state.file_items() {
        if let Some(diff_stat) = cache.diff_stat(file) {
            if let Some(add) = diff_stat.additions {
                additions += add;
                has_diff_data = true;
            }
            if let Some(del) = diff_stat.deletions {
                deletions += del;
                has_diff_data = true;
            }
        }
    }

    (additions, deletions, has_diff_data)
}

pub(super) fn panel_block<T: Into<ratatui::text::Line<'static>>>(
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

#[allow(clippy::too_many_arguments)]
fn render_file_single_line(
    selected: bool,
    display_path: &str,
    file: &crate::shared::models::FileView,
    diff_stat: &DiffStatSummary,
    review_hint: Option<&crate::ui::tui::review::ReviewHint>,
    test_mapping: Option<&TestMappingEntry>,
    changed_test_file: bool,
    colors: UiPalette,
    focused: bool,
    area_width: usize,
) -> Line<'static> {
    let meta = build_file_meta_segments(
        file,
        diff_stat,
        review_hint,
        test_mapping,
        changed_test_file,
        colors,
        area_width,
    );
    let prefix_width = 2usize;
    let gap_width = usize::from(!meta.is_empty());
    let available_for_path = area_width
        .saturating_sub(prefix_width + gap_width + meta.display_width)
        .max(1);
    let path_text = compact_rel_path(display_path, available_for_path);
    let selector = if selected { ">" } else { " " };
    let path_span = if meta.is_empty() {
        format!("{selector} {path_text}")
    } else {
        format!(
            "{selector} {}",
            pad_right(&path_text, available_for_path + 1)
        )
    };
    let mut spans = vec![Span::styled(
        path_span,
        row_style(selected, focused, colors).add_modifier(Modifier::BOLD),
    )];
    spans.extend(meta.spans);
    Line::from(spans)
}

pub(super) fn render_event_line(
    entry: &crate::shared::models::EventLogEntry,
    colors: UiPalette,
) -> Line<'static> {
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

fn display_file_path(state: &RuntimeState, file: &crate::shared::models::FileView) -> String {
    let mut rel_path = file.rel_path.clone();
    if file.entry_kind.is_container() && !rel_path.ends_with('/') {
        rel_path.push('/');
    }
    if file.entry_kind.is_submodule() {
        return rel_path;
    }
    if nearest_submodule_parent_path(state, file).is_some() {
        return format!("  {rel_path}");
    }
    rel_path
}

fn nearest_submodule_parent_path(
    state: &RuntimeState,
    file: &crate::shared::models::FileView,
) -> Option<String> {
    let mut current = Path::new(&file.rel_path).parent();
    while let Some(parent) = current {
        let key = parent.to_string_lossy().replace('\\', "/");
        if state
            .files
            .get(&key)
            .is_some_and(|candidate| candidate.entry_kind.is_submodule())
        {
            return Some(key);
        }
        current = parent.parent();
    }
    None
}

fn pad_right(value: &str, width: usize) -> String {
    format!("{value:<width$}")
}

fn pad_left(value: &str, width: usize) -> String {
    format!("{value:>width$}")
}

pub(super) fn format_bytes(bytes: u64) -> String {
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

fn source_color(source: crate::shared::models::EventSource) -> Color {
    match source {
        crate::shared::models::EventSource::Hook => Color::Rgb(126, 156, 181),
        crate::shared::models::EventSource::Git => INFERRED,
        crate::shared::models::EventSource::Watch => ACTIVE,
        crate::shared::models::EventSource::Attribution => Color::Rgb(188, 162, 104),
        crate::shared::models::EventSource::Fitness => Color::Rgb(91, 192, 190),
    }
}
