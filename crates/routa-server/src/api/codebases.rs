use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::api::repo_context::{
    canonical_repo_path_for_response, normalize_local_repo_path, validate_local_git_repo_path,
    validate_repo_path,
};
use crate::error::ServerError;
use crate::models::codebase::{Codebase, CodebaseSourceType};
use crate::state::AppState;

fn repo_label_from_path(repo_path: &str) -> String {
    std::path::Path::new(repo_path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| repo_path.to_string())
}

fn should_set_new_codebase_as_default(has_existing_default: bool, requested_default: bool) -> bool {
    requested_default || !has_existing_default
}

fn normalize_codebase_for_response(mut codebase: Codebase) -> Codebase {
    codebase.repo_path = canonical_repo_path_for_response(&codebase.repo_path);
    codebase
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/workspaces/{workspace_id}/codebases",
            get(list_codebases).post(add_codebase),
        )
        .route(
            "/workspaces/{workspace_id}/codebases/{codebase_id}",
            axum::routing::delete(delete_workspace_codebase),
        )
        .route(
            "/workspaces/{workspace_id}/codebases/changes",
            get(list_codebase_changes),
        )
        .route(
            "/workspaces/{workspace_id}/codebases/{codebase_id}/reposlide",
            get(get_reposlide),
        )
        .route(
            "/workspaces/{workspace_id}/codebases/{codebase_id}/wiki",
            get(get_wiki),
        )
        .nest(
            "/workspaces/{workspace_id}/codebases/{codebase_id}/git",
            crate::api::git::router(),
        )
        .route(
            "/codebases/{id}",
            patch(update_codebase).delete(delete_codebase),
        )
        .route("/codebases/{id}/default", post(set_default_codebase))
}

async fn list_codebases(
    State(state): State<AppState>,
    axum::extract::Path(workspace_id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let codebases = state
        .codebase_store
        .list_by_workspace(&workspace_id)
        .await?
        .into_iter()
        .map(normalize_codebase_for_response)
        .collect::<Vec<_>>();
    Ok(Json(serde_json::json!({ "codebases": codebases })))
}

async fn list_codebase_changes(
    State(state): State<AppState>,
    axum::extract::Path(workspace_id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let codebases = state
        .codebase_store
        .list_by_workspace(&workspace_id)
        .await?;

    let repos = codebases
        .into_iter()
        .map(|codebase| {
            let repo_path = canonical_repo_path_for_response(&codebase.repo_path);
            let label = codebase
                .label
                .clone()
                .unwrap_or_else(|| repo_label_from_path(&repo_path));

            if repo_path.is_empty() {
                return serde_json::json!({
                    "codebaseId": codebase.id,
                    "repoPath": repo_path,
                    "label": label,
                    "branch": codebase.branch.unwrap_or_else(|| "unknown".to_string()),
                    "status": { "clean": true, "ahead": 0, "behind": 0, "modified": 0, "untracked": 0 },
                    "files": [],
                    "error": "Missing repository path",
                });
            }

            if !crate::git::is_git_repository(&repo_path) {
                return serde_json::json!({
                    "codebaseId": codebase.id,
                    "repoPath": repo_path,
                    "label": label,
                    "branch": codebase.branch.unwrap_or_else(|| "unknown".to_string()),
                    "status": { "clean": true, "ahead": 0, "behind": 0, "modified": 0, "untracked": 0 },
                    "files": [],
                    "error": "Repository is missing or not a git repository",
                });
            }

            let changes = crate::git::get_repo_changes(&repo_path);
            serde_json::json!({
                "codebaseId": codebase.id,
                "repoPath": repo_path,
                "label": label,
                "branch": changes.branch,
                "status": changes.status,
                "files": changes.files,
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(serde_json::json!({
        "workspaceId": workspace_id,
        "repos": repos,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddCodebaseRequest {
    repo_path: String,
    branch: Option<String>,
    label: Option<String>,
    source_type: Option<CodebaseSourceType>,
    source_url: Option<String>,
    #[serde(default)]
    is_default: bool,
}

async fn add_codebase(
    State(state): State<AppState>,
    axum::extract::Path(workspace_id): axum::extract::Path<String>,
    Json(body): Json<AddCodebaseRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), ServerError> {
    let source_type = body.source_type.unwrap_or(CodebaseSourceType::Local);
    let repo_path = normalize_local_repo_path(&body.repo_path);
    match source_type {
        CodebaseSourceType::Local => validate_local_git_repo_path(&repo_path)?,
        CodebaseSourceType::Github => validate_repo_path(&repo_path, "Path ")?,
    }
    let repo_path = repo_path.to_string_lossy().to_string();

    // Check for duplicate repo_path within the workspace
    if let Some(_existing) = state
        .codebase_store
        .find_by_repo_path(&workspace_id, &repo_path)
        .await?
    {
        return Err(ServerError::Conflict(
            "Codebase with this repoPath already exists in the workspace".to_string(),
        ));
    }

    let has_existing_default = state
        .codebase_store
        .get_default(&workspace_id)
        .await?
        .is_some();
    let should_set_default =
        should_set_new_codebase_as_default(has_existing_default, body.is_default);

    let codebase = Codebase::new(
        uuid::Uuid::new_v4().to_string(),
        workspace_id,
        repo_path,
        body.branch,
        body.label,
        false,
        Some(source_type),
        body.source_url,
    );

    state.codebase_store.save(&codebase).await?;

    if should_set_default {
        state
            .codebase_store
            .set_default(&codebase.workspace_id, &codebase.id)
            .await?;
    }

    let saved_codebase = state
        .codebase_store
        .get(&codebase.id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Codebase {} not found", codebase.id)))?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "codebase": saved_codebase })),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCodebaseRequest {
    branch: Option<String>,
    label: Option<String>,
    repo_path: Option<String>,
    source_type: Option<CodebaseSourceType>,
    source_url: Option<String>,
}

async fn update_codebase(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<UpdateCodebaseRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let existing = state
        .codebase_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Codebase {id} not found")))?;
    let requested_source_type = body
        .source_type
        .clone()
        .or_else(|| existing.source_type.clone())
        .unwrap_or(CodebaseSourceType::Local);

    let repo_path = if let Some(repo_path) = body.repo_path.as_deref() {
        let normalized = normalize_local_repo_path(repo_path);
        match requested_source_type {
            CodebaseSourceType::Local => validate_local_git_repo_path(&normalized)?,
            CodebaseSourceType::Github => validate_repo_path(&normalized, "Path ")?,
        }
        let normalized = normalized.to_string_lossy().to_string();

        if let Some(duplicate) = state
            .codebase_store
            .find_by_repo_path(&existing.workspace_id, &normalized)
            .await?
        {
            if duplicate.id != id {
                return Err(ServerError::Conflict(
                    "Codebase with this repoPath already exists in the workspace".to_string(),
                ));
            }
        }

        Some(normalized)
    } else {
        None
    };

    state
        .codebase_store
        .update(
            &id,
            body.branch.as_deref(),
            body.label.as_deref(),
            repo_path.as_deref(),
            body.source_type.as_ref().map(CodebaseSourceType::as_str),
            body.source_url.as_deref(),
        )
        .await?;

    let codebase = state
        .codebase_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Codebase {id} not found")))?;

    Ok(Json(serde_json::json!({ "codebase": codebase })))
}

async fn delete_codebase(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    delete_codebase_by_id(&state, &id, None).await
}

async fn delete_workspace_codebase(
    State(state): State<AppState>,
    axum::extract::Path((workspace_id, codebase_id)): axum::extract::Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ServerError> {
    delete_codebase_by_id(&state, &codebase_id, Some(&workspace_id)).await
}

async fn delete_codebase_by_id(
    state: &AppState,
    id: &str,
    workspace_id: Option<&str>,
) -> Result<Json<serde_json::Value>, ServerError> {
    // Clean up worktrees on disk before deleting the codebase
    let codebase = state.codebase_store.get(id).await?;
    if let Some(codebase) = codebase {
        if workspace_id.is_some_and(|workspace_id| codebase.workspace_id != workspace_id) {
            return Err(ServerError::NotFound("Codebase not found".to_string()));
        }

        let repo_path = &codebase.repo_path;

        // Acquire repo lock to prevent races with concurrent worktree operations
        let lock = {
            let mut locks = crate::api::worktrees::get_repo_locks().lock().await;
            locks
                .entry(repo_path.to_string())
                .or_insert_with(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };
        let _guard = lock.lock().await;

        let worktrees = state
            .worktree_store
            .list_by_codebase(id)
            .await
            .map_err(|e| ServerError::Internal(format!("Failed to list worktrees: {e}")))?;
        for wt in &worktrees {
            if let Err(e) = crate::git::worktree_remove(repo_path, &wt.worktree_path, true) {
                tracing::warn!(
                    "[Codebase DELETE] Failed to remove worktree {}: {}",
                    wt.id,
                    e
                );
            }
        }
        if !worktrees.is_empty() {
            let _ = crate::git::worktree_prune(repo_path);
        }
    } else if workspace_id.is_some() {
        return Err(ServerError::NotFound("Codebase not found".to_string()));
    }

    state.codebase_store.delete(id).await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

async fn set_default_codebase(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let codebase = state
        .codebase_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Codebase {id} not found")))?;

    state
        .codebase_store
        .set_default(&codebase.workspace_id, &id)
        .await?;

    let updated = state
        .codebase_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Codebase {id} not found")))?;

    Ok(Json(serde_json::json!({ "codebase": updated })))
}

// ─── RepoSlide ──────────────────────────────────────────────────

const IGNORE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    "target",
    ".routa",
    ".worktrees",
    "__pycache__",
    ".tox",
    ".venv",
    "venv",
    ".cache",
];

const MAX_DEPTH: usize = 4;
const MAX_CHILDREN: usize = 50;
const MAX_DIR_FOCUS_SLIDES: usize = 6;
const MAX_REPOWIKI_MODULES: usize = 8;

const ENTRY_POINT_FILES: &[&str] = &[
    "README.md",
    "AGENTS.md",
    "package.json",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "setup.py",
    "pom.xml",
    "build.gradle",
    "Makefile",
    "Dockerfile",
    "docker-compose.yml",
    "tsconfig.json",
];

const ANCHOR_DIRS: &[&str] = &[
    "src/app",
    "src/core",
    "src/client",
    "crates",
    "apps",
    "lib",
    "pkg",
    "cmd",
    "internal",
    "api",
];

const KEY_FILE_NAMES: &[&str] = &[
    "README.md",
    "AGENTS.md",
    "ARCHITECTURE.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "CHANGELOG.md",
];

const REPOWIKI_ROOT_FILE_ANCHORS: &[&str] = &[
    "README.md",
    "README",
    "AGENTS.md",
    "package.json",
    "Cargo.toml",
    "pyproject.toml",
    "go.mod",
];

const REPOWIKI_NESTED_FILE_ANCHORS: &[&str] = &["docs/ARCHITECTURE.md", "docs/adr/README.md"];

const REPOWIKI_DIRECTORY_ANCHORS: &[&str] = &[
    "src/app",
    "src/core",
    "src/client",
    "crates",
    "docs",
    "apps",
    "api",
];

const REPOWIKI_STORYLINE_KEY_FILES: &[&str] = &[
    "README.md",
    "AGENTS.md",
    "ARCHITECTURE.md",
    "CONTRIBUTING.md",
    "Cargo.toml",
    "package.json",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoTreeNode {
    name: String,
    path: String,
    #[serde(rename = "type")]
    node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<RepoTreeNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_count: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoSummary {
    total_files: u64,
    total_directories: u64,
    top_level_folders: Vec<String>,
    source_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    branch: Option<String>,
}

fn scan_repo_tree(repo_path: &str) -> RepoTreeNode {
    let root_name = std::path::Path::new(repo_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(repo_path)
        .to_string();
    scan_dir(repo_path, &root_name, ".", 0)
}

fn scan_dir(abs_path: &str, name: &str, rel_path: &str, depth: usize) -> RepoTreeNode {
    let mut node = RepoTreeNode {
        name: name.to_string(),
        path: rel_path.to_string(),
        node_type: "directory".to_string(),
        children: Some(Vec::new()),
        file_count: Some(0),
    };

    if depth >= MAX_DEPTH {
        return node;
    }

    let mut entries: Vec<std::fs::DirEntry> = match std::fs::read_dir(abs_path) {
        Ok(rd) => rd.filter_map(|e| e.ok()).collect(),
        Err(_) => return node,
    };

    entries.sort_by(|a, b| {
        let a_dir = a.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        let b_dir = b.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        match (a_dir, b_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().cmp(&b.file_name()),
        }
    });

    let children = node.children.as_mut().unwrap();
    let mut file_count: u64 = 0;
    let mut child_count = 0;

    for entry in entries {
        if child_count >= MAX_CHILDREN {
            break;
        }
        let entry_name = entry.file_name().to_string_lossy().to_string();
        if IGNORE_DIRS.contains(&entry_name.as_str()) {
            continue;
        }
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let child_rel = if rel_path == "." {
            entry_name.clone()
        } else {
            format!("{rel_path}/{entry_name}")
        };
        let child_abs = format!("{abs_path}/{entry_name}");

        if ft.is_dir() {
            let child = scan_dir(&child_abs, &entry_name, &child_rel, depth + 1);
            file_count += child.file_count.unwrap_or(0);
            children.push(child);
        } else if ft.is_file() {
            children.push(RepoTreeNode {
                name: entry_name,
                path: child_rel,
                node_type: "file".to_string(),
                children: None,
                file_count: None,
            });
            file_count += 1;
        }

        child_count += 1;
    }

    node.file_count = Some(file_count);
    node
}

fn compute_summary(tree: &RepoTreeNode, source_type: &str, branch: Option<&str>) -> RepoSummary {
    let (files, dirs) = count_tree(tree);
    let top_level_folders = tree
        .children
        .as_ref()
        .map(|c| {
            c.iter()
                .filter(|n| n.node_type == "directory")
                .map(|n| n.name.clone())
                .collect()
        })
        .unwrap_or_default();

    RepoSummary {
        total_files: files,
        total_directories: dirs,
        top_level_folders,
        source_type: source_type.to_string(),
        branch: branch.map(str::to_string),
    }
}

fn count_tree(node: &RepoTreeNode) -> (u64, u64) {
    if node.node_type == "file" {
        return (1, 0);
    }
    let mut files = 0u64;
    let mut dirs = 1u64;
    for child in node.children.as_deref().unwrap_or(&[]) {
        let (f, d) = count_tree(child);
        files += f;
        dirs += d;
    }
    (files, dirs)
}

fn detect_entry_points(tree: &RepoTreeNode) -> Vec<serde_json::Value> {
    let mut found = Vec::new();

    for child in tree.children.as_deref().unwrap_or(&[]) {
        if child.node_type == "file" && ENTRY_POINT_FILES.contains(&child.name.as_str()) {
            found.push(serde_json::json!({
                "name": child.name,
                "path": child.path,
                "reason": format!("Project entry point ({})", child.name),
            }));
        }
    }

    for anchor in ANCHOR_DIRS {
        if let Some(node) = find_node_by_path(tree, anchor) {
            found.push(serde_json::json!({
                "name": *anchor,
                "path": node.path,
                "reason": "Architecture anchor directory",
            }));
        }
    }

    found
}

fn detect_key_files(tree: &RepoTreeNode) -> Vec<serde_json::Value> {
    tree.children
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .filter(|c| c.node_type == "file" && KEY_FILE_NAMES.contains(&c.name.as_str()))
        .map(|c| {
            serde_json::json!({
                "name": c.name,
                "path": c.path,
            })
        })
        .collect()
}

fn extract_architecture_anchors(tree: &RepoTreeNode) -> Vec<serde_json::Value> {
    let mut anchors = Vec::new();

    for child in tree.children.as_deref().unwrap_or(&[]) {
        if child.node_type != "file" {
            continue;
        }

        if REPOWIKI_ROOT_FILE_ANCHORS
            .iter()
            .any(|anchor| matches_root_file_anchor(&child.name, anchor))
        {
            anchors.push(serde_json::json!({
                "kind": "file",
                "path": child.path,
                "reason": format!("Architecture/documentation anchor ({})", child.name),
            }));
        }
    }

    for anchor in REPOWIKI_DIRECTORY_ANCHORS {
        if let Some(node) = find_node_by_path(tree, anchor) {
            anchors.push(serde_json::json!({
                "kind": "directory",
                "path": node.path,
                "reason": "Architecture anchor directory",
            }));
        }
    }

    for anchor in REPOWIKI_NESTED_FILE_ANCHORS {
        if let Some(node) = find_node_by_path(tree, anchor) {
            if node.node_type == "file" {
                anchors.push(serde_json::json!({
                    "kind": "file",
                    "path": node.path,
                    "reason": format!("Architecture/documentation anchor ({})", node.name),
                }));
            }
        }
    }

    anchors
}

fn matches_root_file_anchor(file_name: &str, anchor: &str) -> bool {
    let base_name = anchor.split('.').next().unwrap_or(anchor);
    file_name == anchor || file_name == base_name || file_name.starts_with(&format!("{base_name}."))
}

fn build_repowiki_modules(tree: &RepoTreeNode) -> Vec<serde_json::Value> {
    let mut modules: Vec<&RepoTreeNode> = tree
        .children
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .filter(|child| child.node_type == "directory")
        .collect();
    modules.sort_by(|left, right| {
        right
            .file_count
            .unwrap_or(0)
            .cmp(&left.file_count.unwrap_or(0))
    });

    modules
        .into_iter()
        .take(MAX_REPOWIKI_MODULES)
        .map(|child| {
            serde_json::json!({
                "name": child.name,
                "path": child.path,
                "fileCount": child.file_count.unwrap_or(0),
                "role": infer_module_role(&child.name),
            })
        })
        .collect()
}

fn infer_module_role(name: &str) -> &'static str {
    match name {
        "src" => "Primary application source code.",
        "docs" => "Documentation, architecture notes, and operational guides.",
        "crates" => "Rust service/runtime modules.",
        "apps" => "Application entrypoints and package surfaces.",
        "app" => "User-facing application layer.",
        _ => "Core repository module area.",
    }
}

fn build_repository_role_summary(top_level_folders: &[String]) -> String {
    if top_level_folders.is_empty() {
        return "Repository is compact and mostly root-file driven.".to_string();
    }

    format!(
        "Repository is organized around {}.",
        top_level_folders
            .iter()
            .take(4)
            .cloned()
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn build_runtime_boundaries(top_level_folders: &[String]) -> Vec<String> {
    let mut boundaries = Vec::new();

    if top_level_folders.iter().any(|folder| folder == "src") {
        boundaries.push("Source runtime boundary under src/".to_string());
    }
    if top_level_folders.iter().any(|folder| folder == "crates") {
        boundaries.push("Rust/Axum backend boundary under crates/".to_string());
    }
    if top_level_folders.iter().any(|folder| folder == "apps") {
        boundaries.push("Multi-app boundary under apps/".to_string());
    }
    if top_level_folders.iter().any(|folder| folder == "docs") {
        boundaries.push("Documentation and architecture boundary under docs/".to_string());
    }

    boundaries
}

fn build_cross_layer_relationships(top_level_folders: &[String]) -> Vec<String> {
    if top_level_folders.iter().any(|folder| folder == "src")
        && top_level_folders.iter().any(|folder| folder == "crates")
    {
        return vec![
            "Next.js app layer in src/ coordinates with Rust services in crates/.".to_string(),
        ];
    }

    if top_level_folders.iter().any(|folder| folder == "src")
        && top_level_folders.iter().any(|folder| folder == "docs")
    {
        return vec![
            "Implementation in src/ is guided by architecture and ADR documents in docs/."
                .to_string(),
        ];
    }

    vec!["Cross-layer relationships require deeper file-level inspection.".to_string()]
}

fn build_repowiki_workflows(top_level_folders: &[String]) -> Vec<serde_json::Value> {
    let top_level_paths = top_level_folders
        .iter()
        .map(|folder| format!("{folder}/"))
        .collect::<Vec<_>>();
    let repo_orientation_paths = [
        vec!["README.md".to_string(), "AGENTS.md".to_string()],
        top_level_paths.clone(),
    ]
    .concat();

    vec![
        serde_json::json!({
            "name": "Repo orientation",
            "description": "Start from README/AGENTS and map top-level modules before detailed tracing.",
            "relatedPaths": repo_orientation_paths,
        }),
        serde_json::json!({
            "name": "Architecture walkthrough",
            "description": "Trace runtime boundaries and handoffs between major layers.",
            "relatedPaths": top_level_paths,
        }),
    ]
}

fn build_repowiki_glossary(top_level_folders: &[String]) -> Vec<serde_json::Value> {
    let mut glossary = vec![
        serde_json::json!({
            "term": "RepoWiki",
            "meaning": "Intermediate architecture-aware repository knowledge artifact."
        }),
        serde_json::json!({
            "term": "Storyline context",
            "meaning": "Slide-ready narrative hints generated from repository evidence."
        }),
    ];

    if top_level_folders.iter().any(|folder| folder == "crates") {
        glossary.push(serde_json::json!({
            "term": "crates",
            "meaning": "Rust package/workspace area.",
            "sourcePath": "crates/",
        }));
    }

    if top_level_folders.iter().any(|folder| folder == "src") {
        glossary.push(serde_json::json!({
            "term": "src",
            "meaning": "Application source root.",
            "sourcePath": "src/",
        }));
    }

    glossary
}

fn build_repowiki_storyline_context(
    tree: &RepoTreeNode,
    anchors: &[serde_json::Value],
) -> serde_json::Value {
    let mut focus_areas: Vec<&RepoTreeNode> = tree
        .children
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .filter(|child| child.node_type == "directory")
        .collect();
    focus_areas.sort_by(|left, right| {
        right
            .file_count
            .unwrap_or(0)
            .cmp(&left.file_count.unwrap_or(0))
    });

    let focus_areas = focus_areas
        .into_iter()
        .take(MAX_DIR_FOCUS_SLIDES)
        .map(|directory| {
            serde_json::json!({
                "path": directory.path,
                "fileCount": directory.file_count.unwrap_or(0),
            })
        })
        .collect::<Vec<_>>();

    let entry_points = anchors
        .iter()
        .filter(|anchor| {
            anchor
                .get("kind")
                .and_then(|value| value.as_str())
                .unwrap_or("file")
                == "file"
        })
        .filter_map(|anchor| anchor.get("path").and_then(|value| value.as_str()))
        .map(str::to_string)
        .collect::<Vec<_>>();

    let key_files = tree
        .children
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .filter(|child| {
            child.node_type == "file" && REPOWIKI_STORYLINE_KEY_FILES.contains(&child.name.as_str())
        })
        .map(|child| child.path.clone())
        .collect::<Vec<_>>();

    let primary_module = focus_areas
        .first()
        .and_then(|area| area.get("path"))
        .and_then(|value| value.as_str())
        .unwrap_or("the primary module");

    serde_json::json!({
        "suggestedSections": [
            "Repository overview",
            "Top-level architecture",
            "Runtime boundaries",
            "Important modules and responsibilities",
            "Key files and why they matter",
            "Main workflows / narratives",
            "Slide-ready storyline hints",
        ],
        "entryPoints": entry_points,
        "keyFiles": key_files,
        "focusAreas": focus_areas,
        "narrativeHints": [
            format!("Start from docs/README and then explain {}.", primary_module),
            "Call out cross-layer boundaries between app/core/client or equivalent runtime layers.",
            "Label inferred conclusions explicitly when source files do not state intent directly.",
        ],
    })
}

fn build_focus_directories(tree: &RepoTreeNode) -> Vec<serde_json::Value> {
    let mut focus_dirs: Vec<&RepoTreeNode> = tree
        .children
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .filter(|c| c.node_type == "directory")
        .collect();
    focus_dirs.sort_by(|a, b| b.file_count.unwrap_or(0).cmp(&a.file_count.unwrap_or(0)));

    focus_dirs
        .into_iter()
        .take(MAX_DIR_FOCUS_SLIDES)
        .map(|dir| {
            let children: Vec<serde_json::Value> = dir
                .children
                .as_deref()
                .unwrap_or(&[])
                .iter()
                .map(|child| {
                    let mut value = serde_json::json!({
                        "name": child.name,
                        "type": child.node_type,
                    });
                    if child.node_type == "directory" {
                        value["fileCount"] = serde_json::json!(child.file_count.unwrap_or(0));
                    }
                    value
                })
                .collect();

            serde_json::json!({
                "name": dir.name,
                "path": dir.path,
                "fileCount": dir.file_count.unwrap_or(0),
                "children": children,
            })
        })
        .collect()
}

fn build_reposlide_prompt(
    codebase: &Codebase,
    summary: &RepoSummary,
    root_files: &[String],
    entry_points: &[serde_json::Value],
    key_files: &[serde_json::Value],
    focus_directories: &[serde_json::Value],
) -> String {
    let repo_label = codebase
        .label
        .clone()
        .unwrap_or_else(|| repo_label_from_path(&codebase.repo_path));
    let mut lines = vec![
        format!(
            "Create a presentation slide deck for the repository \"{}\".",
            repo_label
        ),
        String::new(),
        "Goal:".to_string(),
        "- Explain what this repository is, how it is structured, and how an engineer should orient themselves quickly.".to_string(),
        "- Keep the deck concise: target 6-8 slides.".to_string(),
        "- Use evidence from the local repository only. If a conclusion is inferred, label it as an inference.".to_string(),
        String::new(),
        "Required coverage:".to_string(),
        "- Repository purpose and audience.".to_string(),
        "- Runtime or architecture overview.".to_string(),
        "- Top-level structure and major subsystems.".to_string(),
        "- Important entry points, docs, and operational files.".to_string(),
        "- Notable risks, TODOs, or ambiguities if they materially affect understanding.".to_string(),
        String::new(),
        "Before drafting slides, inspect these first if they exist:".to_string(),
        "- AGENTS.md".to_string(),
        "- README.md".to_string(),
        "- docs/ARCHITECTURE.md".to_string(),
        "- docs/adr/README.md".to_string(),
        "- package.json / Cargo.toml / pyproject.toml / go.mod".to_string(),
        String::new(),
        "Output:".to_string(),
        "- Build the deck with slide-skill and save the final artifact as a PPTX.".to_string(),
        "- In the final response, report the PPTX path and summarize the slide outline.".to_string(),
        String::new(),
        "Repository context:".to_string(),
        format!("- Repo path: {}", codebase.repo_path),
        format!(
            "- Branch: {}",
            codebase.branch.as_deref().unwrap_or("unknown")
        ),
        format!("- Source type: {}", summary.source_type),
        format!("- Total files scanned: {}", summary.total_files),
        format!("- Total directories scanned: {}", summary.total_directories),
        format!(
            "- Top-level folders: {}",
            if summary.top_level_folders.is_empty() {
                "(none detected)".to_string()
            } else {
                summary.top_level_folders.join(", ")
            }
        ),
        format!(
            "- Root files: {}",
            if root_files.is_empty() {
                "(none detected)".to_string()
            } else {
                root_files.join(", ")
            }
        ),
    ];

    if !entry_points.is_empty() {
        lines.push(String::new());
        lines.push("Entry points and architecture anchors:".to_string());
        for item in entry_points {
            let path = item
                .get("path")
                .and_then(|value| value.as_str())
                .unwrap_or("(unknown)");
            let reason = item
                .get("reason")
                .and_then(|value| value.as_str())
                .unwrap_or("(no reason)");
            lines.push(format!("- {path}: {reason}"));
        }
    }

    if !key_files.is_empty() {
        lines.push(String::new());
        lines.push("Key files worth reading:".to_string());
        for item in key_files {
            let path = item
                .get("path")
                .and_then(|value| value.as_str())
                .unwrap_or("(unknown)");
            lines.push(format!("- {path}"));
        }
    }

    if !focus_directories.is_empty() {
        lines.push(String::new());
        lines.push("Largest top-level areas:".to_string());
        for item in focus_directories {
            let dir_path = item
                .get("path")
                .and_then(|value| value.as_str())
                .unwrap_or("(unknown)");
            let file_count = item
                .get("fileCount")
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            let preview = item
                .get("children")
                .and_then(|value| value.as_array())
                .map(|children| {
                    children
                        .iter()
                        .take(8)
                        .map(|child| {
                            let name = child
                                .get("name")
                                .and_then(|value| value.as_str())
                                .unwrap_or("(unknown)");
                            let node_type = child
                                .get("type")
                                .and_then(|value| value.as_str())
                                .unwrap_or("file");
                            if node_type == "directory" {
                                let nested_count = child
                                    .get("fileCount")
                                    .and_then(|value| value.as_u64())
                                    .unwrap_or(0);
                                format!("{name}/ ({nested_count} files)")
                            } else {
                                name.to_string()
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            lines.push(format!(
                "- {} ({} files): {}",
                dir_path,
                file_count,
                if preview.is_empty() {
                    "no immediate children scanned".to_string()
                } else {
                    preview
                }
            ));
        }
    }

    lines.push(String::new());
    lines.push(
        "Work in the repository itself as the primary context. Do not generate application code for Routa; generate the slide deck artifact about this repo.".to_string(),
    );

    lines.join("\n")
}

fn resolve_reposlide_skill_repo_path() -> Option<String> {
    let cwd = std::env::current_dir().ok()?;
    let candidate = cwd.join("tools").join("office-skills");
    let skill_file = candidate
        .join(".agents")
        .join("skills")
        .join("slide")
        .join("SKILL.md");

    if skill_file.is_file() {
        Some(candidate.to_string_lossy().to_string())
    } else {
        None
    }
}

fn find_node_by_path<'a>(tree: &'a RepoTreeNode, target: &str) -> Option<&'a RepoTreeNode> {
    let segments: Vec<&str> = target.split('/').collect();
    let mut current = tree;
    for seg in &segments {
        current = current.children.as_ref()?.iter().find(|c| c.name == *seg)?;
    }
    Some(current)
}

async fn get_reposlide(
    State(state): State<AppState>,
    axum::extract::Path((workspace_id, codebase_id)): axum::extract::Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let codebase = state
        .codebase_store
        .get(&codebase_id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Codebase {codebase_id} not found")))?;

    if codebase.workspace_id != workspace_id {
        return Err(ServerError::NotFound(format!(
            "Codebase {codebase_id} not found in workspace {workspace_id}"
        )));
    }

    if codebase.repo_path.is_empty() {
        return Err(ServerError::BadRequest(
            "Codebase has no repository path".to_string(),
        ));
    }

    let tree = scan_repo_tree(&codebase.repo_path);
    let source_type = codebase
        .source_type
        .as_ref()
        .map(CodebaseSourceType::as_str)
        .unwrap_or("local");
    let summary = compute_summary(&tree, source_type, codebase.branch.as_deref());
    let root_files: Vec<String> = tree
        .children
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .filter(|c| c.node_type == "file")
        .map(|c| c.name.clone())
        .collect();
    let entry_points = detect_entry_points(&tree);
    let key_files = detect_key_files(&tree);
    let focus_directories = build_focus_directories(&tree);
    let skill_repo_path = resolve_reposlide_skill_repo_path();
    let skill_available = skill_repo_path.is_some();
    let prompt = build_reposlide_prompt(
        &codebase,
        &summary,
        &root_files,
        &entry_points,
        &key_files,
        &focus_directories,
    );

    Ok(Json(serde_json::json!({
        "codebase": {
            "id": codebase.id,
            "label": codebase.label,
            "repoPath": codebase.repo_path,
            "sourceType": source_type,
            "sourceUrl": codebase.source_url,
            "branch": codebase.branch,
        },
        "summary": summary,
        "context": {
            "rootFiles": root_files,
            "entryPoints": entry_points,
            "keyFiles": key_files,
            "focusDirectories": focus_directories,
        },
        "launch": {
            "skillName": "slide-skill",
            "skillRepoPath": skill_repo_path,
            "skillAvailable": skill_available,
            "unavailableReason": if skill_available {
                serde_json::Value::Null
            } else {
                serde_json::Value::String("slide-skill could not be found relative to the current Routa installation.".to_string())
            },
            "prompt": prompt,
        },
    })))
}

async fn get_wiki(
    State(state): State<AppState>,
    axum::extract::Path((workspace_id, codebase_id)): axum::extract::Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let codebase = state
        .codebase_store
        .get(&codebase_id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Codebase {codebase_id} not found")))?;

    if codebase.workspace_id != workspace_id {
        return Err(ServerError::NotFound(format!(
            "Codebase {codebase_id} not found in workspace {workspace_id}"
        )));
    }

    if codebase.repo_path.is_empty() {
        return Err(ServerError::BadRequest(
            "Codebase has no repository path".to_string(),
        ));
    }

    let tree = scan_repo_tree(&codebase.repo_path);
    let source_type = codebase
        .source_type
        .as_ref()
        .map(CodebaseSourceType::as_str)
        .unwrap_or("local");
    let summary = compute_summary(&tree, source_type, codebase.branch.as_deref());
    let anchors = extract_architecture_anchors(&tree);
    let modules = build_repowiki_modules(&tree);

    let source_links = anchors
        .iter()
        .filter_map(|anchor| {
            anchor.get("path").map(|path| {
                serde_json::json!({
                    "label": path,
                    "path": path,
                })
            })
        })
        .chain(modules.iter().map(|module| {
            serde_json::json!({
                "label": module
                    .get("name")
                    .and_then(|value| value.as_str())
                    .unwrap_or("."),
                "path": module
                    .get("path")
                    .and_then(|value| value.as_str())
                    .unwrap_or("."),
            })
        }))
        .collect::<Vec<_>>();

    let top_level_folders = summary.top_level_folders.clone();
    let storyline_context = build_repowiki_storyline_context(&tree, &anchors);

    Ok(Json(serde_json::json!({
        "codebase": {
            "id": codebase.id,
            "workspaceId": codebase.workspace_id,
            "label": codebase.label,
            "repoPath": codebase.repo_path,
            "sourceType": source_type,
            "sourceUrl": codebase.source_url,
            "branch": codebase.branch,
        },
        "summary": {
            "totalFiles": summary.total_files,
            "totalDirectories": summary.total_directories,
            "topLevelFolders": summary.top_level_folders,
            "sourceType": summary.source_type,
            "branch": summary.branch,
            "repositoryRoleSummary": build_repository_role_summary(&top_level_folders),
        },
        "anchors": anchors,
        "modules": modules,
        "architecture": {
            "runtimeBoundaries": build_runtime_boundaries(&top_level_folders),
            "crossLayerRelationships": build_cross_layer_relationships(&top_level_folders),
        },
        "workflows": build_repowiki_workflows(&top_level_folders),
        "glossary": build_repowiki_glossary(&top_level_folders),
        "sourceLinks": source_links,
        "storylineContext": storyline_context,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, path: &str) -> RepoTreeNode {
        RepoTreeNode {
            name: name.to_string(),
            path: path.to_string(),
            node_type: "file".to_string(),
            children: None,
            file_count: None,
        }
    }

    fn directory(
        name: &str,
        path: &str,
        file_count: u64,
        children: Vec<RepoTreeNode>,
    ) -> RepoTreeNode {
        RepoTreeNode {
            name: name.to_string(),
            path: path.to_string(),
            node_type: "directory".to_string(),
            children: Some(children),
            file_count: Some(file_count),
        }
    }

    fn sample_tree() -> RepoTreeNode {
        directory(
            "repo",
            ".",
            6,
            vec![
                file("README.md", "README.md"),
                file("packagefoo.js", "packagefoo.js"),
                directory("app", "app", 1, vec![file("page.tsx", "app/page.tsx")]),
                directory(
                    "docs",
                    "docs",
                    2,
                    vec![
                        file("ARCHITECTURE.md", "docs/ARCHITECTURE.md"),
                        directory(
                            "adr",
                            "docs/adr",
                            1,
                            vec![file("README.md", "docs/adr/README.md")],
                        ),
                    ],
                ),
                directory(
                    "src",
                    "src",
                    2,
                    vec![directory(
                        "app",
                        "src/app",
                        1,
                        vec![file("page.tsx", "src/app/page.tsx")],
                    )],
                ),
            ],
        )
    }

    #[test]
    fn repowiki_extract_architecture_anchors_includes_nested_docs_and_skips_false_positives() {
        let anchors = extract_architecture_anchors(&sample_tree());

        let paths = anchors
            .iter()
            .filter_map(|anchor| anchor.get("path").and_then(|value| value.as_str()))
            .collect::<Vec<_>>();

        assert!(paths.contains(&"README.md"));
        assert!(paths.contains(&"docs/ARCHITECTURE.md"));
        assert!(paths.contains(&"docs/adr/README.md"));
        assert!(!paths.contains(&"packagefoo.js"));
    }

    #[test]
    fn repowiki_storyline_and_modules_match_expected_semantics() {
        let tree = sample_tree();
        let anchors = extract_architecture_anchors(&tree);
        let modules = build_repowiki_modules(&tree);
        let storyline = build_repowiki_storyline_context(&tree, &anchors);

        let app_module = modules
            .iter()
            .find(|module| module.get("path").and_then(|value| value.as_str()) == Some("app"))
            .expect("expected app module");
        assert_eq!(
            app_module
                .get("role")
                .and_then(|value| value.as_str())
                .expect("expected role"),
            "User-facing application layer."
        );

        let entry_points = storyline
            .get("entryPoints")
            .and_then(|value| value.as_array())
            .expect("expected entry points");
        let entry_paths = entry_points
            .iter()
            .filter_map(|value| value.as_str())
            .collect::<Vec<_>>();
        assert!(entry_paths.contains(&"README.md"));
        assert!(entry_paths.contains(&"docs/ARCHITECTURE.md"));
        assert!(!entry_paths.contains(&"docs"));
    }

    #[test]
    fn new_codebase_becomes_default_when_workspace_has_no_default() {
        assert!(should_set_new_codebase_as_default(false, false));
    }

    #[test]
    fn requested_default_overrides_existing_default_presence() {
        assert!(should_set_new_codebase_as_default(true, true));
        assert!(!should_set_new_codebase_as_default(true, false));
    }
}
