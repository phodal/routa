//! TreeSitter-based dependency graph analyzer.
//!
//! Walks a source directory, parses Rust and TypeScript files using TreeSitter,
//! extracts `use`/`import` declarations, and builds a simple module dependency graph.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tree_sitter::{Language, Node, Parser};
use walkdir::WalkDir;

use crate::commands::graph::AnalyzeArgs;

// ──────────────────────────── Graph types ────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    Module,
    ExternalCrate,
    ExternalPackage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
    pub kind: EdgeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    /// `use` declaration in Rust
    Uses,
    /// `import` statement in TypeScript/JavaScript
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

// ──────────────────────────── Language detection ─────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnalysisLang {
    Rust,
    TypeScript,
    Auto,
}

fn parse_lang(lang: &str) -> AnalysisLang {
    match lang.to_lowercase().as_str() {
        "rust" => AnalysisLang::Rust,
        "typescript" | "ts" => AnalysisLang::TypeScript,
        _ => AnalysisLang::Auto,
    }
}

fn detect_lang_from_extension(path: &Path) -> Option<AnalysisLang> {
    match path.extension().and_then(|e| e.to_str()) {
        Some("rs") => Some(AnalysisLang::Rust),
        Some("ts" | "tsx") => Some(AnalysisLang::TypeScript),
        _ => None,
    }
}

// ──────────────────────────── TreeSitter parsers ──────────────────────────────

fn rust_language() -> Language {
    tree_sitter_rust::LANGUAGE.into()
}

fn typescript_language() -> Language {
    tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
}

// ──────────────────────────── Extraction helpers ──────────────────────────────

/// Extract `use` paths from a Rust source file.
///
/// Traverses the AST looking for `use_declaration` nodes and collects
/// the leading path segments as dependency identifiers.
fn extract_rust_uses(source: &str) -> Vec<String> {
    let mut parser = Parser::new();
    parser
        .set_language(&rust_language())
        .expect("Rust grammar load failed");

    let tree = match parser.parse(source, None) {
        Some(t) => t,
        None => return vec![],
    };

    let mut uses = Vec::new();
    collect_rust_uses(tree.root_node(), source.as_bytes(), &mut uses);
    uses.sort();
    uses.dedup();
    uses
}

fn collect_rust_uses(node: Node<'_>, source: &[u8], out: &mut Vec<String>) {
    if node.kind() == "use_declaration" {
        if let Some(path_node) = node.child_by_field_name("argument") {
            let raw = path_node.utf8_text(source).unwrap_or("").to_string();
            // Take the first path segment as the crate/module name.
            let crate_name = raw
                .trim_start_matches('{')
                .split("::")
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !crate_name.is_empty() && crate_name != "self" && crate_name != "super" {
                out.push(crate_name);
            }
        }
    }

    for child in node.children(&mut node.walk()) {
        collect_rust_uses(child, source, out);
    }
}

/// Extract `import` paths from a TypeScript source file.
///
/// Traverses the AST looking for `import_statement` nodes and collects
/// the module specifier strings.
fn extract_typescript_imports(source: &str) -> Vec<String> {
    let mut parser = Parser::new();
    parser
        .set_language(&typescript_language())
        .expect("TypeScript grammar load failed");

    let tree = match parser.parse(source, None) {
        Some(t) => t,
        None => return vec![],
    };

    let mut imports = Vec::new();
    collect_ts_imports(tree.root_node(), source.as_bytes(), &mut imports);
    imports.sort();
    imports.dedup();
    imports
}

fn collect_ts_imports(node: Node<'_>, source: &[u8], out: &mut Vec<String>) {
    if node.kind() == "import_statement" {
        // The `source` child holds the module specifier string literal.
        if let Some(source_node) = node.child_by_field_name("source") {
            let raw = source_node.utf8_text(source).unwrap_or("").to_string();
            // Strip surrounding quotes.
            let specifier = raw.trim_matches(|c| c == '"' || c == '\'').to_string();
            if !specifier.is_empty() {
                out.push(specifier);
            }
        }
    }

    for child in node.children(&mut node.walk()) {
        collect_ts_imports(child, source, out);
    }
}

// ──────────────────────────── Graph builder ──────────────────────────────────

fn analyze_directory(root: &Path, requested_lang: AnalysisLang) -> DependencyGraph {
    let mut nodes: HashMap<String, GraphNode> = HashMap::new();
    let mut edges: Vec<GraphEdge> = Vec::new();

    let ignored_dirs = ["node_modules", ".git", ".next", "dist", "build", "target", ".routa"];

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            !e.file_name()
                .to_str()
                .map(|n| ignored_dirs.contains(&n))
                .unwrap_or(false)
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let effective_lang = match requested_lang {
            AnalysisLang::Auto => match detect_lang_from_extension(path) {
                Some(l) => l,
                None => continue,
            },
            AnalysisLang::Rust => {
                if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                    continue;
                }
                AnalysisLang::Rust
            }
            AnalysisLang::TypeScript => {
                let ext = path.extension().and_then(|e| e.to_str());
                if ext != Some("ts") && ext != Some("tsx") {
                    continue;
                }
                AnalysisLang::TypeScript
            }
        };

        let rel = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();

        let node_id = rel.clone();
        let lang_str = match effective_lang {
            AnalysisLang::Rust => "rust",
            AnalysisLang::TypeScript => "typescript",
            AnalysisLang::Auto => unreachable!(),
        };

        nodes
            .entry(node_id.clone())
            .or_insert_with(|| GraphNode {
                id: node_id.clone(),
                path: rel.clone(),
                language: lang_str.to_string(),
                kind: NodeKind::File,
            });

        let source = match fs::read_to_string(path) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let deps = match effective_lang {
            AnalysisLang::Rust => extract_rust_uses(&source),
            AnalysisLang::TypeScript => extract_typescript_imports(&source),
            AnalysisLang::Auto => unreachable!(),
        };

        for dep in deps {
            let is_external = match effective_lang {
                AnalysisLang::Rust => !dep.starts_with("crate") && !dep.starts_with("super"),
                AnalysisLang::TypeScript => !dep.starts_with('.'),
                AnalysisLang::Auto => unreachable!(),
            };

            let dep_id = if is_external {
                dep.clone()
            } else {
                dep.clone()
            };

            nodes.entry(dep_id.clone()).or_insert_with(|| GraphNode {
                id: dep_id.clone(),
                path: dep.clone(),
                language: lang_str.to_string(),
                kind: if is_external {
                    match effective_lang {
                        AnalysisLang::Rust => NodeKind::ExternalCrate,
                        AnalysisLang::TypeScript => NodeKind::ExternalPackage,
                        AnalysisLang::Auto => unreachable!(),
                    }
                } else {
                    NodeKind::Module
                },
            });

            let edge_kind = match effective_lang {
                AnalysisLang::Rust => EdgeKind::Uses,
                AnalysisLang::TypeScript => EdgeKind::Imports,
                AnalysisLang::Auto => unreachable!(),
            };

            edges.push(GraphEdge {
                from: node_id.clone(),
                to: dep_id,
                kind: edge_kind,
            });
        }
    }

    // Detect resolved language label for the graph.
    let lang_label = match requested_lang {
        AnalysisLang::Rust => "rust".to_string(),
        AnalysisLang::TypeScript => "typescript".to_string(),
        AnalysisLang::Auto => "auto".to_string(),
    };

    let mut nodes_vec: Vec<GraphNode> = nodes.into_values().collect();
    nodes_vec.sort_by(|a, b| a.id.cmp(&b.id));

    DependencyGraph {
        generated_at: chrono::Utc::now().to_rfc3339(),
        root_dir: root.to_string_lossy().to_string(),
        language: lang_label,
        node_count: nodes_vec.len(),
        edge_count: edges.len(),
        nodes: nodes_vec,
        edges,
    }
}

// ──────────────────────────── DOT renderer ───────────────────────────────────

fn render_dot(graph: &DependencyGraph) -> String {
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

// ──────────────────────────── CLI entry ──────────────────────────────────────

pub fn run_analyze(args: &AnalyzeArgs) -> Result<(), String> {
    let root = match &args.dir {
        Some(d) => PathBuf::from(d),
        None => std::env::current_dir()
            .map_err(|e| format!("failed to determine cwd: {e}"))?,
    };

    if !root.exists() {
        return Err(format!("directory does not exist: {}", root.display()));
    }

    let lang = parse_lang(&args.lang);
    let graph = analyze_directory(&root, lang);

    let output_text = match args.format.as_str() {
        "dot" => render_dot(&graph),
        _ => serde_json::to_string_pretty(&graph)
            .map_err(|e| format!("JSON serialization failed: {e}"))?,
    };

    match &args.output {
        Some(path) => {
            fs::write(path, &output_text)
                .map_err(|e| format!("failed to write output file: {e}"))?;
            println!("Graph written to: {path}");
        }
        None => println!("{output_text}"),
    }

    Ok(())
}

// ──────────────────────────── Tests ──────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn write_file(dir: &TempDir, name: &str, content: &str) -> PathBuf {
        let path = dir.path().join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        path
    }

    #[test]
    fn graph_analyze_rust_use_extraction() {
        let source = r#"
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use crate::state::AppState;

fn main() {}
"#;
        let deps = extract_rust_uses(source);
        assert!(deps.contains(&"std".to_string()), "expected std, got: {deps:?}");
        assert!(deps.contains(&"serde".to_string()), "expected serde");
    }

    #[test]
    fn graph_analyze_typescript_import_extraction() {
        let source = r#"
import React from "react";
import { useState } from "react";
import { fromRoot } from "../lib/paths";
import type { Foo } from "@/core/types";
"#;
        let deps = extract_typescript_imports(source);
        assert!(deps.contains(&"react".to_string()), "expected react, got: {deps:?}");
        assert!(deps.contains(&"../lib/paths".to_string()), "expected relative import");
        assert!(deps.contains(&"@/core/types".to_string()), "expected alias import");
    }

    #[test]
    fn graph_analyze_directory_rust_produces_graph() {
        let dir = TempDir::new().unwrap();
        write_file(
            &dir,
            "main.rs",
            r#"use std::io; use serde::Serialize; fn main() {}"#,
        );
        write_file(
            &dir,
            "lib.rs",
            r#"use std::collections::HashMap; pub fn helper() {}"#,
        );

        let graph = analyze_directory(dir.path(), AnalysisLang::Rust);
        assert!(graph.node_count >= 2, "expected at least 2 nodes, got {}", graph.node_count);
        assert!(graph.edge_count > 0, "expected at least one edge");
    }

    #[test]
    fn graph_analyze_directory_typescript_produces_graph() {
        let dir = TempDir::new().unwrap();
        write_file(
            &dir,
            "index.ts",
            r#"import React from "react"; import { helper } from "./utils";"#,
        );
        write_file(
            &dir,
            "utils.ts",
            r#"import path from "node:path"; export function helper() {}"#,
        );

        let graph = analyze_directory(dir.path(), AnalysisLang::TypeScript);
        assert!(graph.node_count >= 2);
        assert!(graph.edge_count > 0);
    }

    #[test]
    fn graph_analyze_dot_output_is_valid() {
        let graph = DependencyGraph {
            generated_at: "2026-01-01T00:00:00Z".to_string(),
            root_dir: "/test".to_string(),
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
                    id: "std".to_string(),
                    path: "std".to_string(),
                    language: "rust".to_string(),
                    kind: NodeKind::ExternalCrate,
                },
            ],
            edges: vec![GraphEdge {
                from: "src/main.rs".to_string(),
                to: "std".to_string(),
                kind: EdgeKind::Uses,
            }],
        };

        let dot = render_dot(&graph);
        assert!(dot.starts_with("digraph dependencies {"));
        assert!(dot.contains("\"src/main.rs\""));
        assert!(dot.contains("\"std\""));
        assert!(dot.contains("->"));
    }

    #[test]
    fn graph_analyze_auto_lang_skips_unknown_files() {
        let dir = TempDir::new().unwrap();
        write_file(&dir, "config.json", r#"{"key": "value"}"#);
        write_file(&dir, "script.sh", r#"#!/bin/bash echo hello"#);
        write_file(&dir, "main.rs", r#"use std::io;"#);

        let graph = analyze_directory(dir.path(), AnalysisLang::Auto);
        // Only main.rs should be included; json/sh files are ignored
        assert!(
            graph.nodes.iter().any(|n| n.language == "rust"),
            "expected at least one rust node"
        );
        assert!(
            !graph.nodes.iter().any(|n| n.path.ends_with(".json")),
            "json files should be excluded"
        );
    }
}
