use super::{collect_identifier_mentions, parse_named_node, resolve_rust_import};
use crate::review_context::model::ChangedNode;
use std::collections::BTreeSet;
use std::path::Path;
use tree_sitter::Node;

pub(super) fn parse_nodes(relative_path: &str, source: &str, root: Node<'_>) -> Vec<ChangedNode> {
    let mut nodes = Vec::new();
    collect_nodes(relative_path, source.as_bytes(), root, &mut nodes);
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

fn collect_nodes(relative_path: &str, source: &[u8], node: Node<'_>, out: &mut Vec<ChangedNode>) {
    match node.kind() {
        "function_item" => {
            if let Some(parsed) = parse_function(relative_path, source, node) {
                out.push(parsed);
            }
        }
        "struct_item" => {
            if let Some(parsed) = parse_named_node(relative_path, source, node, "Class", "rust") {
                out.push(parsed);
            }
        }
        "trait_item" => {
            if let Some(parsed) = parse_named_node(relative_path, source, node, "Interface", "rust")
            {
                out.push(parsed);
            }
        }
        "enum_item" => {
            if let Some(parsed) = parse_named_node(relative_path, source, node, "Enum", "rust") {
                out.push(parsed);
            }
        }
        _ => {}
    }

    for child in node.children(&mut node.walk()) {
        collect_nodes(relative_path, source, child, out);
    }
}

fn collect_imports(
    repo_root: &Path,
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    out: &mut Vec<String>,
) {
    if node.kind() == "use_declaration" {
        if let Ok(text) = node.utf8_text(source) {
            if let Some(resolved) = resolve_rust_import(repo_root, relative_path, text.trim()) {
                out.push(resolved);
            }
        }
    }

    for child in node.children(&mut node.walk()) {
        collect_imports(repo_root, relative_path, source, child, out);
    }
}

fn parse_function(relative_path: &str, source: &[u8], node: Node<'_>) -> Option<ChangedNode> {
    let name = node
        .child_by_field_name("name")
        .and_then(|child| child.utf8_text(source).ok())
        .map(str::trim)
        .filter(|name| !name.is_empty())?
        .to_string();
    let is_test = is_test_function(node, source, &name);
    Some(ChangedNode {
        qualified_name: format!("{relative_path}:{name}"),
        name,
        kind: if is_test {
            "Test".to_string()
        } else {
            "Function".to_string()
        },
        file_path: relative_path.to_string(),
        language: "rust".to_string(),
        is_test,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: None,
        references: collect_macro_references(node, source),
        extends: String::new(),
        mentions: collect_identifier_mentions(node, source),
    })
}

fn is_test_function(node: Node<'_>, source: &[u8], name: &str) -> bool {
    if name.starts_with("test_") {
        return true;
    }
    let mut sibling = node.prev_named_sibling();
    while let Some(prev) = sibling {
        if prev.kind() != "attribute_item" {
            break;
        }
        if prev
            .utf8_text(source)
            .map(|text| text.contains("#[test]") || text.contains("::test]"))
            .unwrap_or(false)
        {
            return true;
        }
        sibling = prev.prev_named_sibling();
    }
    false
}

fn collect_macro_references(node: Node<'_>, source: &[u8]) -> Vec<String> {
    let mut refs = BTreeSet::new();
    collect_macro_references_inner(node, source, &mut refs);
    refs.into_iter().collect()
}

fn collect_macro_references_inner(node: Node<'_>, source: &[u8], out: &mut BTreeSet<String>) {
    if node.kind() == "macro_invocation" {
        if let Some(child) = node.child_by_field_name("macro") {
            if let Ok(name) = child.utf8_text(source) {
                let normalized = name.trim().trim_end_matches('!').to_string();
                if !normalized.is_empty() {
                    out.insert(normalized);
                }
            }
        }
    }

    for child in node.children(&mut node.walk()) {
        collect_macro_references_inner(child, source, out);
    }
}
