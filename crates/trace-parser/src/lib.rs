pub mod analyzer;
pub mod catalog;
pub mod codex;
pub mod error;
pub mod model;
pub mod provider;
pub mod transcript_discovery;
pub mod transcript_parser;

pub use analyzer::{SessionAnalysis, SessionAnalyzer};
pub use catalog::{
    FeatureSurface, FeatureSurfaceCatalog, FeatureSurfaceKind, FeatureSurfaceLink,
    FeatureTreeCatalog, ProductFeature, ProductFeatureLink, SurfaceLinkConfidence,
};
pub use codex::CodexSessionAdapter;
pub use error::TraceLearningError;
pub use model::{
    FileEvidenceKind, FileOperationKind, NormalizedFileEvent, NormalizedPrompt, NormalizedSession,
    NormalizedToolCall, PromptRole, ProviderKey, SessionSourceRef, ToolCallStatus,
};
pub use provider::{AdapterRegistry, SessionAdapter};
pub use transcript_discovery::{
    discover_transcript_session_roots, discover_transcript_session_roots_for_client,
    discover_transcript_session_roots_with_overrides, TranscriptSessionRoot,
    TranscriptSessionSource,
};
pub use transcript_parser::{
    collect_active_transcript_summaries, collect_broad_transcript_summaries,
    collect_recent_claude_project_transcripts, collect_recent_codex_transcripts,
    collect_recent_transcript_summaries, collect_recent_transcript_summaries_for_client,
    collect_recent_transcripts, collect_recent_transcripts_from_dirs,
    parse_matching_transcript_summaries, parse_transcript_backfill,
    recent_prompt_previews_from_transcript, recover_prompt_from_transcript,
    TranscriptRecoveredEvent, TranscriptSessionBackfill,
};
