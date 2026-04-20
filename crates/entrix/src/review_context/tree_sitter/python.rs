use super::{collect_identifier_mentions, resolve_python_import};
use crate::review_context::model::ChangedNode;
use std::path::Path;
use tree_sitter::Node;

pub(super) fn parse_nodes(relative_path: &str, source: &str, root: Node<'_>) -> Vec<ChangedNode> {
    let mut nodes = Vec::new();
    collect_nodes(relative_path, source.as_bytes(), root, None, &mut nodes);
    nodes
}

pub(super) fn parse_imports(
    repo_root: &Path,
    relative_path: &str,
    source: &str,
    root: Node<'_>,
) -> Vec<String> {
    let mut imports = Vec::new();
    collect_imports(
        repo_root,
        relative_path,
        source.as_bytes(),
        root,
        &mut imports,
    );
    imports.sort();
    imports.dedup();
    imports
}

fn collect_nodes(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    parent_name: Option<&str>,
    out: &mut Vec<ChangedNode>,
) {
    match node.kind() {
        "function_definition" => {
            if let Some(parsed) = parse_function(relative_path, source, node, parent_name) {
                out.push(parsed);
            }
        }
        "class_definition" => {
            if let Some(parsed) = parse_class(relative_path, source, node) {
                let class_name = parsed.name.clone();
                out.push(parsed);
                for child in node.children(&mut node.walk()) {
                    collect_nodes(relative_path, source, child, Some(&class_name), out);
                }
                return;
            }
        }
        _ => {}
    }

    for child in node.children(&mut node.walk()) {
        collect_nodes(relative_path, source, child, parent_name, out);
    }
}

fn parse_function(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    parent_name: Option<&str>,
) -> Option<ChangedNode> {
    let name = node
        .child_by_field_name("name")
        .and_then(|child| child.utf8_text(source).ok())
        .map(str::trim)
        .filter(|name| !name.is_empty())?
        .to_string();
    let is_test = name.starts_with("test");
    let qualified_name = if let Some(parent_name) = parent_name {
        format!("{relative_path}:{parent_name}.{name}")
    } else {
        format!("{relative_path}:{name}")
    };
    Some(ChangedNode {
        qualified_name,
        name,
        kind: if is_test {
            "Test".to_string()
        } else {
            "Function".to_string()
        },
        file_path: relative_path.to_string(),
        language: "python".to_string(),
        is_test,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: parent_name.map(ToString::to_string),
        references: collect_identifier_mentions(node, source),
        extends: String::new(),
        mentions: collect_identifier_mentions(node, source),
    })
}

fn parse_class(relative_path: &str, source: &[u8], node: Node<'_>) -> Option<ChangedNode> {
    let name = node
        .child_by_field_name("name")
        .and_then(|child| child.utf8_text(source).ok())
        .map(str::trim)
        .filter(|name| !name.is_empty())?
        .to_string();
    Some(ChangedNode {
        qualified_name: format!("{relative_path}:{name}"),
        name,
        kind: "Class".to_string(),
        file_path: relative_path.to_string(),
        language: "python".to_string(),
        is_test: false,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: None,
        references: Vec::new(),
        extends: String::new(),
        mentions: collect_identifier_mentions(node, source),
    })
}

fn collect_imports(
    repo_root: &Path,
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    out: &mut Vec<String>,
) {
    if node.kind() == "import_from_statement" {
        if let Ok(text) = node.utf8_text(source) {
            if let Some(relative) = extract_relative_import(text.trim()) {
                if let Some(resolved) = resolve_python_import(repo_root, relative_path, &relative) {
                    out.push(resolved);
                }
            }
        }
    }

    for child in node.children(&mut node.walk()) {
        collect_imports(repo_root, relative_path, source, child, out);
    }
}

fn extract_relative_import(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if !trimmed.starts_with("from .") {
        return None;
    }
    let after_from = trimmed.strip_prefix("from ")?;
    let module = after_from.split_whitespace().next()?.trim();
    Some(module.to_string())
}
