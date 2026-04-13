mod go;
mod java;
mod rust;
mod typescript;

use super::model::{
    ChangedNode, FileGraphNode, GraphNodePayload, ParsedReviewGraph, SymbolGraphNode,
};
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use tree_sitter::{Language, Parser};

pub fn parse_changed_files(repo_root: &Path, changed_files: &[String]) -> ParsedReviewGraph {
    let mut changed_nodes = Vec::new();
    let mut related_test_nodes = Vec::new();
    let mut files_updated = 0usize;
    let mut languages = BTreeSet::new();
    let mut total_edges = 0usize;
    let mut related_test_files = BTreeSet::new();

    for relative_path in changed_files {
        let full_path = repo_root.join(relative_path);
        let Ok(source) = fs::read_to_string(&full_path) else {
            continue;
        };
        let Some(language) = language_for_path(relative_path) else {
            continue;
        };
        files_updated += 1;
        languages.insert(language.name().to_string());

        changed_nodes.push(ChangedNode {
            qualified_name: relative_path.clone(),
            name: file_name(relative_path),
            kind: "File".to_string(),
            file_path: relative_path.clone(),
            language: language.name().to_string(),
            is_test: false,
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

        let mut file_nodes = match language {
            SupportedLanguage::Rust => rust::parse_nodes(relative_path, &source, tree.root_node()),
            SupportedLanguage::TypeScript => {
                typescript::parse_nodes(relative_path, &source, tree.root_node())
            }
            SupportedLanguage::Java => java::parse_nodes(relative_path, &source, tree.root_node()),
            SupportedLanguage::Go => go::parse_nodes(relative_path, &source, tree.root_node()),
        };
        total_edges += file_nodes.len();
        changed_nodes.append(&mut file_nodes);

        if !is_test_file(relative_path) {
            for candidate in companion_test_candidates(relative_path) {
                if changed_files.contains(&candidate) || !repo_root.join(&candidate).is_file() {
                    continue;
                }
                if !related_test_files.insert(candidate.clone()) {
                    continue;
                }
                let Ok(test_source) = fs::read_to_string(repo_root.join(&candidate)) else {
                    continue;
                };
                let Some(test_language) = language_for_path(&candidate) else {
                    continue;
                };
                let mut parser = Parser::new();
                if parser.set_language(&test_language.ts_language()).is_err() {
                    continue;
                }
                let Some(test_tree) = parser.parse(&test_source, None) else {
                    continue;
                };
                let mut test_nodes = match test_language {
                    SupportedLanguage::Rust => {
                        rust::parse_nodes(&candidate, &test_source, test_tree.root_node())
                    }
                    SupportedLanguage::TypeScript => {
                        typescript::parse_nodes(&candidate, &test_source, test_tree.root_node())
                    }
                    SupportedLanguage::Java => {
                        java::parse_nodes(&candidate, &test_source, test_tree.root_node())
                    }
                    SupportedLanguage::Go => {
                        go::parse_nodes(&candidate, &test_source, test_tree.root_node())
                    }
                };
                total_edges += test_nodes.len();
                related_test_nodes.append(&mut test_nodes);
            }
        }
    }

    let target_tests = derive_target_tests(&changed_nodes, &related_test_nodes);
    total_edges += target_tests.len();

    ParsedReviewGraph {
        changed_nodes,
        related_test_nodes,
        target_tests,
        files_updated,
        total_edges,
        languages: languages.into_iter().collect(),
    }
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

fn derive_target_tests(
    changed_nodes: &[ChangedNode],
    related_test_nodes: &[ChangedNode],
) -> Vec<(String, String)> {
    let targets: Vec<&ChangedNode> = changed_nodes
        .iter()
        .filter(|node| node.kind != "File" && !node.is_test)
        .collect();
    let tests: Vec<&ChangedNode> = changed_nodes
        .iter()
        .chain(related_test_nodes.iter())
        .filter(|node| node.is_test)
        .collect();
    let mut edges = Vec::new();
    for target in targets {
        for test in &tests {
            if test_targets_node(test, target) {
                edges.push((target.qualified_name.clone(), test.qualified_name.clone()));
            }
        }
    }
    edges
}

fn test_targets_node(test: &ChangedNode, target: &ChangedNode) -> bool {
    if test.file_path == target.file_path && test.mentions.iter().any(|name| name == &target.name) {
        return true;
    }
    if test.mentions.iter().any(|name| name == &target.name) {
        return true;
    }

    let test_name_lower = test.name.to_ascii_lowercase();
    let target_name_lower = target.name.to_ascii_lowercase();
    if test_name_lower.contains(&target_name_lower) {
        return true;
    }

    if let Some(parent_name) = target.parent_name.as_deref() {
        let parent_lower = parent_name.to_ascii_lowercase();
        if test_name_lower.contains(&parent_lower) {
            return true;
        }
    }
    false
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

fn companion_test_candidates(relative_path: &str) -> Vec<String> {
    match Path::new(relative_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "java" => java_companion_test_candidates(relative_path),
        "go" => go_companion_test_candidates(relative_path),
        "ts" | "tsx" | "mts" | "cts" | "js" | "jsx" => {
            typescript_companion_test_candidates(relative_path)
        }
        _ => Vec::new(),
    }
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

fn is_test_file(relative_path: &str) -> bool {
    let lowered = relative_path.to_ascii_lowercase();
    lowered.contains("/src/test/java/")
        || lowered.ends_with("_test.go")
        || lowered.contains(".test.")
        || lowered.contains(".spec.")
}

fn language_for_path(path: &str) -> Option<SupportedLanguage> {
    match Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "rs" => Some(SupportedLanguage::Rust),
        "ts" | "tsx" | "mts" | "cts" | "js" | "jsx" => Some(SupportedLanguage::TypeScript),
        "java" => Some(SupportedLanguage::Java),
        "go" => Some(SupportedLanguage::Go),
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

#[derive(Debug, Clone, Copy)]
enum SupportedLanguage {
    Rust,
    TypeScript,
    Java,
    Go,
}

impl SupportedLanguage {
    fn name(self) -> &'static str {
        match self {
            Self::Rust => "rust",
            Self::TypeScript => "typescript",
            Self::Java => "java",
            Self::Go => "go",
        }
    }

    fn ts_language(self) -> Language {
        match self {
            Self::Rust => tree_sitter_rust::LANGUAGE.into(),
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Self::Java => tree_sitter_java::LANGUAGE.into(),
            Self::Go => tree_sitter_go::LANGUAGE.into(),
        }
    }
}
