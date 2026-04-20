use crate::catalog::{
    FeatureSurfaceCatalog, FeatureSurfaceLink, FeatureTreeCatalog, ProductFeatureLink,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const MAX_PROMPT_PREVIEWS: usize = 4;
const MAX_PROMPT_PREVIEW_LENGTH: usize = 180;
const MAX_CONTEXT_ITEMS: usize = 5;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeatureTraceInput {
    pub session_id: String,
    #[serde(default)]
    pub changed_files: Vec<String>,
    #[serde(default)]
    pub tool_call_names: Vec<String>,
    #[serde(default)]
    pub prompt_previews: Vec<String>,
    #[serde(default)]
    pub file_operations: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionAnalysis {
    pub session_id: String,
    pub changed_files: Vec<String>,
    pub tool_call_counts: BTreeMap<String, usize>,
    #[serde(default)]
    pub prompt_previews: Vec<String>,
    #[serde(default)]
    pub file_operation_counts: BTreeMap<String, usize>,
    pub surface_links: Vec<FeatureSurfaceLink>,
    pub feature_links: Vec<ProductFeatureLink>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountSummary {
    pub name: String,
    pub count: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeaturePromptContext {
    pub feature_id: String,
    pub session_count: usize,
    pub prompt_previews: Vec<CountSummary>,
    pub tool_call_counts: Vec<CountSummary>,
    pub file_operation_counts: Vec<CountSummary>,
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

        let prompt_previews = summarize_prompt_previews(&input.prompt_previews);

        let mut file_operation_counts = BTreeMap::new();
        for operation in &input.file_operations {
            let normalized = normalize_file_operation(operation);
            if normalized.is_empty() {
                continue;
            }
            *file_operation_counts.entry(normalized).or_insert(0) += 1;
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
            prompt_previews,
            file_operation_counts,
            surface_links,
            feature_links,
        }
    }
}

pub fn build_feature_prompt_context(
    feature_id: &str,
    analyses: &[SessionAnalysis],
) -> FeaturePromptContext {
    let matching: Vec<&SessionAnalysis> = analyses
        .iter()
        .filter(|analysis| {
            analysis
                .feature_links
                .iter()
                .any(|link| link.feature_id == feature_id)
        })
        .collect();

    let mut prompt_counts = BTreeMap::new();
    let mut tool_call_counts = BTreeMap::new();
    let mut file_operation_counts = BTreeMap::new();

    for analysis in &matching {
        for prompt in &analysis.prompt_previews {
            *prompt_counts.entry(prompt.clone()).or_insert(0) += 1;
        }
        for (tool_name, count) in &analysis.tool_call_counts {
            *tool_call_counts.entry(tool_name.clone()).or_insert(0) += *count;
        }
        for (operation, count) in &analysis.file_operation_counts {
            *file_operation_counts.entry(operation.clone()).or_insert(0) += *count;
        }
    }

    FeaturePromptContext {
        feature_id: feature_id.to_string(),
        session_count: matching.len(),
        prompt_previews: summarize_counts(prompt_counts),
        tool_call_counts: summarize_counts(tool_call_counts),
        file_operation_counts: summarize_counts(file_operation_counts),
    }
}

fn summarize_prompt_previews(prompts: &[String]) -> Vec<String> {
    let mut previews = Vec::new();

    for prompt in prompts {
        let normalized = normalize_prompt_preview(prompt);
        if normalized.is_empty() || previews.contains(&normalized) {
            continue;
        }
        previews.push(normalized);
        if previews.len() >= MAX_PROMPT_PREVIEWS {
            break;
        }
    }

    previews
}

fn normalize_prompt_preview(prompt: &str) -> String {
    let normalized = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.len() <= MAX_PROMPT_PREVIEW_LENGTH {
        return normalized;
    }

    let preview = normalized
        .chars()
        .take(MAX_PROMPT_PREVIEW_LENGTH.saturating_sub(3))
        .collect::<String>();

    format!("{}...", preview.trim_end())
}

fn normalize_file_operation(operation: &str) -> String {
    operation.trim().to_ascii_lowercase()
}

fn summarize_counts(counts: BTreeMap<String, usize>) -> Vec<CountSummary> {
    let mut items = counts
        .into_iter()
        .map(|(name, count)| CountSummary { name, count })
        .collect::<Vec<_>>();

    items.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.name.cmp(&right.name))
    });
    items.truncate(MAX_CONTEXT_ITEMS);
    items
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
                source_path: "src/app/workspace/[workspaceId]/sessions/[sessionId]/page.tsx"
                    .to_string(),
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
                ..Default::default()
            }],
            ..Default::default()
        };
        let input = FeatureTraceInput {
            session_id: "sess-1".to_string(),
            changed_files: vec![
                "src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx"
                    .to_string(),
            ],
            tool_call_names: vec!["apply_patch".to_string(), "apply_patch".to_string()],
            prompt_previews: vec![
                " Investigate   session recovery route ".to_string(),
                "Investigate session recovery route".to_string(),
                "Update the session page and API route with trace learning context".to_string(),
            ],
            file_operations: vec![
                "modified".to_string(),
                "modified".to_string(),
                "renamed".to_string(),
            ],
        };

        let analysis =
            SessionAnalyzer::with_catalogs(&surface_catalog, &feature_tree).analyze_input(&input);

        assert_eq!(analysis.surface_links.len(), 1);
        assert_eq!(analysis.feature_links.len(), 1);
        assert_eq!(analysis.feature_links[0].feature_id, "session-recovery");
        assert_eq!(
            analysis.surface_links[0].confidence,
            SurfaceLinkConfidence::Medium
        );
        assert_eq!(analysis.tool_call_counts.get("apply_patch"), Some(&2));
        assert_eq!(analysis.prompt_previews.len(), 2);
        assert_eq!(
            analysis.prompt_previews[0],
            "Investigate session recovery route"
        );
        assert_eq!(analysis.file_operation_counts.get("modified"), Some(&2));
        assert_eq!(analysis.file_operation_counts.get("renamed"), Some(&1));
    }

    #[test]
    fn normalize_prompt_preview_handles_multibyte_characters_without_panicking() {
        let prompt = "分析一下，当前应用哪些高价值功能可以放在菜单栏？然后结合这个文档看看？同时支持 macOS 和 Windows、Linux 之类的？";
        let repeated = prompt.repeat(4);

        let normalized = normalize_prompt_preview(&repeated);

        assert!(normalized.ends_with("..."));
        assert!(normalized.chars().count() <= MAX_PROMPT_PREVIEW_LENGTH);
        assert!(normalized.contains('分'));
    }

    #[test]
    fn build_feature_prompt_context_aggregates_matching_sessions_only() {
        let matching = SessionAnalysis {
            session_id: "sess-1".to_string(),
            changed_files: vec!["src/app/page.tsx".to_string()],
            tool_call_counts: BTreeMap::from([
                ("apply_patch".to_string(), 2),
                ("Read".to_string(), 1),
            ]),
            prompt_previews: vec![
                "Refine the feature explorer detail panel".to_string(),
                "Refine the feature explorer detail panel".to_string(),
            ],
            file_operation_counts: BTreeMap::from([("modified".to_string(), 3)]),
            surface_links: Vec::new(),
            feature_links: vec![ProductFeatureLink {
                feature_id: "feature-explorer".to_string(),
                feature_name: "Feature Explorer".to_string(),
                route: Some("/workspace/:workspaceId/feature-explorer".to_string()),
                via_path: "src/app/page.tsx".to_string(),
                confidence: SurfaceLinkConfidence::High,
            }],
        };
        let second_match = SessionAnalysis {
            session_id: "sess-2".to_string(),
            changed_files: vec!["src/app/page.tsx".to_string()],
            tool_call_counts: BTreeMap::from([("Read".to_string(), 3)]),
            prompt_previews: vec!["Trace repeated file reads in feature explorer".to_string()],
            file_operation_counts: BTreeMap::from([
                ("modified".to_string(), 1),
                ("renamed".to_string(), 1),
            ]),
            surface_links: Vec::new(),
            feature_links: vec![ProductFeatureLink {
                feature_id: "feature-explorer".to_string(),
                feature_name: "Feature Explorer".to_string(),
                route: Some("/workspace/:workspaceId/feature-explorer".to_string()),
                via_path: "src/app/page.tsx".to_string(),
                confidence: SurfaceLinkConfidence::High,
            }],
        };
        let non_matching = SessionAnalysis {
            session_id: "sess-3".to_string(),
            changed_files: vec!["src/app/other.tsx".to_string()],
            tool_call_counts: BTreeMap::from([("Write".to_string(), 5)]),
            prompt_previews: vec!["Do not include me".to_string()],
            file_operation_counts: BTreeMap::from([("deleted".to_string(), 2)]),
            surface_links: Vec::new(),
            feature_links: vec![ProductFeatureLink {
                feature_id: "session-recovery".to_string(),
                feature_name: "Session Recovery".to_string(),
                route: None,
                via_path: "src/app/other.tsx".to_string(),
                confidence: SurfaceLinkConfidence::High,
            }],
        };

        let context = build_feature_prompt_context(
            "feature-explorer",
            &[matching, second_match, non_matching],
        );

        assert_eq!(context.feature_id, "feature-explorer");
        assert_eq!(context.session_count, 2);
        assert_eq!(
            context.prompt_previews[0].name,
            "Refine the feature explorer detail panel"
        );
        assert_eq!(context.prompt_previews[0].count, 2);
        assert_eq!(context.tool_call_counts[0].name, "Read");
        assert_eq!(context.tool_call_counts[0].count, 4);
        assert_eq!(context.file_operation_counts[0].name, "modified");
        assert_eq!(context.file_operation_counts[0].count, 4);
    }
}
