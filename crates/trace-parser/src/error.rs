use thiserror::Error;

#[derive(Debug, Error)]
pub enum TraceLearningError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("unsupported transcript source: {0}")]
    UnsupportedTranscript(String),

    #[error("missing required session metadata: {0}")]
    MissingMetadata(&'static str),
}
