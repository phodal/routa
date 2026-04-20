use crate::error::TraceLearningError;
use crate::model::{NormalizedSession, SessionSourceRef};
use std::fs;
use std::path::Path;

pub trait SessionAdapter: Send + Sync {
    fn provider_name(&self) -> &'static str;

    fn can_parse(&self, source: &SessionSourceRef, lines: &[String]) -> bool;

    fn parse_lines(
        &self,
        source: &SessionSourceRef,
        lines: &[String],
    ) -> Result<NormalizedSession, TraceLearningError>;
}

#[derive(Default)]
pub struct AdapterRegistry {
    adapters: Vec<Box<dyn SessionAdapter>>,
}

impl AdapterRegistry {
    pub fn new() -> Self {
        Self {
            adapters: Vec::new(),
        }
    }

    pub fn with_adapter(mut self, adapter: impl SessionAdapter + 'static) -> Self {
        self.adapters.push(Box::new(adapter));
        self
    }

    pub fn parse_path(&self, path: &Path) -> Result<NormalizedSession, TraceLearningError> {
        let content = fs::read_to_string(path)?;
        let lines = content
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        let source = SessionSourceRef::from_path(path.to_path_buf());
        let adapter = self
            .adapters
            .iter()
            .find(|adapter| adapter.can_parse(&source, &lines))
            .ok_or_else(|| TraceLearningError::UnsupportedTranscript(path.display().to_string()))?;
        adapter.parse_lines(&source, &lines)
    }
}
