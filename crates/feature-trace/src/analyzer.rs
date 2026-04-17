use crate::catalog::{
    FeatureSurfaceCatalog, FeatureSurfaceLink, FeatureTreeCatalog, ProductFeatureLink,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeatureTraceInput {
    pub session_id: String,
    pub changed_files: Vec<String>,
    pub tool_call_names: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionAnalysis {
    pub session_id: String,
    pub changed_files: Vec<String>,
    pub tool_call_counts: BTreeMap<String, usize>,
    pub surface_links: Vec<FeatureSurfaceLink>,
    pub feature_links: Vec<ProductFeatureLink>,
}

pub struct SessionAnalyzer<'a> {
    surface_catalog: Option<&'a FeatureSurfaceCatalog>,
    feature_tree: Option<&'a FeatureTreeCatalog>,
}

impl<'a> Default for SessionAnalyzer<'a> {
    fn default() -> Self {
        Self::new()
    }
}

impl<'a> SessionAnalyzer<'a> {
    pub fn new() -> Self {
        Self {
            surface_catalog: None,
            feature_tree: None,
        }
    }

    pub fn with_catalog(catalog: &'a FeatureSurfaceCatalog) -> Self {
        Self {
            surface_catalog: Some(catalog),
            feature_tree: None,
        }
    }

    pub fn with_catalogs(
        surface_catalog: &'a FeatureSurfaceCatalog,
        feature_tree: &'a FeatureTreeCatalog,
    ) -> Self {
        Self {
            surface_catalog: Some(surface_catalog),
            feature_tree: Some(feature_tree),
        }
    }

    pub fn with_feature_tree(feature_tree: &'a FeatureTreeCatalog) -> Self {
        Self {
            surface_catalog: None,
            feature_tree: Some(feature_tree),
        }
    }

    pub fn analyze_input(&self, input: &FeatureTraceInput) -> SessionAnalysis {
        let changed_files = input
            .changed_files
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();

        let mut tool_call_counts = BTreeMap::new();
        for tool_name in &input.tool_call_names {
            *tool_call_counts.entry(tool_name.clone()).or_insert(0) += 1;
        }

        let mut surface_links = Vec::new();
        if let Some(catalog) = self.surface_catalog {
            for changed_file in &changed_files {
                surface_links.extend(catalog.best_links_for_path(changed_file));
            }
            surface_links.sort_by(|a, b| {
                a.route
                    .cmp(&b.route)
                    .then(a.via_path.cmp(&b.via_path))
                    .then(a.source_path.cmp(&b.source_path))
            });
            surface_links.dedup_by(|a, b| {
                a.route == b.route && a.via_path == b.via_path && a.source_path == b.source_path
            });
        }

        let mut feature_links = Vec::new();
        if let Some(feature_tree) = self.feature_tree {
            if !surface_links.is_empty() {
                for surface_link in &surface_links {
                    feature_links.extend(feature_tree.best_links_for_surface(surface_link));
                }
            } else {
                for changed_file in &changed_files {
                    feature_links.extend(feature_tree.best_links_for_path(changed_file));
                }
            }
            feature_links.sort_by(|a, b| {
                a.feature_id
                    .cmp(&b.feature_id)
                    .then(a.via_path.cmp(&b.via_path))
                    .then(a.route.cmp(&b.route))
            });
            feature_links.dedup_by(|a, b| {
                a.feature_id == b.feature_id && a.via_path == b.via_path && a.route == b.route
            });
        }

        SessionAnalysis {
            session_id: input.session_id.clone(),
            changed_files,
            tool_call_counts,
            surface_links,
            feature_links,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{
        FeatureSurface, FeatureSurfaceKind, ProductFeature, SurfaceLinkConfidence,
    };

    #[test]
    fn analyzer_projects_changed_files_to_surfaces_and_features() {
        let surface_catalog = FeatureSurfaceCatalog {
            surfaces: vec![FeatureSurface {
                kind: FeatureSurfaceKind::Page,
                route: "/workspace/:workspaceId/sessions/:sessionId".to_string(),
                source_path: "src/app/workspace/[workspaceId]/sessions/[sessionId]/page.tsx".to_string(),
                source_dir: "src/app/workspace/[workspaceId]/sessions/[sessionId]".to_string(),
            }],
        };
        let feature_tree = FeatureTreeCatalog {
            features: vec![ProductFeature {
                id: "session-recovery".to_string(),
                name: "Session Recovery".to_string(),
                pages: vec!["/workspace/:workspaceId/sessions/:sessionId".to_string()],
                apis: Vec::new(),
                source_files: vec![
                    "src/app/workspace/[workspaceId]/sessions/[sessionId]/page.tsx".to_string(),
                ],
            }],
        };
        let input = FeatureTraceInput {
            session_id: "sess-1".to_string(),
            changed_files: vec![
                "src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx"
                    .to_string(),
            ],
            tool_call_names: vec!["apply_patch".to_string(), "apply_patch".to_string()],
        };

        let analysis = SessionAnalyzer::with_catalogs(&surface_catalog, &feature_tree)
            .analyze_input(&input);

        assert_eq!(analysis.surface_links.len(), 1);
        assert_eq!(analysis.feature_links.len(), 1);
        assert_eq!(analysis.feature_links[0].feature_id, "session-recovery");
        assert_eq!(
            analysis.surface_links[0].confidence,
            SurfaceLinkConfidence::Medium
        );
        assert_eq!(analysis.tool_call_counts.get("apply_patch"), Some(&2));
    }
}
