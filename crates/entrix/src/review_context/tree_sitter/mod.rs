mod go;
mod graph_builder;
mod java;
mod python;
mod query;
mod resolver;
mod rust;
#[cfg(test)]
mod tests;
mod typescript;

use super::model::{
    ChangedNode, FileGraphNode, GraphNodePayload, ParsedReviewGraph, SymbolGraphNode,
};
use graph_builder::{derive_graph_edges, derive_target_tests};
pub(crate) use query::QueryResult;
use resolver::{
    resolve_go_import as resolve_go_import_impl, resolve_java_import as resolve_java_import_impl,
    resolve_python_import as resolve_python_import_impl,
    resolve_relative_import as resolve_relative_import_impl,
    resolve_rust_import as resolve_rust_import_impl,
};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;
use tree_sitter::{Language, Parser};

pub fn parse_changed_files(repo_root: &Path, changed_files: &[String]) -> ParsedReviewGraph {
    let mut changed_nodes = Vec::new();
    let mut related_test_nodes = Vec::new();
    let mut impacted_nodes = Vec::new();
    let mut file_imports = BTreeMap::new();
    let mut files_updated = 0usize;
    let mut languages = BTreeSet::new();
    let mut related_test_files = BTreeSet::new();

    for relative_path in changed_files {
        let full_path = repo_root.join(relative_path);
        let Ok(source) = fs::read_to_string(&full_path) else {
            continue;
        };
        let Some(language) = language_config_for_path(relative_path) else {
            continue;
        };
        let is_test_file = (language.is_test_file)(relative_path);
        files_updated += 1;
        languages.insert(language.name.to_string());

        changed_nodes.push(ChangedNode {
            qualified_name: relative_path.clone(),
            name: file_name(relative_path),
            kind: "File".to_string(),
            file_path: relative_path.clone(),
            language: language.name.to_string(),
            is_test: is_test_file,
            line_start: None,
            line_end: None,
            parent_name: None,
            references: Vec::new(),
            extends: String::new(),
            mentions: Vec::new(),
        });

        let mut parser = Parser::new();
        if parser.set_language(&language.ts_language()).is_err() {
            continue;
        }
        let Some(tree) = parser.parse(&source, None) else {
            continue;
        };
        let imports = (language.parse_imports)(repo_root, relative_path, &source, tree.root_node());
        file_imports.insert(relative_path.clone(), imports);

        let mut file_nodes = (language.parse_nodes)(relative_path, &source, tree.root_node());
        mark_test_symbols(&mut file_nodes, is_test_file);
        changed_nodes.append(&mut file_nodes);

        if !(language.is_test_file)(relative_path) {
            for candidate in (language.companion_test_candidates)(relative_path) {
                if changed_files.contains(&candidate) || !repo_root.join(&candidate).is_file() {
                    continue;
                }
                if !related_test_files.insert(candidate.clone()) {
                    continue;
                }
                let Some(test_language) = language_config_for_path(&candidate) else {
                    continue;
                };
                languages.insert(test_language.name.to_string());
                impacted_nodes.push(ChangedNode {
                    qualified_name: candidate.clone(),
                    name: file_name(&candidate),
                    kind: "File".to_string(),
                    file_path: candidate.clone(),
                    language: test_language.name.to_string(),
                    is_test: true,
                    line_start: None,
                    line_end: None,
                    parent_name: None,
                    references: Vec::new(),
                    extends: String::new(),
                    mentions: Vec::new(),
                });
                let Ok(test_source) = fs::read_to_string(repo_root.join(&candidate)) else {
                    continue;
                };
                let mut parser = Parser::new();
                if parser.set_language(&test_language.ts_language()).is_err() {
                    continue;
                }
                let Some(test_tree) = parser.parse(&test_source, None) else {
                    continue;
                };
                let imports = (test_language.parse_imports)(
                    repo_root,
                    &candidate,
                    &test_source,
                    test_tree.root_node(),
                );
                file_imports.insert(candidate.clone(), imports);
                let mut test_nodes =
                    (test_language.parse_nodes)(&candidate, &test_source, test_tree.root_node());
                mark_test_symbols(&mut test_nodes, (test_language.is_test_file)(&candidate));
                impacted_nodes.extend(test_nodes.iter().cloned());
                related_test_nodes.append(&mut test_nodes);
            }
        }
    }

    let target_tests = derive_target_tests(&changed_nodes, &related_test_nodes);
    let graph_edges = derive_graph_edges(
        &changed_nodes,
        &related_test_nodes,
        &file_imports,
        &target_tests,
    );
    let total_edges = graph_edges.len();

    ParsedReviewGraph {
        changed_nodes,
        related_test_nodes,
        impacted_nodes,
        graph_edges,
        files_updated,
        total_edges,
        languages: languages.into_iter().collect(),
    }
}

fn mark_test_symbols(nodes: &mut [ChangedNode], is_test_file: bool) {
    if !is_test_file {
        return;
    }

    for node in nodes.iter_mut() {
        node.is_test = true;
        if node.kind == "Function" {
            node.kind = "Test".to_string();
        }
    }
}

pub fn parse_repo_graph(repo_root: &Path) -> ParsedReviewGraph {
    let files = collect_repo_files(repo_root);
    parse_changed_files(repo_root, &files)
}

pub fn node_to_payload(node: &ChangedNode) -> GraphNodePayload {
    if node.kind == "File" {
        return GraphNodePayload::File(FileGraphNode {
            qualified_name: node.qualified_name.clone(),
            name: node.name.clone(),
            kind: node.kind.clone(),
            file_path: node.file_path.clone(),
            language: node.language.clone(),
            is_test: node.is_test,
        });
    }

    GraphNodePayload::Symbol(SymbolGraphNode {
        qualified_name: node.qualified_name.clone(),
        name: node.name.clone(),
        kind: node.kind.clone(),
        file_path: node.file_path.clone(),
        line_start: node.line_start.unwrap_or(1),
        line_end: node.line_end.unwrap_or(1),
        language: node.language.clone(),
        parent_name: node.parent_name.clone(),
        is_test: node.is_test,
        references: node.references.clone(),
        extends: node.extends.clone(),
    })
}

pub fn query_graph(graph: &ParsedReviewGraph, query_type: &str, target: &str) -> QueryResult {
    query::query_graph(graph, query_type, target)
}

fn resolve_graph_target(graph: &ParsedReviewGraph, target: &str) -> Option<String> {
    let nodes = graph
        .changed_nodes
        .iter()
        .chain(graph.related_test_nodes.iter())
        .collect::<Vec<_>>();
    if nodes.iter().any(|node| node.qualified_name == target) {
        return Some(target.to_string());
    }
    if nodes
        .iter()
        .any(|node| node.kind == "File" && node.file_path == target)
    {
        return Some(target.to_string());
    }
    let matches = nodes
        .iter()
        .filter(|node| node.name == target)
        .map(|node| node.qualified_name.clone())
        .collect::<BTreeSet<_>>();
    if matches.len() == 1 {
        return matches.into_iter().next();
    }
    None
}

fn symbol_to_payload(node: &ChangedNode) -> SymbolGraphNode {
    SymbolGraphNode {
        qualified_name: node.qualified_name.clone(),
        name: node.name.clone(),
        kind: node.kind.clone(),
        file_path: node.file_path.clone(),
        line_start: node.line_start.unwrap_or(1),
        line_end: node.line_end.unwrap_or(1),
        language: node.language.clone(),
        parent_name: node.parent_name.clone(),
        is_test: node.is_test,
        references: node.references.clone(),
        extends: node.extends.clone(),
    }
}

pub fn query_file_imports(repo_root: &Path, target: &str, reverse: bool) -> QueryResult {
    query::query_file_imports(repo_root, target, reverse)
}

fn file_node_payload(relative_path: &str) -> Option<GraphNodePayload> {
    let language = language_config_for_path(relative_path)?;
    Some(GraphNodePayload::File(FileGraphNode {
        qualified_name: relative_path.to_string(),
        name: file_name(relative_path),
        kind: "File".to_string(),
        file_path: relative_path.to_string(),
        language: language.name.to_string(),
        is_test: (language.is_test_file)(relative_path),
    }))
}

struct FileImportRecord {
    file_path: String,
    imports: Vec<String>,
}

fn parse_file_import_record(repo_root: &Path, relative_path: &str) -> Option<FileImportRecord> {
    let language = language_config_for_path(relative_path)?;
    let source = fs::read_to_string(repo_root.join(relative_path)).ok()?;
    let mut parser = Parser::new();
    parser.set_language(&language.ts_language()).ok()?;
    let tree = parser.parse(&source, None)?;
    let imports = (language.parse_imports)(repo_root, relative_path, &source, tree.root_node());
    Some(FileImportRecord {
        file_path: relative_path.to_string(),
        imports,
    })
}

pub(super) fn resolve_repo_relative_path(repo_root: &Path, target: &str) -> Option<String> {
    let candidate = repo_root.join(target);
    let resolved = candidate.canonicalize().ok()?;
    let root = repo_root.canonicalize().ok()?;
    let relative = resolved.strip_prefix(root).ok()?;
    Some(relative.to_string_lossy().replace('\\', "/"))
}

pub fn analyze_single_file(repo_root: &Path, target: &str) -> Option<SingleFileAnalysis> {
    let relative_path = resolve_repo_relative_path(repo_root, target)?;
    let language = language_config_for_path(&relative_path)?;
    let source = fs::read_to_string(repo_root.join(&relative_path)).ok()?;
    let mut parser = Parser::new();
    parser.set_language(&language.ts_language()).ok()?;
    let tree = parser.parse(&source, None)?;
    let comments = collect_comments(&source, tree.root_node());
    let symbols = (language.parse_nodes)(&relative_path, &source, tree.root_node())
        .into_iter()
        .filter(|node| node.kind != "File")
        .map(|node| symbol_to_payload(&node))
        .collect::<Vec<_>>();
    let imports = (language.parse_imports)(repo_root, &relative_path, &source, tree.root_node());
    Some(SingleFileAnalysis {
        file_path: relative_path.clone(),
        language: language.name.to_string(),
        is_test_file: (language.is_test_file)(&relative_path),
        imports,
        comments,
        symbols,
        source_basename: normalized_source_basename(&relative_path),
    })
}

fn collect_comments(source: &str, root: tree_sitter::Node<'_>) -> Vec<serde_json::Value> {
    let mut comments = Vec::new();
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if node.kind() == "comment" {
            let start_line = node.start_position().row + 1;
            let end_line = node.end_position().row + 1;
            let text = node
                .utf8_text(source.as_bytes())
                .ok()
                .unwrap_or_default()
                .to_string();
            comments.push(json!({
                "startLine": start_line,
                "endLine": end_line,
                "lineCount": end_line.saturating_sub(start_line) + 1,
                "text": text,
            }));
            continue;
        }

        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            stack.push(child);
        }
    }

    comments.sort_by_key(|comment| {
        comment
            .get("startLine")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0)
    });
    comments
}

pub struct SingleFileAnalysis {
    pub file_path: String,
    pub language: String,
    pub is_test_file: bool,
    pub imports: Vec<String>,
    pub comments: Vec<serde_json::Value>,
    pub symbols: Vec<SymbolGraphNode>,
    pub source_basename: String,
}

fn normalized_source_basename(relative_path: &str) -> String {
    let mut name = Path::new(relative_path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(relative_path)
        .to_string();
    for marker in [".test", ".spec", "_test", "_spec"] {
        name = name.replace(marker, "");
    }
    while let Some(extension) = Path::new(&name)
        .extension()
        .and_then(|value| value.to_str())
    {
        let suffix = format!(".{extension}");
        if let Some(stripped) = name.strip_suffix(&suffix) {
            name = stripped.to_string();
        } else {
            break;
        }
    }
    name
}

pub(super) fn resolve_relative_import(
    repo_root: &Path,
    relative_path: &str,
    import_path: &str,
) -> Option<String> {
    resolve_relative_import_impl(repo_root, relative_path, import_path)
}

pub(super) fn resolve_python_import(
    repo_root: &Path,
    relative_path: &str,
    import_path: &str,
) -> Option<String> {
    resolve_python_import_impl(repo_root, relative_path, import_path)
}

pub(super) fn resolve_go_import(
    repo_root: &Path,
    relative_path: &str,
    import_path: &str,
) -> Option<String> {
    resolve_go_import_impl(repo_root, relative_path, import_path)
}

pub(super) fn resolve_java_import(
    repo_root: &Path,
    relative_path: &str,
    import_path: &str,
    is_static_import: bool,
) -> Option<String> {
    resolve_java_import_impl(repo_root, relative_path, import_path, is_static_import)
}

pub(super) fn resolve_rust_import(
    repo_root: &Path,
    relative_path: &str,
    import_text: &str,
) -> Option<String> {
    resolve_rust_import_impl(repo_root, relative_path, import_text)
}

pub(crate) fn collect_identifier_mentions(
    node: tree_sitter::Node<'_>,
    source: &[u8],
) -> Vec<String> {
    let mut mentions = BTreeSet::new();
    collect_identifier_mentions_inner(node, source, &mut mentions);
    mentions.into_iter().collect()
}

fn collect_identifier_mentions_inner(
    node: tree_sitter::Node<'_>,
    source: &[u8],
    out: &mut BTreeSet<String>,
) {
    if matches!(
        node.kind(),
        "identifier" | "type_identifier" | "field_identifier" | "property_identifier"
    ) {
        if let Ok(name) = node.utf8_text(source) {
            let normalized = name.trim().to_string();
            if !normalized.is_empty() {
                out.insert(normalized);
            }
        }
    }

    for child in node.children(&mut node.walk()) {
        collect_identifier_mentions_inner(child, source, out);
    }
}

pub(crate) fn parse_named_node(
    relative_path: &str,
    source: &[u8],
    node: tree_sitter::Node<'_>,
    kind: &str,
    language: &str,
) -> Option<ChangedNode> {
    let name = node
        .child_by_field_name("name")
        .and_then(|child| child.utf8_text(source).ok())
        .map(str::trim)
        .filter(|name| !name.is_empty())?
        .to_string();
    Some(ChangedNode {
        qualified_name: format!("{relative_path}:{name}"),
        name,
        kind: kind.to_string(),
        file_path: relative_path.to_string(),
        language: language.to_string(),
        is_test: false,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: None,
        references: Vec::new(),
        extends: String::new(),
        mentions: collect_identifier_mentions(node, source),
    })
}

pub(crate) fn sanitize_test_name(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
        } else if matches!(ch, ' ' | '-' | '.' | '/' | ':') {
            out.push('_');
        }
    }
    out.trim_matches('_').to_string()
}

fn java_companion_test_candidates(relative_path: &str) -> Vec<String> {
    if let Some(rest) = relative_path.strip_prefix("src/main/java/") {
        let stem = Path::new(rest)
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        let parent = Path::new(rest).parent().unwrap_or_else(|| Path::new(""));
        return ["Test", "Tests", "IT"]
            .into_iter()
            .map(|suffix| {
                Path::new("src/test/java")
                    .join(parent)
                    .join(format!("{stem}{suffix}.java"))
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect();
    }
    Vec::new()
}

fn go_companion_test_candidates(relative_path: &str) -> Vec<String> {
    let path = Path::new(relative_path);
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if stem.ends_with("_test") || stem.is_empty() {
        return Vec::new();
    }
    vec![parent
        .join(format!("{stem}_test.go"))
        .to_string_lossy()
        .replace('\\', "/")]
}

fn python_companion_test_candidates(relative_path: &str) -> Vec<String> {
    let path = Path::new(relative_path);
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if stem.is_empty() || stem.starts_with("test_") || stem.ends_with("_test") {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    for name in [format!("test_{stem}.py"), format!("{stem}_test.py")] {
        candidates.push(parent.join(&name).to_string_lossy().replace('\\', "/"));
        candidates.push(
            parent
                .join("tests")
                .join(&name)
                .to_string_lossy()
                .replace('\\', "/"),
        );
    }
    candidates
}

fn typescript_companion_test_candidates(relative_path: &str) -> Vec<String> {
    let path = Path::new(relative_path);
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let ext = path
        .extension()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if stem.is_empty() || ext.is_empty() {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    for suffix in ["test", "spec"] {
        candidates.push(
            parent
                .join(format!("{stem}.{suffix}.{ext}"))
                .to_string_lossy()
                .replace('\\', "/"),
        );
        candidates.push(
            parent
                .join("__tests__")
                .join(format!("{stem}.{suffix}.{ext}"))
                .to_string_lossy()
                .replace('\\', "/"),
        );
        candidates.push(
            parent
                .join("tests")
                .join(format!("{stem}.{suffix}.{ext}"))
                .to_string_lossy()
                .replace('\\', "/"),
        );
    }
    candidates
}

fn is_generic_test_file(relative_path: &str) -> bool {
    let lowered = relative_path.to_ascii_lowercase();
    lowered.contains("/tests/")
        || lowered.contains("/__tests__/")
        || lowered.ends_with("_test.go")
        || lowered.ends_with("_test.rs")
        || lowered.contains(".test.")
        || lowered.contains(".spec.")
}

fn language_config_for_path(path: &str) -> Option<&'static LanguageConfig> {
    match Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "rs" => Some(&RUST_LANGUAGE),
        "ts" | "tsx" | "mts" | "cts" | "js" | "jsx" => Some(&TYPESCRIPT_LANGUAGE),
        "java" => Some(&JAVA_LANGUAGE),
        "go" => Some(&GO_LANGUAGE),
        "py" => Some(&PYTHON_LANGUAGE),
        _ => None,
    }
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string()
}

fn collect_repo_files(repo_root: &Path) -> Vec<String> {
    let mut files = Vec::new();
    collect_repo_files_inner(repo_root, repo_root, &mut files);
    files.sort();
    files
}

fn collect_repo_files_inner(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if matches!(
                name,
                ".git" | "target" | "node_modules" | ".next" | "dist" | "build"
            ) {
                continue;
            }
            collect_repo_files_inner(root, &path, out);
            continue;
        }
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        let rel = relative.to_string_lossy().replace('\\', "/");
        if language_config_for_path(&rel).is_some() {
            out.push(rel);
        }
    }
}

struct LanguageConfig {
    name: &'static str,
    parse_nodes: fn(&str, &str, tree_sitter::Node<'_>) -> Vec<ChangedNode>,
    parse_imports: fn(&Path, &str, &str, tree_sitter::Node<'_>) -> Vec<String>,
    companion_test_candidates: fn(&str) -> Vec<String>,
    is_test_file: fn(&str) -> bool,
    ts_language: fn() -> Language,
}

impl LanguageConfig {
    fn ts_language(&self) -> Language {
        (self.ts_language)()
    }
}

const RUST_LANGUAGE: LanguageConfig = LanguageConfig {
    name: "rust",
    parse_nodes: rust::parse_nodes,
    parse_imports: rust::parse_imports,
    companion_test_candidates: |_| Vec::new(),
    is_test_file: is_generic_test_file,
    ts_language: rust_language,
};

const TYPESCRIPT_LANGUAGE: LanguageConfig = LanguageConfig {
    name: "typescript",
    parse_nodes: typescript::parse_nodes,
    parse_imports: typescript::parse_imports,
    companion_test_candidates: typescript_companion_test_candidates,
    is_test_file: is_generic_test_file,
    ts_language: typescript_language,
};

const JAVA_LANGUAGE: LanguageConfig = LanguageConfig {
    name: "java",
    parse_nodes: java::parse_nodes,
    parse_imports: java::parse_imports,
    companion_test_candidates: java_companion_test_candidates,
    is_test_file: is_generic_test_file,
    ts_language: java_language,
};

const GO_LANGUAGE: LanguageConfig = LanguageConfig {
    name: "go",
    parse_nodes: go::parse_nodes,
    parse_imports: go::parse_imports,
    companion_test_candidates: go_companion_test_candidates,
    is_test_file: is_generic_test_file,
    ts_language: go_language,
};

const PYTHON_LANGUAGE: LanguageConfig = LanguageConfig {
    name: "python",
    parse_nodes: python::parse_nodes,
    parse_imports: python::parse_imports,
    companion_test_candidates: python_companion_test_candidates,
    is_test_file: is_generic_test_file,
    ts_language: python_language,
};

fn rust_language() -> Language {
    tree_sitter_rust::LANGUAGE.into()
}

fn typescript_language() -> Language {
    tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
}

fn java_language() -> Language {
    tree_sitter_java::LANGUAGE.into()
}

fn go_language() -> Language {
    tree_sitter_go::LANGUAGE.into()
}

fn python_language() -> Language {
    tree_sitter_python::LANGUAGE.into()
}
