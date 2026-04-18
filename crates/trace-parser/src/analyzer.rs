use crate::catalog::{FeatureSurfaceCatalog, FeatureTreeCatalog};
use crate::model::NormalizedSession;
use std::collections::{BTreeMap, BTreeSet};

pub use feature_trace::{FeatureTraceInput, ProductFeatureLink, SessionAnalysis};

pub struct SessionAnalyzer<'a> {
    inner: feature_trace::SessionAnalyzer<'a>,
}

impl<'a> Default for SessionAnalyzer<'a> {
    fn default() -> Self {
        Self::new()
    }
}

impl<'a> SessionAnalyzer<'a> {
    pub fn new() -> Self {
        Self {
            inner: feature_trace::SessionAnalyzer::new(),
        }
    }

    pub fn with_catalog(catalog: &'a FeatureSurfaceCatalog) -> Self {
        Self {
            inner: feature_trace::SessionAnalyzer::with_catalog(catalog),
        }
    }

    pub fn with_feature_tree(feature_tree: &'a FeatureTreeCatalog) -> Self {
        Self {
            inner: feature_trace::SessionAnalyzer::with_feature_tree(feature_tree),
        }
    }

    pub fn with_catalogs(
        catalog: &'a FeatureSurfaceCatalog,
        feature_tree: &'a FeatureTreeCatalog,
    ) -> Self {
        Self {
            inner: feature_trace::SessionAnalyzer::with_catalogs(catalog, feature_tree),
        }
    }

    pub fn analyze(&self, session: &NormalizedSession) -> SessionAnalysis {
        let mut changed_file_set = BTreeSet::new();
        let mut tool_call_counts = BTreeMap::new();

        for tool_call in &session.tool_calls {
            *tool_call_counts
                .entry(tool_call.tool_name.clone())
                .or_insert(0) += 1;
        }

        for file_event in &session.file_events {
            changed_file_set.insert(file_event.path.clone());
        }

        let input = FeatureTraceInput {
            session_id: session.session_id.clone(),
            changed_files: changed_file_set.into_iter().collect(),
            tool_call_names: tool_call_counts
                .into_iter()
                .flat_map(|(tool_name, count)| std::iter::repeat_n(tool_name, count))
                .collect(),
        };

        self.inner.analyze_input(&input)
    }
}
