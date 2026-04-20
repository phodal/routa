use super::{collect_identifier_mentions, resolve_relative_import};
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
        "function_declaration" => {
            if let Some(parsed) =
                parse_symbol(relative_path, source, node, "Function", parent_name, "")
            {
                out.push(parsed);
            }
        }
        "lexical_declaration" | "variable_declaration" => {
            for child in node.children(&mut node.walk()) {
                if child.kind() == "variable_declarator" {
                    if let Some(parsed) =
                        parse_variable_callable(relative_path, source, child, parent_name)
                    {
                        out.push(parsed);
                    }
                }
            }
        }
        "class_declaration" => {
            let extends = extract_extends(node, source);
            let class_name = node
                .child_by_field_name("name")
                .and_then(|child| child.utf8_text(source).ok())
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(ToString::to_string);
            if let Some(class_name) = class_name {
                out.push(ChangedNode {
                    qualified_name: format!("{relative_path}:{class_name}"),
                    name: class_name.clone(),
                    kind: "Class".to_string(),
                    file_path: relative_path.to_string(),
                    language: "typescript".to_string(),
                    is_test: false,
                    line_start: Some(node.start_position().row + 1),
                    line_end: Some(node.end_position().row + 1),
                    parent_name: parent_name.map(ToString::to_string),
                    references: Vec::new(),
                    extends,
                    mentions: collect_identifier_mentions(node, source),
                });
                for child in node.children(&mut node.walk()) {
                    collect_nodes(relative_path, source, child, Some(&class_name), out);
                }
                return;
            }
        }
        "method_definition" => {
            if let Some(parsed) =
                parse_symbol(relative_path, source, node, "Method", parent_name, "")
            {
                out.push(parsed);
            }
        }
        "interface_declaration" => {
            if let Some(parsed) =
                parse_symbol(relative_path, source, node, "Interface", parent_name, "")
            {
                out.push(parsed);
            }
        }
        "enum_declaration" => {
            if let Some(parsed) = parse_symbol(relative_path, source, node, "Enum", parent_name, "")
            {
                out.push(parsed);
            }
        }
        "call_expression" => {
            collect_test_calls(relative_path, source, node, out);
        }
        _ => {}
    }

    for child in node.children(&mut node.walk()) {
        collect_nodes(relative_path, source, child, parent_name, out);
    }
}

fn collect_imports(
    repo_root: &Path,
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    out: &mut Vec<String>,
) {
    if matches!(node.kind(), "import_statement" | "export_statement") {
        if let Some(import_path) = extract_import_literal(node, source) {
            if let Some(resolved) = resolve_relative_import(repo_root, relative_path, &import_path)
            {
                out.push(resolved);
            }
        }
    }

    for child in node.children(&mut node.walk()) {
        collect_imports(repo_root, relative_path, source, child, out);
    }
}

fn extract_import_literal(node: Node<'_>, source: &[u8]) -> Option<String> {
    for child in node.children(&mut node.walk()) {
        if child.kind() == "string" {
            let raw = child.utf8_text(source).ok()?.trim();
            let normalized = raw
                .trim_matches('"')
                .trim_matches('\'')
                .trim_matches('`')
                .trim()
                .to_string();
            if !normalized.is_empty() {
                return Some(normalized);
            }
        }
    }
    None
}

fn parse_symbol(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    kind: &str,
    parent_name: Option<&str>,
    extends: &str,
) -> Option<ChangedNode> {
    let name = node
        .child_by_field_name("name")
        .and_then(|child| child.utf8_text(source).ok())
        .map(str::trim)
        .filter(|name| !name.is_empty())?
        .to_string();
    let qualified_name = if let Some(parent) = parent_name {
        format!("{relative_path}:{parent}.{name}")
    } else {
        format!("{relative_path}:{name}")
    };
    Some(ChangedNode {
        qualified_name,
        name,
        kind: kind.to_string(),
        file_path: relative_path.to_string(),
        language: "typescript".to_string(),
        is_test: false,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: parent_name.map(ToString::to_string),
        references: Vec::new(),
        extends: extends.to_string(),
        mentions: collect_identifier_mentions(node, source),
    })
}

fn parse_variable_callable(
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
    let value = node.child_by_field_name("value")?;
    if !matches!(value.kind(), "arrow_function" | "function_expression") {
        return None;
    }
    let qualified_name = if let Some(parent) = parent_name {
        format!("{relative_path}:{parent}.{name}")
    } else {
        format!("{relative_path}:{name}")
    };
    Some(ChangedNode {
        qualified_name,
        name,
        kind: "Function".to_string(),
        file_path: relative_path.to_string(),
        language: "typescript".to_string(),
        is_test: false,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: parent_name.map(ToString::to_string),
        references: Vec::new(),
        extends: String::new(),
        mentions: collect_identifier_mentions(node, source),
    })
}

fn collect_test_calls(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    out: &mut Vec<ChangedNode>,
) {
    let Some(function) = node.child_by_field_name("function") else {
        return;
    };
    let Ok(callee) = function.utf8_text(source) else {
        return;
    };
    let callee = callee.trim();
    if !matches!(callee, "it" | "test" | "describe") {
        return;
    }

    let Some(arguments) = node.child_by_field_name("arguments") else {
        return;
    };
    let mut label = None;
    for child in arguments.children(&mut arguments.walk()) {
        if child.kind() == "string" || child.kind() == "template_string" {
            let raw = child.utf8_text(source).unwrap_or("").trim().to_string();
            let normalized = raw
                .trim_matches('`')
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();
            if !normalized.is_empty() {
                label = Some(normalized);
                break;
            }
        }
    }
    let Some(label) = label else {
        return;
    };

    out.push(ChangedNode {
        qualified_name: format!("{relative_path}:test:{}", node.start_position().row + 1),
        name: label.clone(),
        kind: "Test".to_string(),
        file_path: relative_path.to_string(),
        language: "typescript".to_string(),
        is_test: true,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: None,
        references: Vec::new(),
        extends: String::new(),
        mentions: vec![label],
    });
}

fn extract_extends(node: Node<'_>, source: &[u8]) -> String {
    for child in node.children(&mut node.walk()) {
        if child.kind() == "class_heritage" || child.kind() == "extends_clause" {
            let text = child.utf8_text(source).unwrap_or("").trim().to_string();
            if !text.is_empty() {
                return text
                    .strip_prefix("extends")
                    .map(str::trim)
                    .unwrap_or(text.as_str())
                    .to_string();
            }
        }
    }
    String::new()
}
