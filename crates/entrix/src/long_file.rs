use crate::file_budgets::{
    count_head_lines, count_lines, is_tracked_source_file, load_config, normalize_repo_path,
    resolve_budget, resolve_paths, FileBudgetConfig,
};
use crate::review_context::{analyze_file, SymbolGraphNode};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::Command;

const DEFAULT_COMMENT_REVIEW_COMMIT_THRESHOLD: usize = 5;
const SUPPORTED_EXTENSIONS: &[&str] = &[".go", ".java", ".py", ".rs", ".ts", ".tsx", ".js", ".jsx"];
const CONTAINER_KINDS: &[&str] = &["Class", "Struct", "Trait", "Enum", "Interface"];

#[derive(Debug, Clone, Serialize)]
pub struct LongFileAnalysisReport {
    pub status: String,
    pub base: String,
    pub files: Vec<LongFileFileReport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LongFileFileReport {
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub language: String,
    #[serde(rename = "lineCount")]
    pub line_count: usize,
    #[serde(rename = "budgetLimit")]
    pub budget_limit: usize,
    #[serde(rename = "budgetReason")]
    pub budget_reason: String,
    #[serde(rename = "overBudget")]
    pub over_budget: bool,
    #[serde(rename = "commitCount")]
    pub commit_count: usize,
    pub classes: Vec<LongFileClassReport>,
    pub functions: Vec<LongFileFunctionReport>,
    pub warnings: Vec<LongFileWarning>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LongFileClassReport {
    pub name: String,
    #[serde(rename = "qualifiedName")]
    pub qualified_name: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "startLine")]
    pub start_line: usize,
    #[serde(rename = "endLine")]
    pub end_line: usize,
    #[serde(rename = "lineCount")]
    pub line_count: usize,
    #[serde(rename = "commitCount")]
    pub commit_count: usize,
    #[serde(rename = "commentCount")]
    pub comment_count: usize,
    pub comments: Vec<LongFileComment>,
    #[serde(rename = "methodCount")]
    pub method_count: usize,
    pub methods: Vec<LongFileFunctionReport>,
    pub warnings: Vec<LongFileWarning>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LongFileFunctionReport {
    pub name: String,
    #[serde(rename = "qualifiedName")]
    pub qualified_name: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "startLine")]
    pub start_line: usize,
    #[serde(rename = "endLine")]
    pub end_line: usize,
    #[serde(rename = "lineCount")]
    pub line_count: usize,
    #[serde(rename = "commitCount")]
    pub commit_count: usize,
    #[serde(rename = "commentCount")]
    pub comment_count: usize,
    pub comments: Vec<LongFileComment>,
    pub kind: String,
    #[serde(rename = "parentClassName")]
    pub parent_class_name: Option<String>,
    pub warnings: Vec<LongFileWarning>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LongFileComment {
    #[serde(rename = "startLine")]
    pub start_line: usize,
    #[serde(rename = "endLine")]
    pub end_line: usize,
    #[serde(rename = "lineCount")]
    pub line_count: usize,
    pub placement: String,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LongFileWarning {
    pub code: String,
    pub summary: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "qualifiedName")]
    pub qualified_name: String,
    pub name: String,
    #[serde(rename = "symbolKind")]
    pub symbol_kind: String,
    #[serde(rename = "startLine")]
    pub start_line: usize,
    #[serde(rename = "endLine")]
    pub end_line: usize,
    #[serde(rename = "lineCount")]
    pub line_count: usize,
    #[serde(rename = "commitCount")]
    pub commit_count: usize,
    #[serde(rename = "commentCount")]
    pub comment_count: usize,
    #[serde(rename = "commentSpans")]
    pub comment_spans: Vec<LongFileCommentSpan>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LongFileCommentSpan {
    #[serde(rename = "startLine")]
    pub start_line: usize,
    #[serde(rename = "endLine")]
    pub end_line: usize,
    pub placement: String,
}

#[derive(Debug, Clone)]
struct RawComment {
    start_line: usize,
    end_line: usize,
    line_count: usize,
    text: String,
}

pub fn analyze_long_files(
    repo_root: &Path,
    files: Option<Vec<String>>,
    config_path: Option<&Path>,
    base: &str,
    use_head_ratchet: bool,
    comment_review_commit_threshold: usize,
) -> LongFileAnalysisReport {
    let config_path = config_path
        .map(PathBuf::from)
        .unwrap_or_else(|| repo_root.join("docs/fitness/file_budgets.json"));
    let config = match load_config(&config_path) {
        Ok(config) => config,
        Err(error) => {
            return LongFileAnalysisReport {
                status: "unavailable".to_string(),
                base: base.to_string(),
                files: Vec::new(),
                summary: Some(error),
            };
        }
    };

    let target_files = resolve_target_files(repo_root, &config, files, base, use_head_ratchet);
    let analyses = target_files
        .into_iter()
        .filter_map(|relative_path| {
            analyze_single_long_file(
                repo_root,
                &relative_path,
                &config,
                use_head_ratchet,
                comment_review_commit_threshold,
            )
        })
        .collect::<Vec<_>>();

    LongFileAnalysisReport {
        status: "ok".to_string(),
        base: base.to_string(),
        files: analyses,
        summary: None,
    }
}

fn resolve_target_files(
    repo_root: &Path,
    config: &FileBudgetConfig,
    files: Option<Vec<String>>,
    base: &str,
    use_head_ratchet: bool,
) -> Vec<String> {
    if let Some(files) = files {
        let normalized = files
            .into_iter()
            .filter_map(|raw_path| normalize_explicit_path(repo_root, &raw_path))
            .collect::<BTreeSet<_>>();
        return normalized.into_iter().collect();
    }

    let Ok(relative_paths) = resolve_paths(repo_root, config, &[], false, false, base, false)
    else {
        return Vec::new();
    };

    relative_paths
        .into_iter()
        .filter(|relative_path| is_tracked_source_file(relative_path, config))
        .filter(|relative_path| {
            let file_path = repo_root.join(relative_path);
            if !file_path.is_file() {
                return false;
            }
            let (budget_limit, _) =
                resolve_budget_limit(repo_root, relative_path, config, use_head_ratchet);
            count_lines(&file_path) > budget_limit
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn normalize_explicit_path(repo_root: &Path, raw_path: &str) -> Option<String> {
    let path = Path::new(raw_path);
    let full_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        repo_root.join(path)
    };
    if !full_path.is_file() {
        return None;
    }
    let extension = full_path.extension().and_then(|ext| ext.to_str())?;
    let dotted = format!(".{extension}");
    if !SUPPORTED_EXTENSIONS.contains(&dotted.as_str()) {
        return None;
    }
    Some(normalize_repo_path(&full_path, repo_root))
}

fn analyze_single_long_file(
    repo_root: &Path,
    relative_path: &str,
    config: &FileBudgetConfig,
    use_head_ratchet: bool,
    comment_review_commit_threshold: usize,
) -> Option<LongFileFileReport> {
    let analysis = analyze_file(repo_root, relative_path);
    if analysis.status != "ok" {
        return None;
    }

    let language = analysis.language?;
    let symbols = analysis.symbols.unwrap_or_default();
    let comments = normalize_comments(analysis.comments.unwrap_or_default());
    let file_path = repo_root.join(relative_path);
    let source_lines = std::fs::read_to_string(&file_path)
        .ok()?
        .lines()
        .map(ToString::to_string)
        .collect::<Vec<_>>();

    let line_count = count_lines(&file_path);
    let (budget_limit, budget_reason) =
        resolve_budget_limit(repo_root, relative_path, config, use_head_ratchet);
    let commit_count = count_file_commits(repo_root, relative_path);

    let mut child_spans_by_parent = BTreeMap::<String, Vec<(usize, usize)>>::new();
    let container_names = symbols
        .iter()
        .filter(|symbol| CONTAINER_KINDS.contains(&symbol.kind.as_str()))
        .map(|symbol| symbol.name.clone())
        .collect::<BTreeSet<_>>();

    for symbol in &symbols {
        if let Some(parent_name) = symbol.parent_name.clone() {
            child_spans_by_parent
                .entry(parent_name)
                .or_default()
                .push((symbol.line_start, symbol.line_end));
        }
    }

    let mut methods_by_parent = BTreeMap::<String, Vec<LongFileFunctionReport>>::new();
    let mut globals_out = Vec::<LongFileFunctionReport>::new();
    let mut warnings = Vec::<LongFileWarning>::new();
    let mut symbol_commit_cache = BTreeMap::<(usize, usize), usize>::new();

    for symbol in &symbols {
        if symbol.is_test || CONTAINER_KINDS.contains(&symbol.kind.as_str()) {
            continue;
        }
        let function = to_function_map(
            symbol,
            FunctionReportContext {
                repo_root,
                relative_path,
                comments: &comments,
                source_lines: &source_lines,
                child_symbol_spans: child_spans_by_parent
                    .get(&symbol.name)
                    .cloned()
                    .unwrap_or_default(),
                symbol_commit_cache: &mut symbol_commit_cache,
                threshold: comment_review_commit_threshold,
            },
        );
        warnings.extend(function.warnings.clone());

        if let Some(parent_name) = function.parent_class_name.clone() {
            if container_names.contains(&parent_name) {
                methods_by_parent
                    .entry(parent_name)
                    .or_default()
                    .push(function);
                continue;
            }
        }
        if symbol.kind == "Function" || symbol.kind == "Method" {
            globals_out.push(function);
        }
    }

    let mut classes = Vec::new();
    for container in symbols
        .iter()
        .filter(|symbol| CONTAINER_KINDS.contains(&symbol.kind.as_str()))
    {
        let mut methods = methods_by_parent
            .remove(&container.name)
            .unwrap_or_default();
        methods.sort_by_key(|method| (method.start_line, method.qualified_name.clone()));
        let container_comments = comments_for_symbol(
            container.line_start,
            container.line_end,
            &comments,
            &source_lines,
            child_spans_by_parent
                .get(&container.name)
                .cloned()
                .unwrap_or_default()
                .as_slice(),
            false,
        );
        let container_commit_count = symbol_commit_count(
            repo_root,
            relative_path,
            container.line_start,
            container.line_end,
            &mut symbol_commit_cache,
        );
        let container_warnings = comment_review_warnings(
            container_commit_count,
            &container_comments,
            CommentReviewContext {
                relative_path,
                qualified_name: &container.qualified_name,
                name: &container.name,
                symbol_kind: "class",
                start_line: container.line_start,
                end_line: container.line_end,
                threshold: comment_review_commit_threshold,
            },
        );
        warnings.extend(container_warnings.clone());
        classes.push(LongFileClassReport {
            name: container.name.clone(),
            qualified_name: container.qualified_name.clone(),
            file_path: relative_path.to_string(),
            start_line: container.line_start,
            end_line: container.line_end,
            line_count: container.line_end.saturating_sub(container.line_start) + 1,
            commit_count: container_commit_count,
            comment_count: container_comments.len(),
            comments: container_comments,
            method_count: methods.len(),
            methods,
            warnings: container_warnings,
        });
    }

    classes.sort_by_key(|class| (class.start_line, class.qualified_name.clone()));
    globals_out.sort_by_key(|function| (function.start_line, function.qualified_name.clone()));
    warnings.sort_by_key(|warning| {
        (
            warning.start_line,
            warning.name.clone(),
            warning.symbol_kind.clone(),
        )
    });

    Some(LongFileFileReport {
        file_path: relative_path.to_string(),
        language,
        line_count,
        budget_limit,
        budget_reason,
        over_budget: line_count > budget_limit,
        commit_count,
        classes,
        functions: globals_out,
        warnings,
    })
}

fn resolve_budget_limit(
    repo_root: &Path,
    relative_path: &str,
    config: &FileBudgetConfig,
    use_head_ratchet: bool,
) -> (usize, String) {
    let (configured_limit, mut reason) = resolve_budget(relative_path, config);
    let mut max_lines = configured_limit;
    if use_head_ratchet {
        if let Some(baseline_lines) = count_head_lines(repo_root, relative_path) {
            max_lines = max_lines.max(baseline_lines);
            if baseline_lines > configured_limit && reason.is_empty() {
                reason = format!("legacy hotspot frozen at HEAD baseline ({baseline_lines} lines)");
            }
        }
    }
    (max_lines, reason)
}

fn normalize_comments(values: Vec<Value>) -> Vec<RawComment> {
    values
        .into_iter()
        .filter_map(|value| {
            Some(RawComment {
                start_line: value.get("startLine")?.as_u64()? as usize,
                end_line: value.get("endLine")?.as_u64()? as usize,
                line_count: value.get("lineCount")?.as_u64()? as usize,
                text: value.get("text")?.as_str()?.to_string(),
            })
        })
        .collect()
}

struct FunctionReportContext<'a> {
    repo_root: &'a Path,
    relative_path: &'a str,
    comments: &'a [RawComment],
    source_lines: &'a [String],
    child_symbol_spans: Vec<(usize, usize)>,
    symbol_commit_cache: &'a mut BTreeMap<(usize, usize), usize>,
    threshold: usize,
}

fn to_function_map(
    symbol: &SymbolGraphNode,
    context: FunctionReportContext<'_>,
) -> LongFileFunctionReport {
    let kind = if symbol.parent_name.is_some() {
        "method"
    } else {
        "function"
    };
    let symbol_comments = comments_for_symbol(
        symbol.line_start,
        symbol.line_end,
        context.comments,
        context.source_lines,
        &context.child_symbol_spans,
        true,
    );
    let commit_count = symbol_commit_count(
        context.repo_root,
        context.relative_path,
        symbol.line_start,
        symbol.line_end,
        context.symbol_commit_cache,
    );
    let warnings = comment_review_warnings(
        commit_count,
        &symbol_comments,
        CommentReviewContext {
            relative_path: context.relative_path,
            qualified_name: &symbol.qualified_name,
            name: &symbol.name,
            symbol_kind: kind,
            start_line: symbol.line_start,
            end_line: symbol.line_end,
            threshold: context.threshold,
        },
    );
    LongFileFunctionReport {
        name: symbol.name.clone(),
        qualified_name: symbol.qualified_name.clone(),
        file_path: symbol.file_path.clone(),
        start_line: symbol.line_start,
        end_line: symbol.line_end,
        line_count: symbol.line_end.saturating_sub(symbol.line_start) + 1,
        commit_count,
        comment_count: symbol_comments.len(),
        comments: symbol_comments,
        kind: kind.to_string(),
        parent_class_name: symbol.parent_name.clone(),
        warnings,
    }
}

fn comments_for_symbol(
    start_line: usize,
    end_line: usize,
    comments: &[RawComment],
    source_lines: &[String],
    child_symbol_spans: &[(usize, usize)],
    include_inner: bool,
) -> Vec<LongFileComment> {
    let mut attached = leading_comments_for_symbol(start_line, comments, source_lines);
    let mut attached_keys = attached
        .iter()
        .map(|comment| (comment.start_line, comment.end_line))
        .collect::<BTreeSet<_>>();
    if !include_inner {
        attached.sort_by_key(|comment| (comment.start_line, comment.end_line));
        return attached;
    }

    for comment in comments {
        if comment.start_line < start_line || comment.end_line > end_line {
            continue;
        }
        if inside_child_symbol(comment, child_symbol_spans) {
            continue;
        }
        let key = (comment.start_line, comment.end_line);
        if attached_keys.contains(&key) {
            continue;
        }
        attached.push(normalize_comment(comment, "inner"));
        attached_keys.insert(key);
    }
    attached.sort_by_key(|comment| (comment.start_line, comment.end_line));
    attached
}

fn leading_comments_for_symbol(
    start_line: usize,
    comments: &[RawComment],
    source_lines: &[String],
) -> Vec<LongFileComment> {
    let mut comments_by_end = BTreeMap::<usize, Vec<&RawComment>>::new();
    for comment in comments {
        comments_by_end
            .entry(comment.end_line)
            .or_default()
            .push(comment);
    }

    let mut attached = Vec::new();
    let mut cursor = start_line.saturating_sub(1);
    while cursor > 0
        && source_lines
            .get(cursor - 1)
            .is_some_and(|line| line.trim().is_empty())
    {
        cursor = cursor.saturating_sub(1);
    }

    while cursor > 0 {
        let Some(candidates) = comments_by_end.get(&cursor) else {
            break;
        };
        let comment = candidates
            .iter()
            .max_by_key(|candidate| candidate.start_line)
            .copied();
        let Some(comment) = comment else {
            break;
        };
        attached.push(normalize_comment(comment, "leading"));
        cursor = comment.start_line.saturating_sub(1);
        while cursor > 0
            && source_lines
                .get(cursor - 1)
                .is_some_and(|line| line.trim().is_empty())
        {
            cursor = cursor.saturating_sub(1);
        }
    }

    attached.reverse();
    attached
}

fn inside_child_symbol(comment: &RawComment, child_symbol_spans: &[(usize, usize)]) -> bool {
    child_symbol_spans.iter().any(|(child_start, child_end)| {
        *child_start <= comment.start_line && comment.end_line <= *child_end
    })
}

fn normalize_comment(comment: &RawComment, placement: &str) -> LongFileComment {
    let preview = comment
        .text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let preview = truncate_comment_preview(preview, 120);
    LongFileComment {
        start_line: comment.start_line,
        end_line: comment.end_line,
        line_count: comment.line_count,
        placement: placement.to_string(),
        preview,
    }
}

fn truncate_comment_preview(preview: String, max_chars: usize) -> String {
    if preview.chars().count() <= max_chars {
        return preview;
    }

    let content_chars = max_chars.saturating_sub(3);
    let prefix = preview.chars().take(content_chars).collect::<String>();
    format!("{prefix}...")
}

fn symbol_commit_count(
    repo_root: &Path,
    relative_path: &str,
    start_line: usize,
    end_line: usize,
    cache: &mut BTreeMap<(usize, usize), usize>,
) -> usize {
    let key = (start_line, end_line);
    if let Some(value) = cache.get(&key) {
        return *value;
    }
    let value = count_symbol_commits(repo_root, relative_path, start_line, end_line);
    cache.insert(key, value);
    value
}

struct CommentReviewContext<'a> {
    relative_path: &'a str,
    qualified_name: &'a str,
    name: &'a str,
    symbol_kind: &'a str,
    start_line: usize,
    end_line: usize,
    threshold: usize,
}

fn comment_review_warnings(
    commit_count: usize,
    comments: &[LongFileComment],
    context: CommentReviewContext<'_>,
) -> Vec<LongFileWarning> {
    if commit_count < context.threshold || comments.is_empty() {
        return Vec::new();
    }
    vec![LongFileWarning {
        code: "comment_review_required".to_string(),
        summary: format!(
            "{} '{}' changed in {commit_count} commit(s) and still has {} comment(s); review comments for stale guidance.",
            context.symbol_kind,
            context.name,
            comments.len()
        ),
        file_path: context.relative_path.to_string(),
        qualified_name: context.qualified_name.to_string(),
        name: context.name.to_string(),
        symbol_kind: context.symbol_kind.to_string(),
        start_line: context.start_line,
        end_line: context.end_line,
        line_count: context.end_line.saturating_sub(context.start_line) + 1,
        commit_count,
        comment_count: comments.len(),
        comment_spans: comments
            .iter()
            .map(|comment| LongFileCommentSpan {
                start_line: comment.start_line,
                end_line: comment.end_line,
                placement: comment.placement.clone(),
            })
            .collect(),
    }]
}

fn count_file_commits(repo_root: &Path, relative_path: &str) -> usize {
    let Ok(output) = Command::new("git")
        .args(["log", "--follow", "--format=%H", "--", relative_path])
        .current_dir(repo_root)
        .output()
    else {
        return 0;
    };
    if !output.status.success() {
        return 0;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count()
}

fn count_symbol_commits(
    repo_root: &Path,
    relative_path: &str,
    start_line: usize,
    end_line: usize,
) -> usize {
    let Ok(output) = Command::new("git")
        .args([
            "log",
            "-L",
            &format!("{start_line},{end_line}:{relative_path}"),
            "--format=%H",
        ])
        .current_dir(repo_root)
        .output()
    else {
        return 0;
    };
    if !output.status.success() {
        return 0;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| {
            let line = line.trim();
            line.len() == 40 && line.chars().all(|char| char.is_ascii_hexdigit())
        })
        .count()
}

pub fn default_comment_review_commit_threshold() -> usize {
    DEFAULT_COMMENT_REVIEW_COMMIT_THRESHOLD
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;

    fn write(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn write_budget_config(path: &Path, max_ts: usize) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(
            path,
            format!(
                r#"{{
  "default_max_lines": 1600,
  "include_roots": ["src", "apps", "crates"],
  "extensions": [".go", ".java", ".py", ".rs", ".ts", ".tsx"],
  "extension_max_lines": {{
    ".go": 1600,
    ".java": 1600,
    ".py": 1600,
    ".ts": {max_ts},
    ".tsx": 1600,
    ".rs": 1600
  }},
  "excluded_parts": ["/node_modules/", "/target/", "/.next/", "/_next/", "/bundled/"],
  "overrides": []
}}"#
            ),
        )
        .unwrap();
    }

    #[test]
    fn analyze_long_file_reports_explicit_typescript_file() {
        let tmp = tempfile::tempdir().unwrap();
        write_budget_config(&tmp.path().join("docs/fitness/file_budgets.json"), 1000);
        write(
            &tmp.path().join("src/runner.ts"),
            "class Runner {\n  run() {\n    return helper();\n  }\n}\n\nfunction helper() {\n  return 1;\n}\n",
        );

        let result = analyze_long_files(
            tmp.path(),
            Some(vec!["src/runner.ts".to_string()]),
            None,
            "HEAD",
            true,
            DEFAULT_COMMENT_REVIEW_COMMIT_THRESHOLD,
        );

        assert_eq!(result.status, "ok");
        assert_eq!(result.files.len(), 1);
        let analysis = &result.files[0];
        assert_eq!(analysis.file_path, "src/runner.ts");
        assert_eq!(analysis.language, "typescript");
        assert_eq!(analysis.classes[0].name, "Runner");
        assert_eq!(analysis.classes[0].method_count, 1);
        assert_eq!(analysis.classes[0].methods[0].name, "run");
        assert_eq!(analysis.functions[0].name, "helper");
        assert_eq!(analysis.functions[0].kind, "function");
    }

    #[test]
    fn analyze_long_file_defaults_to_oversized_files() {
        let tmp = tempfile::tempdir().unwrap();
        write_budget_config(&tmp.path().join("docs/fitness/file_budgets.json"), 3);
        write(
            &tmp.path().join("src/large.ts"),
            "function a() {\n  return 1;\n}\nfunction b() {\n  return 2;\n}\n",
        );
        write(
            &tmp.path().join("src/small.ts"),
            "function ok() {\n  return 1;\n}\n",
        );

        let result = analyze_long_files(tmp.path(), None, None, "HEAD", true, 5);
        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].file_path, "src/large.ts");
        assert!(result.files[0].over_budget);
        assert_eq!(result.files[0].functions.len(), 2);
    }

    #[test]
    fn normalize_comment_truncates_unicode_preview_on_char_boundary() {
        let comment = RawComment {
            start_line: 1,
            end_line: 1,
            line_count: 1,
            text: format!(
                "// ── Tools that don't require workspaceId {}",
                "─".repeat(160)
            ),
        };

        let normalized = normalize_comment(&comment, "leading");

        assert!(normalized.preview.ends_with("..."));
        assert_eq!(normalized.preview.chars().count(), 120);
        assert!(normalized
            .preview
            .is_char_boundary(normalized.preview.len()));
    }
}
