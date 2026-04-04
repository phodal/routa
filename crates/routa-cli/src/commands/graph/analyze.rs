//! TreeSitter-backed dependency graph analyzer for Rust and TypeScript code.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use tree_sitter::{Language, Node, Parser};
use walkdir::WalkDir;

use crate::commands::graph::{AnalyzeArgs, GraphOutputFormat};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphNode {
    pub id: String,
    pub path: String,
    pub language: String,
    pub kind: NodeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    File,
    ExternalCrate,
    ExternalPackage,
    UnresolvedModule,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
    pub kind: EdgeKind,
    pub specifier: String,
    pub resolved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    Uses,
    Imports,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyGraph {
    pub generated_at: String,
    pub root_dir: String,
    pub language: String,
    pub node_count: usize,
    pub edge_count: usize,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnalysisLang {
    Auto,
    Rust,
    TypeScript,
}

#[derive(Debug, Clone)]
struct RustWorkspaceContext {
    crates: Vec<RustCrate>,
    local_import_roots: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
struct RustCrate {
    src_dir: PathBuf,
    entry_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ResolvedDependency {
    LocalFile(String),
    External(NodeKind, String),
    Unresolved(String),
}

pub fn run_analyze(args: &AnalyzeArgs) -> Result<(), String> {
    let root = match &args.dir {
        Some(dir) => PathBuf::from(dir),
        None => {
            std::env::current_dir().map_err(|error| format!("failed to determine cwd: {error}"))?
        }
    };

    if !root.exists() {
        return Err(format!("directory does not exist: {}", root.display()));
    }

    let graph = analyze_directory(&root, args.lang.into_analysis_lang());
    let output = match args.format {
        GraphOutputFormat::Json => serde_json::to_string_pretty(&graph)
            .map_err(|error| format!("failed to serialize graph: {error}"))?,
        GraphOutputFormat::Dot => render_dot(&graph),
    };

    if let Some(path) = &args.output {
        fs::write(path, &output)
            .map_err(|error| format!("failed to write graph output {}: {error}", path))?;
        println!("Graph written to: {path}");
    } else {
        println!("{output}");
    }

    Ok(())
}

pub fn analyze_directory(root: &Path, requested_lang: AnalysisLang) -> DependencyGraph {
    let rust_workspace = build_rust_workspace_context(root);
    let mut nodes: BTreeMap<String, GraphNode> = BTreeMap::new();
    let mut edges = BTreeSet::new();

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !is_ignored_path(entry.path()))
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
    {
        let path = entry.path();
        let effective_lang = match effective_lang_for_path(path, requested_lang) {
            Some(lang) => lang,
            None => continue,
        };

        let relative_path = repo_relative_path(root, path);
        let language = display_language(effective_lang).to_string();
        nodes
            .entry(relative_path.clone())
            .or_insert_with(|| GraphNode {
                id: relative_path.clone(),
                path: relative_path.clone(),
                language: language.clone(),
                kind: NodeKind::File,
            });

        let source = match fs::read_to_string(path) {
            Ok(source) => source,
            Err(_) => continue,
        };

        let specifiers = match effective_lang {
            AnalysisLang::Rust => extract_rust_uses(&source),
            AnalysisLang::TypeScript => extract_typescript_imports(&source),
            AnalysisLang::Auto => continue,
        };

        for specifier in specifiers {
            let resolved = match effective_lang {
                AnalysisLang::Rust => {
                    resolve_rust_dependency(root, path, &specifier, &rust_workspace)
                }
                AnalysisLang::TypeScript => resolve_typescript_dependency(root, path, &specifier),
                AnalysisLang::Auto => continue,
            };

            let (target_id, target_kind, resolved_flag) = match resolved {
                ResolvedDependency::LocalFile(path) => (path, NodeKind::File, true),
                ResolvedDependency::External(kind, id) => (id.clone(), kind, false),
                ResolvedDependency::Unresolved(id) => {
                    (id.clone(), NodeKind::UnresolvedModule, false)
                }
            };

            nodes.entry(target_id.clone()).or_insert_with(|| GraphNode {
                id: target_id.clone(),
                path: target_id.clone(),
                language: language.clone(),
                kind: target_kind,
            });

            edges.insert((
                relative_path.clone(),
                target_id,
                match effective_lang {
                    AnalysisLang::Rust => EdgeKind::Uses,
                    AnalysisLang::TypeScript => EdgeKind::Imports,
                    AnalysisLang::Auto => unreachable!(),
                },
                specifier,
                resolved_flag,
            ));
        }
    }

    let edges = edges
        .into_iter()
        .map(|(from, to, kind, specifier, resolved)| GraphEdge {
            from,
            to,
            kind,
            specifier,
            resolved,
        })
        .collect::<Vec<_>>();

    let nodes = nodes.into_values().collect::<Vec<_>>();
    DependencyGraph {
        generated_at: chrono::Utc::now().to_rfc3339(),
        root_dir: root.display().to_string(),
        language: display_language(requested_lang).to_string(),
        node_count: nodes.len(),
        edge_count: edges.len(),
        nodes,
        edges,
    }
}

pub fn render_dot(graph: &DependencyGraph) -> String {
    let mut out = String::from("digraph dependencies {\n");
    out.push_str("  rankdir=LR;\n");
    out.push_str("  node [shape=box];\n");

    for node in &graph.nodes {
        let label = node.id.replace('"', "\\\"");
        out.push_str(&format!("  \"{}\" [label=\"{}\"];\n", label, label));
    }

    for edge in &graph.edges {
        let from = edge.from.replace('"', "\\\"");
        let to = edge.to.replace('"', "\\\"");
        out.push_str(&format!("  \"{}\" -> \"{}\";\n", from, to));
    }

    out.push_str("}\n");
    out
}

fn display_language(value: AnalysisLang) -> &'static str {
    match value {
        AnalysisLang::Auto => "auto",
        AnalysisLang::Rust => "rust",
        AnalysisLang::TypeScript => "typescript",
    }
}

fn effective_lang_for_path(path: &Path, requested_lang: AnalysisLang) -> Option<AnalysisLang> {
    match requested_lang {
        AnalysisLang::Rust => match path.extension().and_then(|ext| ext.to_str()) {
            Some("rs") => Some(AnalysisLang::Rust),
            _ => None,
        },
        AnalysisLang::TypeScript => match path.extension().and_then(|ext| ext.to_str()) {
            Some("ts" | "tsx" | "mts" | "cts") => Some(AnalysisLang::TypeScript),
            _ => None,
        },
        AnalysisLang::Auto => match path.extension().and_then(|ext| ext.to_str()) {
            Some("rs") => Some(AnalysisLang::Rust),
            Some("ts" | "tsx" | "mts" | "cts") => Some(AnalysisLang::TypeScript),
            _ => None,
        },
    }
}

fn is_ignored_path(path: &Path) -> bool {
    const IGNORED: &[&str] = &[
        ".git",
        ".next",
        ".routa",
        ".worktrees",
        "build",
        "coverage",
        "dist",
        "node_modules",
        "out",
        "target",
    ];

    path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .map(|value| IGNORED.contains(&value))
            .unwrap_or(false)
    })
}

fn rust_language() -> Language {
    tree_sitter_rust::LANGUAGE.into()
}

fn typescript_language() -> Language {
    tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
}

fn extract_rust_uses(source: &str) -> Vec<String> {
    let mut parser = Parser::new();
    parser
        .set_language(&rust_language())
        .expect("Rust grammar load failed");

    let Some(tree) = parser.parse(source, None) else {
        return Vec::new();
    };

    let mut paths = Vec::new();
    collect_rust_uses(tree.root_node(), source.as_bytes(), &mut paths);
    paths.sort();
    paths.dedup();
    paths
}

fn collect_rust_uses(node: Node<'_>, source: &[u8], out: &mut Vec<String>) {
    if node.kind() == "use_declaration" {
        if let Some(path_node) = node.child_by_field_name("argument") {
            let raw = path_node.utf8_text(source).unwrap_or("").trim().to_string();
            if !raw.is_empty() {
                out.push(raw);
            }
        }
    }

    for child in node.children(&mut node.walk()) {
        collect_rust_uses(child, source, out);
    }
}

fn extract_typescript_imports(source: &str) -> Vec<String> {
    let mut parser = Parser::new();
    parser
        .set_language(&typescript_language())
        .expect("TypeScript grammar load failed");

    let Some(tree) = parser.parse(source, None) else {
        return Vec::new();
    };

    let mut imports = Vec::new();
    collect_typescript_specifiers(tree.root_node(), source.as_bytes(), &mut imports);
    imports.sort();
    imports.dedup();
    imports
}

fn collect_typescript_specifiers(node: Node<'_>, source: &[u8], out: &mut Vec<String>) {
    if matches!(node.kind(), "import_statement" | "export_statement") {
        if let Some(source_node) = node.child_by_field_name("source") {
            let raw = source_node
                .utf8_text(source)
                .unwrap_or("")
                .trim()
                .to_string();
            let specifier = raw.trim_matches(|ch| ch == '"' || ch == '\'').to_string();
            if !specifier.is_empty() {
                out.push(specifier);
            }
        }
    }

    for child in node.children(&mut node.walk()) {
        collect_typescript_specifiers(child, source, out);
    }
}

fn resolve_typescript_dependency(
    root: &Path,
    importer: &Path,
    specifier: &str,
) -> ResolvedDependency {
    let candidate = if specifier.starts_with("./") || specifier.starts_with("../") {
        importer
            .parent()
            .map(|dir| normalize_path(&dir.join(specifier)))
    } else {
        specifier
            .strip_prefix("@/")
            .map(|path| normalize_path(&root.join("src").join(path)))
    };

    if let Some(candidate) = candidate {
        if let Some(resolved) = resolve_typescript_local_candidate(&candidate) {
            return ResolvedDependency::LocalFile(repo_relative_path(root, &resolved));
        }
        return ResolvedDependency::Unresolved(specifier.to_string());
    }

    ResolvedDependency::External(
        NodeKind::ExternalPackage,
        package_id_from_specifier(specifier),
    )
}

fn resolve_typescript_local_candidate(candidate: &Path) -> Option<PathBuf> {
    if candidate.is_file() {
        return Some(candidate.to_path_buf());
    }

    if candidate.extension().is_none() {
        for extension in [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".d.ts"] {
            let resolved = PathBuf::from(format!("{}{}", candidate.display(), extension));
            if resolved.is_file() {
                return Some(resolved);
            }
        }
    }

    if candidate.is_dir() {
        for index in [
            "index.ts",
            "index.tsx",
            "index.mts",
            "index.cts",
            "index.js",
            "index.jsx",
            "index.d.ts",
        ] {
            let resolved = candidate.join(index);
            if resolved.is_file() {
                return Some(resolved);
            }
        }
    }

    None
}

fn package_id_from_specifier(specifier: &str) -> String {
    if specifier.starts_with("node:") {
        return specifier.to_string();
    }

    if let Some(rest) = specifier.strip_prefix('@') {
        let mut segments = rest.split('/');
        if let (Some(scope), Some(package)) = (segments.next(), segments.next()) {
            return format!("@{scope}/{package}");
        }
    }

    specifier.split('/').next().unwrap_or(specifier).to_string()
}

fn build_rust_workspace_context(root: &Path) -> RustWorkspaceContext {
    let mut crates = Vec::new();
    let mut local_import_roots = BTreeMap::new();

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !is_ignored_path(entry.path()))
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file() && entry.file_name() == "Cargo.toml")
    {
        let manifest_path = entry.path();
        let Ok(contents) = fs::read_to_string(manifest_path) else {
            continue;
        };
        let Some(package_name) = parse_cargo_package_name(&contents) else {
            continue;
        };

        let crate_dir = manifest_path.parent().unwrap_or(root);
        let src_dir = crate_dir.join("src");
        if !src_dir.is_dir() {
            continue;
        }

        let entry_file = if src_dir.join("lib.rs").is_file() {
            src_dir.join("lib.rs")
        } else if src_dir.join("main.rs").is_file() {
            src_dir.join("main.rs")
        } else {
            continue;
        };

        let import_root = package_name.replace('-', "_");
        let entry_path = repo_relative_path(root, &entry_file);
        local_import_roots.insert(import_root.clone(), entry_path.clone());
        crates.push(RustCrate {
            src_dir,
            entry_path,
        });
    }

    crates.sort_by(|left, right| {
        right
            .src_dir
            .components()
            .count()
            .cmp(&left.src_dir.components().count())
    });
    RustWorkspaceContext {
        crates,
        local_import_roots,
    }
}

fn parse_cargo_package_name(contents: &str) -> Option<String> {
    let mut in_package = false;

    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_package = trimmed == "[package]";
            continue;
        }

        if !in_package || !trimmed.starts_with("name") {
            continue;
        }

        let value = trimmed.split_once('=')?.1.trim();
        if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
            return Some(value.trim_matches('"').to_string());
        }
    }

    None
}

fn resolve_rust_dependency(
    root: &Path,
    importer: &Path,
    specifier: &str,
    workspace: &RustWorkspaceContext,
) -> ResolvedDependency {
    let normalized = normalize_rust_use_specifier(specifier);
    if normalized.is_empty() {
        return ResolvedDependency::Unresolved(specifier.to_string());
    }

    let owning_crate = workspace
        .crates
        .iter()
        .find(|crate_info| importer.starts_with(&crate_info.src_dir));

    if let Some(crate_info) = owning_crate {
        if normalized == "crate" {
            return ResolvedDependency::LocalFile(crate_info.entry_path.clone());
        }

        if let Some(rest) = normalized.strip_prefix("crate::") {
            if let Some(path) = resolve_rust_module_path(root, crate_info, &[], rest) {
                return ResolvedDependency::LocalFile(path);
            }
        }

        if normalized.starts_with("self::") {
            let base = rust_module_segments(importer, crate_info);
            if let Some(path) = resolve_rust_module_path(
                root,
                crate_info,
                &base,
                normalized.trim_start_matches("self::"),
            ) {
                return ResolvedDependency::LocalFile(path);
            }
        }

        if normalized.starts_with("super::") {
            let mut base = rust_module_segments(importer, crate_info);
            let mut rest = normalized.as_str();
            while let Some(next) = rest.strip_prefix("super::") {
                if !base.is_empty() {
                    base.pop();
                }
                rest = next;
            }
            if let Some(path) = resolve_rust_module_path(root, crate_info, &base, rest) {
                return ResolvedDependency::LocalFile(path);
            }
        }

        if let Some(path) = resolve_rust_module_path(root, crate_info, &[], &normalized) {
            return ResolvedDependency::LocalFile(path);
        }
    }

    let first_segment = normalized.split("::").next().unwrap_or("");
    if let Some(path) = workspace.local_import_roots.get(first_segment) {
        return ResolvedDependency::LocalFile(path.clone());
    }

    if !first_segment.is_empty() {
        return ResolvedDependency::External(NodeKind::ExternalCrate, first_segment.to_string());
    }

    ResolvedDependency::Unresolved(specifier.to_string())
}

fn normalize_rust_use_specifier(specifier: &str) -> String {
    let mut value = specifier.trim().trim_start_matches("::").to_string();
    if let Some((head, _)) = value.split_once(" as ") {
        value = head.trim().to_string();
    }
    if let Some(index) = value.find('{') {
        value = value[..index].trim_end_matches("::").trim().to_string();
    }
    value
}

fn rust_module_segments(importer: &Path, crate_info: &RustCrate) -> Vec<String> {
    let Ok(relative) = importer.strip_prefix(&crate_info.src_dir) else {
        return Vec::new();
    };

    let file_name = relative.file_name().and_then(|name| name.to_str());
    match file_name {
        Some("lib.rs") | Some("main.rs") => Vec::new(),
        Some("mod.rs") => relative
            .parent()
            .into_iter()
            .flat_map(Path::components)
            .filter_map(|component| component.as_os_str().to_str().map(str::to_string))
            .collect(),
        _ => relative
            .with_extension("")
            .components()
            .filter_map(|component| component.as_os_str().to_str().map(str::to_string))
            .collect(),
    }
}

fn resolve_rust_module_path(
    root: &Path,
    crate_info: &RustCrate,
    base_segments: &[String],
    rest: &str,
) -> Option<String> {
    let mut segments = base_segments.to_vec();
    segments.extend(
        rest.split("::")
            .filter(|segment| !segment.is_empty())
            .map(str::to_string),
    );

    if segments.is_empty() {
        return Some(crate_info.entry_path.clone());
    }

    for length in (1..=segments.len()).rev() {
        let mut module_base = crate_info.src_dir.clone();
        for segment in &segments[..length] {
            module_base.push(segment);
        }

        for candidate in [module_base.with_extension("rs"), module_base.join("mod.rs")] {
            if candidate.is_file() {
                return Some(repo_relative_path(root, &candidate));
            }
        }
    }

    None
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

fn repo_relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn write_file(dir: &TempDir, relative: &str, content: &str) -> PathBuf {
        let path = dir.path().join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(content.as_bytes()).unwrap();
        path
    }

    #[test]
    fn extracts_rust_use_paths() {
        let source = r#"
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use crate::state::AppState;
"#;

        let uses = extract_rust_uses(source);
        assert!(uses.contains(&"std::collections::HashMap".to_string()));
        assert!(uses.contains(&"serde::{Deserialize, Serialize}".to_string()));
        assert!(uses.contains(&"crate::state::AppState".to_string()));
    }

    #[test]
    fn extracts_typescript_imports_and_exports() {
        let source = r#"
import React from "react";
import { helper } from "../lib/paths";
export { feature } from "@/core/feature";
"#;

        let imports = extract_typescript_imports(source);
        assert!(imports.contains(&"react".to_string()));
        assert!(imports.contains(&"../lib/paths".to_string()));
        assert!(imports.contains(&"@/core/feature".to_string()));
    }

    #[test]
    fn resolves_typescript_relative_and_alias_imports_to_repo_files() {
        let dir = TempDir::new().unwrap();
        let importer = write_file(
            &dir,
            "src/app/page.ts",
            r#"import { feature } from "@/core/feature";
import { helper } from "../lib/helper";"#,
        );
        write_file(&dir, "src/core/feature.ts", "export const feature = true;");
        write_file(&dir, "src/lib/helper.ts", "export const helper = true;");

        let alias = resolve_typescript_dependency(dir.path(), &importer, "@/core/feature");
        let relative = resolve_typescript_dependency(dir.path(), &importer, "../lib/helper");

        assert_eq!(
            alias,
            ResolvedDependency::LocalFile("src/core/feature.ts".to_string())
        );
        assert_eq!(
            relative,
            ResolvedDependency::LocalFile("src/lib/helper.ts".to_string())
        );
    }

    #[test]
    fn resolves_workspace_crate_imports_to_local_entry_files() {
        let dir = TempDir::new().unwrap();
        write_file(
            &dir,
            "crates/alpha/Cargo.toml",
            r#"[package]
name = "alpha"
version = "0.1.0"
edition = "2021"
"#,
        );
        let importer = write_file(
            &dir,
            "crates/alpha/src/lib.rs",
            "use beta::service::run;\nuse crate::state::AppState;\n",
        );
        write_file(&dir, "crates/alpha/src/state.rs", "pub struct AppState;");
        write_file(
            &dir,
            "crates/beta/Cargo.toml",
            r#"[package]
name = "beta"
version = "0.1.0"
edition = "2021"
"#,
        );
        write_file(&dir, "crates/beta/src/lib.rs", "pub mod service;");

        let workspace = build_rust_workspace_context(dir.path());
        let external =
            resolve_rust_dependency(dir.path(), &importer, "beta::service::run", &workspace);
        let internal =
            resolve_rust_dependency(dir.path(), &importer, "crate::state::AppState", &workspace);

        assert_eq!(
            external,
            ResolvedDependency::LocalFile("crates/beta/src/lib.rs".to_string())
        );
        assert_eq!(
            internal,
            ResolvedDependency::LocalFile("crates/alpha/src/state.rs".to_string())
        );
    }

    #[test]
    fn analyzes_typescript_directory_into_graph() {
        let dir = TempDir::new().unwrap();
        write_file(
            &dir,
            "src/app/page.ts",
            r#"import { feature } from "@/core/feature";
import React from "react";"#,
        );
        write_file(&dir, "src/core/feature.ts", "export const feature = true;");

        let graph = analyze_directory(dir.path(), AnalysisLang::TypeScript);

        assert!(graph.nodes.iter().any(|node| node.id == "src/app/page.ts"));
        assert!(graph
            .nodes
            .iter()
            .any(|node| node.id == "src/core/feature.ts"));
        assert!(graph.edges.iter().any(|edge| {
            edge.from == "src/app/page.ts" && edge.to == "src/core/feature.ts" && edge.resolved
        }));
    }

    #[test]
    fn renders_dot_output() {
        let graph = DependencyGraph {
            generated_at: "2026-01-01T00:00:00Z".to_string(),
            root_dir: "/tmp".to_string(),
            language: "rust".to_string(),
            node_count: 2,
            edge_count: 1,
            nodes: vec![
                GraphNode {
                    id: "src/main.rs".to_string(),
                    path: "src/main.rs".to_string(),
                    language: "rust".to_string(),
                    kind: NodeKind::File,
                },
                GraphNode {
                    id: "serde".to_string(),
                    path: "serde".to_string(),
                    language: "rust".to_string(),
                    kind: NodeKind::ExternalCrate,
                },
            ],
            edges: vec![GraphEdge {
                from: "src/main.rs".to_string(),
                to: "serde".to_string(),
                kind: EdgeKind::Uses,
                specifier: "serde::Serialize".to_string(),
                resolved: false,
            }],
        };

        let dot = render_dot(&graph);
        assert!(dot.contains("\"src/main.rs\""));
        assert!(dot.contains("\"serde\""));
        assert!(dot.contains("->"));
    }
}
