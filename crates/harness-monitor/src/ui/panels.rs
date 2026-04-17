use super::*;
use crate::shared::models::FileView;
use crate::ui::state::{FitnessViewMode, FocusPane, PromptSessionListItem};
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Clear, List, ListItem, Paragraph, Wrap};

pub(super) fn render_details_panel(
    frame: &mut Frame,
    area: Rect,
    state: &RuntimeState,
    cache: &mut AppCache,
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
    if state.focus == FocusPane::Sessions {
        let block = panel_block("Session Detail", false, colors);
        let lines = render_prompt_session_details(state, cache, area.width, colors);
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
                    facts
                        .git_change_count
                        .map(|count| count.to_string())
                        .unwrap_or_else(|| "...".to_string()),
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
            if let Some(analysis_mode) = cache.test_mapping_analysis_mode() {
                let mut row = vec![
                    Span::styled("Analysis: ", Style::default().fg(colors.muted)),
                    Span::styled(analysis_mode.label(), Style::default().fg(colors.text)),
                ];
                if cache.test_mapping_graph_enrichment_pending() {
                    row.push(Span::raw("  "));
                    row.push(Span::styled(
                        "graph refresh pending",
                        Style::default().fg(colors.muted),
                    ));
                }
                lines.push(Line::from(row));
            }
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
    if let Some(item) = state
        .selected_prompt_session_item()
        .filter(|item| !item.is_all_prompt_bucket && item.task_id.is_some())
    {
        return render_change_header_line(state, cache, width, item, colors);
    }
    let available_width = width.saturating_sub(2) as usize;
    let files = state.file_items();
    let untracked = files
        .iter()
        .filter(|file| file.state_code == "untracked")
        .count();
    let workspace_agents = state.selected_workspace_agent_count();
    let worktree_total = state
        .worktree_count
        .map(|count| count.to_string())
        .unwrap_or_else(|| "...".to_string());
    let summary = format!(
        "{}, {}, {}, {} agent{}, branch: {}, {}",
        pluralize(files.len(), "file"),
        count_label(untracked, "untracked"),
        pluralize_count_text(
            &state
                .ahead_count
                .map(|count| count.to_string())
                .unwrap_or_else(|| "...".to_string()),
            "commit",
        ),
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

fn render_change_header_line(
    state: &RuntimeState,
    cache: &AppCache,
    width: u16,
    item: &PromptSessionListItem,
    colors: UiPalette,
) -> Line<'static> {
    let available_width = width.saturating_sub(2) as usize;
    let files = state.file_items();
    let dirty = files
        .iter()
        .filter(|file| file.dirty || file.conflicted)
        .count();
    let committed = files.len().saturating_sub(dirty);
    let mut summary = format!(
        "{}, {}, {}, status: {}",
        pluralize(files.len(), "file"),
        count_label(dirty, "dirty"),
        count_label(committed, "committed"),
        item.status,
    );
    if item.recovered_from_transcript {
        summary.push_str(", recovered");
    }
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

    let prompt_label = truncate_header_text(
        item.primary_label(),
        available_width.saturating_div(3).max(12),
    );
    let prompt_width = 1 + prompt_label.chars().count();
    if used_width + prompt_width <= available_width {
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            prompt_label,
            Style::default().fg(colors.accent).bg(colors.surface),
        ));
        used_width += prompt_width;
    }

    let (missing, changed, inline) = scoped_test_counts(cache, &files);
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
        let color = if missing > 0 {
            STOPPED
        } else if changed > 0 || inline > 0 {
            ACTIVE
        } else {
            colors.muted
        };
        let test_text = format!("[tests:{}]", parts.join(" "));
        let extra_width = 1 + test_text.chars().count();
        if used_width + extra_width <= available_width {
            spans.push(Span::raw(" "));
            spans.push(Span::styled(
                test_text,
                Style::default().fg(color).bg(colors.surface),
            ));
            used_width += extra_width;
        }
    }

    if let Some(git_summary) = item.recent_git_summary.as_deref() {
        let git_text = format!("[{}]", truncate_header_text(git_summary, 28));
        let extra_width = 1 + git_text.chars().count();
        if used_width + extra_width <= available_width {
            spans.push(Span::raw(" "));
            spans.push(Span::styled(
                git_text,
                Style::default().fg(colors.muted).bg(colors.surface),
            ));
        }
    }

    Line::from(spans)
}

fn scoped_test_counts(cache: &AppCache, files: &[&FileView]) -> (usize, usize, usize) {
    let mut missing = 0;
    let mut changed = 0;
    let mut inline = 0;

    for file in files {
        if cache.is_changed_test_file(file) {
            changed += 1;
            continue;
        }

        if let Some(mapping) = cache.test_mapping(file) {
            match mapping.status.as_str() {
                "missing" => missing += 1,
                "changed" => changed += 1,
                "inline" => inline += 1,
                _ => {}
            }
            if mapping.has_inline_tests && mapping.status != "inline" {
                inline += 1;
            }
        }
    }

    (missing, changed, inline)
}

pub(super) fn render_footer(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let line = if area.width < 110 {
        Line::from(vec![
            Span::styled("Tab", Style::default().fg(colors.accent)),
            Span::styled(" panes  ", Style::default().fg(colors.muted)),
            Span::styled("↑↓", Style::default().fg(colors.accent)),
            Span::styled(" select  ", Style::default().fg(colors.muted)),
            Span::styled("d", Style::default().fg(colors.accent)),
            Span::styled(" preview  ", Style::default().fg(colors.muted)),
            Span::styled("Pg", Style::default().fg(colors.accent)),
            Span::styled(" scroll  ", Style::default().fg(colors.muted)),
            Span::styled("g", Style::default().fg(colors.accent)),
            Span::styled(" refresh all  ", Style::default().fg(colors.muted)),
            Span::styled("m", Style::default().fg(colors.accent)),
            Span::styled(" fast/full  ", Style::default().fg(colors.muted)),
            Span::styled("q", Style::default().fg(colors.accent)),
            Span::styled(" quit", Style::default().fg(colors.muted)),
        ])
    } else {
        Line::from(vec![
            Span::styled("Tab", Style::default().fg(colors.accent)),
            Span::styled(" panes  ", Style::default().fg(colors.muted)),
            Span::styled("↑↓", Style::default().fg(colors.accent)),
            Span::styled(" select  ", Style::default().fg(colors.muted)),
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
            Span::styled(" refresh all  ", Style::default().fg(colors.muted)),
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

fn render_prompt_session_details(
    state: &RuntimeState,
    cache: &mut AppCache,
    width: u16,
    colors: UiPalette,
) -> Vec<Line<'static>> {
    let Some(item) = state.selected_prompt_session_item() else {
        return vec![Line::from(Span::styled(
            "No session selected",
            Style::default().fg(colors.muted),
        ))];
    };

    if item.is_all_prompt_bucket {
        let files = state.file_items();
        let dirty = files
            .iter()
            .filter(|file| file.dirty || file.conflicted)
            .count();
        return vec![
            Line::from(Span::styled(
                "All prompts",
                Style::default()
                    .fg(colors.text)
                    .add_modifier(Modifier::BOLD),
            )),
            Line::from(vec![
                Span::styled("Scope: ", Style::default().fg(colors.muted)),
                Span::styled(
                    "aggregate prompt history",
                    Style::default().fg(colors.accent),
                ),
            ]),
            Line::from(vec![
                Span::styled("Files: ", Style::default().fg(colors.muted)),
                Span::styled(
                    format!("{} total / {} dirty", files.len(), dirty),
                    Style::default().fg(colors.text),
                ),
            ]),
        ];
    }

    let prompt_label = item.primary_label();
    let files = state.file_items();
    let dirty = files
        .iter()
        .filter(|file| file.dirty || file.conflicted)
        .count();
    let session = item
        .session_id
        .as_deref()
        .and_then(|session_id| state.sessions.get(session_id));
    let task = item
        .task_id
        .as_deref()
        .and_then(|task_id| state.tasks.get(task_id));
    let prompt_history = task
        .and_then(|task| task.transcript_path.as_deref())
        .or_else(|| session.and_then(|session| session.transcript_path.as_deref()))
        .map(|path| cache.transcript_prompt_history(path, 4))
        .unwrap_or_default();

    let mut lines = vec![
        Line::from(Span::styled(
            shorten_path(prompt_label, width.saturating_sub(4) as usize),
            Style::default()
                .fg(colors.text)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(vec![
            Span::styled(item.client.clone(), Style::default().fg(colors.accent)),
            Span::raw("  "),
            Span::styled(item.status.clone(), Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled(
                format!(
                    "{} file{}",
                    item.changed_files_count,
                    if item.changed_files_count == 1 {
                        ""
                    } else {
                        "s"
                    }
                ),
                Style::default().fg(colors.text),
            ),
            Span::raw("  "),
            Span::styled(
                format!("{dirty} dirty"),
                Style::default().fg(if dirty > 0 { INFERRED } else { ACTIVE }),
            ),
        ]),
    ];

    if let Some(source) = item.source.as_deref() {
        let mut meta = vec![
            Span::styled("Source: ", Style::default().fg(colors.muted)),
            Span::styled(source.to_string(), Style::default().fg(colors.text)),
        ];
        if let Some(model) = item.model.as_deref() {
            meta.push(Span::raw("  "));
            meta.push(Span::styled("Model: ", Style::default().fg(colors.muted)));
            meta.push(Span::styled(
                model.to_string(),
                Style::default().fg(colors.text),
            ));
        }
        lines.push(Line::from(meta));
    }

    if item.recovered_from_transcript {
        lines.push(Line::from(vec![
            Span::styled("Prompt: ", Style::default().fg(colors.muted)),
            Span::styled("recovered-from-transcript", Style::default().fg(INFERRED)),
        ]));
    }

    if let Some(summary) = item.recent_git_summary.as_deref() {
        lines.push(Line::from(vec![
            Span::styled("Git: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(summary, width.saturating_sub(11) as usize),
                Style::default().fg(colors.accent),
            ),
        ]));
    }

    if let Some(task) = task
        .filter(|task| !task.title.trim().is_empty() && task.title.trim() != prompt_label.trim())
    {
        lines.push(Line::from(vec![
            Span::styled("Task: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(&task.title, width.saturating_sub(12) as usize),
                Style::default().fg(colors.text),
            ),
        ]));
    }

    if let Some(session) = session {
        lines.push(Line::from(vec![
            Span::styled("Workspace: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(&session.cwd, width.saturating_sub(16) as usize),
                Style::default().fg(colors.text),
            ),
        ]));
    }

    if !prompt_history.is_empty() {
        let journey = prompt_history
            .iter()
            .rev()
            .cloned()
            .collect::<Vec<_>>()
            .join("  ->  ");
        lines.push(Line::from(vec![
            Span::styled("Journey: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(&journey, width.saturating_sub(14) as usize),
                Style::default().fg(colors.text),
            ),
        ]));

        let mut previous_prompts = prompt_history;
        if !previous_prompts.is_empty() {
            previous_prompts.pop();
        }
        if !previous_prompts.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("Recent: ", Style::default().fg(colors.muted)),
                Span::styled(
                    shorten_path(
                        &previous_prompts
                            .into_iter()
                            .rev()
                            .collect::<Vec<_>>()
                            .join("  |  "),
                        width.saturating_sub(12) as usize,
                    ),
                    Style::default().fg(colors.text),
                ),
            ]));
        }
    }

    lines
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
    let unattributed_label = format!("{} unassigned", unattributed.count());
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
        assert_eq!(run_status_color("observing"), IDLE);
        assert_eq!(run_status_color("blocked"), STOPPED);
    }
}
