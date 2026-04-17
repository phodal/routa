use thiserror::Error;

#[derive(Debug, Error)]
pub enum FeatureTraceError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("yaml error: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("feature tree frontmatter not found")]
    MissingFrontmatter,
}
