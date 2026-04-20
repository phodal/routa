use anyhow::{Context, Result};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use trace_parser::{
    FeatureSurfaceCatalog, FeatureTreeCatalog, FileEvidenceKind, FileOperationKind,
    NormalizedFileEvent, NormalizedSession, NormalizedToolCall, ProviderKey, SessionAnalysis,
    SessionAnalyzer, ToolCallStatus,
};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct SessionTraceMaterial {
    pub(crate) session_id: String,
    pub(crate) changed_files: Vec<String>,
    pub(crate) tool_call_names: Vec<String>,
}

impl SessionTraceMaterial {
    pub(crate) fn new(
        session_id: impl Into<String>,
        changed_files: Vec<String>,
        tool_call_names: Vec<String>,
    ) -> Self {
        let changed_files = changed_files
            .into_iter()
            .filter(|path| !path.trim().is_empty())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let tool_call_names = tool_call_names
            .into_iter()
            .filter(|tool| !tool.trim().is_empty())
            .collect();
        Self {
            session_id: session_id.into(),
            changed_files,
            tool_call_names,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct FeatureTraceCatalogs {
    surface_catalog: FeatureSurfaceCatalog,
    feature_tree: FeatureTreeCatalog,
}

impl FeatureTraceCatalogs {
    pub(crate) fn load(repo_root: &Path) -> Result<Option<Self>> {
        let feature_tree_path = repo_root.join("docs/product-specs/FEATURE_TREE.md");
        let surface_index_path = repo_root.join("docs/product-specs/feature-tree.index.json");
        if !feature_tree_path.exists() && !surface_index_path.exists() {
            return Ok(None);
        }

        let surface_catalog =
            FeatureSurfaceCatalog::from_repo_root(repo_root).with_context(|| {
                format!("load feature surface catalog from {}", repo_root.display())
            })?;
        let feature_tree = FeatureTreeCatalog::from_repo_root(repo_root)
            .with_context(|| format!("load feature tree catalog from {}", repo_root.display()))?;

        Ok(Some(Self {
            surface_catalog,
            feature_tree,
        }))
    }

    pub(crate) fn analyze(&self, material: &SessionTraceMaterial) -> SessionAnalysis {
        let mut session = NormalizedSession::new(
            material.session_id.clone(),
            ProviderKey::Named("harness-monitor".to_string()),
        );
        session.tool_calls = material
            .tool_call_names
            .iter()
            .map(|tool_name| NormalizedToolCall {
                timestamp: None,
                turn_id: None,
                tool_name: tool_name.clone(),
                command_text: None,
                raw_arguments: None,
                status: ToolCallStatus::Succeeded,
                metadata: BTreeMap::new(),
            })
            .collect();
        session.file_events = material
            .changed_files
            .iter()
            .map(|path| NormalizedFileEvent {
                timestamp: None,
                turn_id: None,
                path: path.clone(),
                operation: FileOperationKind::Modified,
                evidence: FileEvidenceKind::Tool,
                metadata: BTreeMap::new(),
            })
            .collect();

        SessionAnalyzer::with_catalogs(&self.surface_catalog, &self.feature_tree).analyze(&session)
    }
}

pub(crate) fn summarize_routes(analysis: &SessionAnalysis, limit: usize) -> Vec<String> {
    if limit == 0 {
        return Vec::new();
    }

    analysis
        .surface_links
        .iter()
        .map(|link| link.route.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .take(limit)
        .collect()
}

pub(crate) fn summarize_features(analysis: &SessionAnalysis, limit: usize) -> Vec<String> {
    if limit == 0 {
        return Vec::new();
    }

    analysis
        .feature_links
        .iter()
        .map(|link| link.feature_name.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .take(limit)
        .collect()
}

pub(crate) fn cache_key_for_session_trace(material: &SessionTraceMaterial) -> String {
    let tool_names = if material.tool_call_names.is_empty() {
        String::new()
    } else {
        material.tool_call_names.join(",")
    };
    format!(
        "{}|{}|{}",
        material.session_id,
        material.changed_files.join(","),
        tool_names
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::db::Db;
    use crate::shared::models::{AttributionConfidence, FileEventRecord, SessionRecord};
    use serde_json::json;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn db_backed_session_trace_resolves_routes_and_features() {
        let dir = tempdir().expect("tempdir");
        let repo_root = dir.path();
        let repo_root_text = repo_root.to_string_lossy().to_string();

        fs::create_dir_all(repo_root.join("src/app/workspace/[workspaceId]/feature-explorer"))
            .expect("create page dir");
        fs::create_dir_all(repo_root.join("docs/product-specs")).expect("create docs dir");
        fs::write(
            repo_root.join("src/app/workspace/[workspaceId]/feature-explorer/page.tsx"),
            "export default function Page() { return null; }\n",
        )
        .expect("write page");
        fs::write(
            repo_root.join(
                "src/app/workspace/[workspaceId]/feature-explorer/feature-explorer-page-client.tsx",
            ),
            "export function FeatureExplorerPageClient() { return null; }\n",
        )
        .expect("write page client");
        fs::write(
            repo_root.join("docs/product-specs/FEATURE_TREE.md"),
            r#"---
feature_metadata:
  features:
    - id: feature-explorer
      name: Feature Explorer
      pages:
        - /workspace/:workspaceId/feature-explorer
      source_files:
        - src/app/workspace/[workspaceId]/feature-explorer/page.tsx
---

# Placeholder
"#,
        )
        .expect("write feature tree");

        let db = Db::open(&repo_root.join(".harness-monitor.sqlite")).expect("open db");
        db.upsert_session(&SessionRecord {
            session_id: "sess-1".to_string(),
            repo_root: repo_root_text.clone(),
            client: "codex".to_string(),
            cwd: repo_root_text.clone(),
            model: Some("gpt-5.4".to_string()),
            started_at_ms: 1_000,
            last_seen_at_ms: 2_000,
            ended_at_ms: None,
            status: "active".to_string(),
            tmux_session: None,
            tmux_window: None,
            tmux_pane: None,
            metadata_json: json!({}).to_string(),
        })
        .expect("upsert session");
        db.record_turn(
            "sess-1",
            &repo_root_text,
            Some("turn-1"),
            "codex",
            "PostToolUse",
            Some("Write"),
            None,
            1_500,
            &json!({"recovered_from_transcript": true}).to_string(),
        )
        .expect("record turn");
        db.insert_file_event(&FileEventRecord {
            id: None,
            repo_root: repo_root_text.clone(),
            rel_path:
                "src/app/workspace/[workspaceId]/feature-explorer/feature-explorer-page-client.tsx"
                    .to_string(),
            event_kind: "hook-file".to_string(),
            observed_at_ms: 1_500,
            session_id: Some("sess-1".to_string()),
            turn_id: Some("turn-1".to_string()),
            task_id: None,
            confidence: AttributionConfidence::Exact,
            source: "transcript_recovery".to_string(),
            metadata_json: json!({}).to_string(),
        })
        .expect("insert file event");

        let material = db
            .session_trace_material(&repo_root_text, "sess-1")
            .expect("session trace material");
        let catalogs = FeatureTraceCatalogs::load(repo_root)
            .expect("load catalogs")
            .expect("catalogs available");
        let analysis = catalogs.analyze(&material);

        assert_eq!(
            summarize_routes(&analysis, 4),
            vec!["/workspace/:workspaceId/feature-explorer".to_string()]
        );
        assert_eq!(
            summarize_features(&analysis, 4),
            vec!["Feature Explorer".to_string()]
        );
        assert_eq!(analysis.tool_call_counts.get("Write"), Some(&1));
    }

    #[test]
    fn loads_catalogs_from_surface_index_without_markdown() {
        let dir = tempdir().expect("tempdir");
        let repo_root = dir.path();

        fs::create_dir_all(repo_root.join("src/app/workspace/[workspaceId]/spec"))
            .expect("create page dir");
        fs::create_dir_all(repo_root.join("docs/product-specs")).expect("create docs dir");
        fs::write(
            repo_root.join("src/app/workspace/[workspaceId]/spec/page.tsx"),
            "export default function Page() { return null; }\n",
        )
        .expect("write page");
        fs::write(
            repo_root.join("docs/product-specs/feature-tree.index.json"),
            r#"{
  "pages": [
    {
      "route": "/workspace/:workspaceId/spec",
      "title": "Workspace / Spec",
      "description": "Spec board"
    }
  ],
  "contractApis": [
    {
      "domain": "spec",
      "method": "GET",
      "path": "/api/spec/issues",
      "summary": "List issue specs"
    }
  ],
  "metadata": {
    "features": [
      {
        "id": "spec-board",
        "name": "Spec Board",
        "pages": ["/workspace/:workspaceId/spec"],
        "sourceFiles": ["src/app/workspace/[workspaceId]/spec/page.tsx"]
      }
    ]
  }
}"#,
        )
        .expect("write feature tree index");

        let catalogs = FeatureTraceCatalogs::load(repo_root)
            .expect("load catalogs")
            .expect("catalogs available");
        let analysis = catalogs.analyze(&SessionTraceMaterial::new(
            "sess-2",
            vec!["src/app/workspace/[workspaceId]/spec/page.tsx".to_string()],
            vec!["Write".to_string()],
        ));

        assert_eq!(
            summarize_routes(&analysis, 4),
            vec!["/workspace/:workspaceId/spec".to_string()]
        );
        assert_eq!(
            summarize_features(&analysis, 4),
            vec!["Spec Board".to_string()]
        );
    }
}
