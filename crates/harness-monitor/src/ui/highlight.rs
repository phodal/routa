use super::*;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span, Text};
use std::path::Path;
use syntect::easy::HighlightLines;
use syntect::highlighting::Style as SyntectStyle;
use syntect::util::LinesWithEndings;

pub(super) fn highlight_diff_text(
    file_path: Option<&str>,
    diff_text: &str,
    theme_mode: ThemeMode,
) -> Text<'static> {
    let syntax = syntax_for_path(file_path);
    let mut highlighter = HighlightLines::new(syntax, syntax_theme(theme_mode));
    let mut lines = Vec::new();
    for raw in diff_text.lines() {
        let line = if raw.starts_with("+++") || raw.starts_with("---") {
            Line::from(Span::styled(
                raw.to_string(),
                Style::default().fg(Color::Yellow),
            ))
        } else if raw.starts_with("@@") {
            Line::from(Span::styled(
                raw.to_string(),
                Style::default().fg(Color::Cyan),
            ))
        } else if let Some(rest) = raw.strip_prefix('+') {
            build_diff_code_line('+', rest, Color::Green, &mut highlighter, theme_mode)
        } else if let Some(rest) = raw.strip_prefix('-') {
            build_diff_code_line('-', rest, Color::Red, &mut highlighter, theme_mode)
        } else if let Some(rest) = raw.strip_prefix(' ') {
            build_diff_code_line(' ', rest, Color::DarkGray, &mut highlighter, theme_mode)
        } else if raw.starts_with("diff --git") || raw.starts_with("index ") {
            Line::from(Span::styled(
                raw.to_string(),
                Style::default().fg(Color::DarkGray),
            ))
        } else {
            Line::from(raw.to_string())
        };
        lines.push(line);
    }
    Text::from(lines)
}

pub(super) fn highlight_code_text(
    file_path: Option<&str>,
    code: &str,
    theme_mode: ThemeMode,
) -> Text<'static> {
    let syntax = syntax_for_path(file_path);
    let mut highlighter = HighlightLines::new(syntax, syntax_theme(theme_mode));
    let mut lines = Vec::new();
    let total_lines = code.lines().count().max(1);
    let line_number_width = total_lines.to_string().len().max(2);
    for (idx, line) in LinesWithEndings::from(code).enumerate() {
        let mut spans = vec![Span::styled(
            format!("{:>width$} ", idx + 1, width = line_number_width),
            Style::default().fg(Color::DarkGray),
        )];
        spans.extend(highlight_code_spans(
            line.trim_end_matches('\n'),
            &mut highlighter,
            theme_mode,
        ));
        lines.push(Line::from(spans));
    }
    Text::from(lines)
}

fn build_diff_code_line(
    prefix: char,
    code: &str,
    prefix_color: Color,
    highlighter: &mut HighlightLines<'_>,
    theme_mode: ThemeMode,
) -> Line<'static> {
    let mut spans = vec![Span::styled(
        prefix.to_string(),
        Style::default()
            .fg(prefix_color)
            .add_modifier(Modifier::BOLD),
    )];
    spans.extend(highlight_code_spans(code, highlighter, theme_mode));
    Line::from(spans)
}

fn highlight_code_spans(
    code: &str,
    highlighter: &mut HighlightLines<'_>,
    theme_mode: ThemeMode,
) -> Vec<Span<'static>> {
    match highlighter.highlight_line(code, &SYNTAX_SET) {
        Ok(regions) => regions
            .into_iter()
            .map(|(style, text)| {
                Span::styled(text.to_string(), syntect_to_ratatui(style, theme_mode))
            })
            .collect(),
        Err(_) => vec![Span::raw(code.to_string())],
    }
}

fn syntect_to_ratatui(style: SyntectStyle, theme_mode: ThemeMode) -> Style {
    let color = Color::Rgb(style.foreground.r, style.foreground.g, style.foreground.b);
    let color = match theme_mode {
        ThemeMode::Dark => normalize_dark_foreground(color),
        ThemeMode::Light => color,
    };
    Style::default().fg(color)
}

fn syntax_theme(theme_mode: ThemeMode) -> &'static Theme {
    match theme_mode {
        ThemeMode::Dark => &DARK_THEME,
        ThemeMode::Light => &LIGHT_THEME,
    }
}

fn syntax_for_path(file_path: Option<&str>) -> &syntect::parsing::SyntaxReference {
    file_path
        .and_then(|path| {
            SYNTAX_SET
                .find_syntax_for_file(path)
                .ok()
                .flatten()
                .or_else(|| {
                    Path::new(path)
                        .extension()
                        .and_then(|ext| ext.to_str())
                        .and_then(|ext| SYNTAX_SET.find_syntax_by_extension(ext))
                })
        })
        .unwrap_or_else(|| SYNTAX_SET.find_syntax_plain_text())
}

fn normalize_dark_foreground(color: Color) -> Color {
    match color {
        Color::Rgb(r, g, b) => {
            let brightest = r.max(g).max(b);
            if brightest >= 135 {
                Color::Rgb(r, g, b)
            } else {
                let scale = 135.0 / brightest.max(1) as f32;
                Color::Rgb(
                    ((r as f32 * scale).round() as u16).min(255) as u8,
                    ((g as f32 * scale).round() as u16).min(255) as u8,
                    ((b as f32 * scale).round() as u16).min(255) as u8,
                )
            }
        }
        other => other,
    }
}
