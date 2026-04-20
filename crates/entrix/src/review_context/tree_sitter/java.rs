use super::{collect_identifier_mentions, resolve_java_import};
use crate::review_context::model::ChangedNode;
use std::path::Path;
use tree_sitter::Node;

pub(super) fn parse_nodes(relative_path: &str, source: &str, root: Node<'_>) -> Vec<ChangedNode> {
    let mut nodes = Vec::new();
    let package_name = extract_package(root, source.as_bytes());
    collect_nodes(
        relative_path,
        source.as_bytes(),
        root,
        package_name.as_deref(),
        None,
        &mut nodes,
    );
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

fn collect_imports(
    repo_root: &Path,
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    out: &mut Vec<String>,
) {
    if node.kind() == "import_declaration" {
        if let Some((is_static, import_path)) = extract_import_text(node, source) {
            if let Some(resolved) =
                resolve_java_import(repo_root, relative_path, &import_path, is_static)
            {
                out.push(resolved);
            }
        }
        return;
    }

    for child in node.children(&mut node.walk()) {
        collect_imports(repo_root, relative_path, source, child, out);
    }
}

fn extract_import_text(node: Node<'_>, source: &[u8]) -> Option<(bool, String)> {
    let raw = node.utf8_text(source).ok()?.trim().to_string();
    if !raw.starts_with("import") {
        return None;
    }
    let mut body = raw
        .trim_start_matches("import")
        .trim()
        .trim_end_matches(';')
        .trim()
        .to_string();
    let mut is_static = false;
    if let Some(rest) = body.strip_prefix("static") {
        is_static = true;
        body = rest.trim().to_string();
    }
    let import_path = body.split_whitespace().next()?.to_string();
    Some((is_static, import_path))
}

fn collect_nodes(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    package_name: Option<&str>,
    parent_name: Option<&str>,
    out: &mut Vec<ChangedNode>,
) {
    match node.kind() {
        "class_declaration" => {
            let extends = extract_extends(node, source);
            if let Some(class_name) = find_identifier(node, source) {
                out.push(ChangedNode {
                    qualified_name: qualify_type_name(relative_path, package_name, &class_name),
                    name: class_name.clone(),
                    kind: "Class".to_string(),
                    file_path: relative_path.to_string(),
                    language: "java".to_string(),
                    is_test: false,
                    line_start: Some(node.start_position().row + 1),
                    line_end: Some(node.end_position().row + 1),
                    parent_name: parent_name.map(ToString::to_string),
                    references: Vec::new(),
                    extends,
                    mentions: collect_identifier_mentions(node, source),
                });
                for child in node.children(&mut node.walk()) {
                    collect_nodes(
                        relative_path,
                        source,
                        child,
                        package_name,
                        Some(&class_name),
                        out,
                    );
                }
                return;
            }
        }
        "interface_declaration" => {
            if let Some(parsed) = parse_type_node(
                relative_path,
                source,
                node,
                package_name,
                parent_name,
                "Interface",
            ) {
                out.push(parsed);
            }
        }
        "enum_declaration" => {
            if let Some(parsed) = parse_type_node(
                relative_path,
                source,
                node,
                package_name,
                parent_name,
                "Enum",
            ) {
                out.push(parsed);
            }
        }
        "method_declaration" | "constructor_declaration" => {
            if let Some(parsed) =
                parse_callable_node(relative_path, source, node, package_name, parent_name)
            {
                out.push(parsed);
            }
        }
        _ => {}
    }

    for child in node.children(&mut node.walk()) {
        collect_nodes(relative_path, source, child, package_name, parent_name, out);
    }
}

fn parse_type_node(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    package_name: Option<&str>,
    parent_name: Option<&str>,
    kind: &str,
) -> Option<ChangedNode> {
    let name = find_identifier(node, source)?;
    Some(ChangedNode {
        qualified_name: qualify_type_name(relative_path, package_name, &name),
        name,
        kind: kind.to_string(),
        file_path: relative_path.to_string(),
        language: "java".to_string(),
        is_test: false,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: parent_name.map(ToString::to_string),
        references: Vec::new(),
        extends: String::new(),
        mentions: collect_identifier_mentions(node, source),
    })
}

fn parse_callable_node(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    package_name: Option<&str>,
    parent_name: Option<&str>,
) -> Option<ChangedNode> {
    let name = find_identifier(node, source)?;
    let is_test = is_test_callable(node, source, &name);
    Some(ChangedNode {
        qualified_name: qualify_callable_name(relative_path, package_name, parent_name, &name),
        name,
        kind: if is_test {
            "Test".to_string()
        } else {
            "Method".to_string()
        },
        file_path: relative_path.to_string(),
        language: "java".to_string(),
        is_test,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: parent_name.map(ToString::to_string),
        references: collect_identifier_mentions(node, source)
            .into_iter()
            .filter(|item| item != "Override" && item != "Test")
            .collect(),
        extends: String::new(),
        mentions: collect_identifier_mentions(node, source),
    })
}

fn extract_package(node: Node<'_>, source: &[u8]) -> Option<String> {
    for child in node.children(&mut node.walk()) {
        if child.kind() == "package_declaration" {
            for inner in child.children(&mut child.walk()) {
                if matches!(inner.kind(), "scoped_identifier" | "identifier") {
                    let value = inner.utf8_text(source).ok()?.trim().to_string();
                    if !value.is_empty() {
                        return Some(value);
                    }
                }
            }
        }
    }
    None
}

fn extract_extends(node: Node<'_>, source: &[u8]) -> String {
    for child in node.children(&mut node.walk()) {
        if child.kind() == "superclass" || child.kind() == "super_interfaces" {
            let text = child.utf8_text(source).unwrap_or("").trim().to_string();
            if !text.is_empty() {
                return text;
            }
        }
    }
    String::new()
}

fn find_identifier(node: Node<'_>, source: &[u8]) -> Option<String> {
    for child in node.children(&mut node.walk()) {
        if child.kind() == "identifier" {
            let value = child.utf8_text(source).ok()?.trim().to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

fn qualify_type_name(relative_path: &str, package_name: Option<&str>, name: &str) -> String {
    if let Some(package_name) = package_name {
        format!("{relative_path}:{package_name}.{name}")
    } else {
        format!("{relative_path}:{name}")
    }
}

fn qualify_callable_name(
    relative_path: &str,
    package_name: Option<&str>,
    parent_name: Option<&str>,
    name: &str,
) -> String {
    match (package_name, parent_name) {
        (Some(package_name), Some(parent_name)) => {
            format!("{relative_path}:{package_name}.{parent_name}.{name}")
        }
        (_, Some(parent_name)) => format!("{relative_path}:{parent_name}.{name}"),
        (Some(package_name), None) => format!("{relative_path}:{package_name}.{name}"),
        (None, None) => format!("{relative_path}:{name}"),
    }
}

fn is_test_callable(node: Node<'_>, source: &[u8], name: &str) -> bool {
    if name.starts_with("test") {
        return true;
    }
    let text = node.utf8_text(source).unwrap_or("");
    text.contains("@Test")
}
