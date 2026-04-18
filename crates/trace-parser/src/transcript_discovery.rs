use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TranscriptSessionSource {
    Codex,
    ClaudeProjects,
    QoderProjects,
    AugmentSessions,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TranscriptClient {
    Codex,
    Claude,
    Qoder,
    Augment,
    All,
}

impl TranscriptClient {
    fn from_str(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "codex" | "codexcli" | "codex-acp" => Some(Self::Codex),
            "claude" | "claude-code" | "claude-code-sdk" | "claude sdk" => Some(Self::Claude),
            "qoder" | "qodercli" | "qoder-cli" => Some(Self::Qoder),
            "augment" | "auggie" | "augmentcode" => Some(Self::Augment),
            "all" => Some(Self::All),
            _ => None,
        }
    }

    fn allows(self, source: &TranscriptSessionSource) -> bool {
        match self {
            TranscriptClient::All => true,
            TranscriptClient::Codex => matches!(source, TranscriptSessionSource::Codex),
            TranscriptClient::Claude => matches!(source, TranscriptSessionSource::ClaudeProjects),
            TranscriptClient::Qoder => matches!(source, TranscriptSessionSource::QoderProjects),
            TranscriptClient::Augment => matches!(source, TranscriptSessionSource::AugmentSessions),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TranscriptSessionRoot {
    pub kind: TranscriptSessionSource,
    pub path: PathBuf,
}

pub fn discover_transcript_session_roots() -> Vec<TranscriptSessionRoot> {
    let home_dir = std::env::var_os("HOME").map(PathBuf::from);
    let claude_config_dir = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from);

    discover_transcript_session_roots_with_overrides_and_client(
        home_dir.as_deref(),
        claude_config_dir.as_deref(),
        None,
        None,
        None,
    )
}

pub fn discover_transcript_session_roots_for_client(
    client: Option<&str>,
) -> Vec<TranscriptSessionRoot> {
    let home_dir = std::env::var_os("HOME").map(PathBuf::from);
    let claude_config_dir = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from);
    discover_transcript_session_roots_with_overrides_and_client(
        home_dir.as_deref(),
        claude_config_dir.as_deref(),
        None,
        None,
        client,
    )
}

pub fn discover_transcript_session_roots_with_overrides(
    home_dir: Option<&Path>,
    claude_config_dir: Option<&Path>,
) -> Vec<TranscriptSessionRoot> {
    discover_transcript_session_roots_with_overrides_and_client(
        home_dir,
        claude_config_dir,
        None,
        None,
        None,
    )
}

pub fn discover_transcript_session_roots_with_overrides_and_client(
    home_dir: Option<&Path>,
    claude_config_dir: Option<&Path>,
    qoder_projects_dir: Option<&Path>,
    augment_sessions_dir: Option<&Path>,
    client: Option<&str>,
) -> Vec<TranscriptSessionRoot> {
    let filter = client.and_then(TranscriptClient::from_str);
    let mut roots = Vec::new();

    if filter
        .as_ref()
        .is_none_or(|client| client.allows(&TranscriptSessionSource::Codex))
    {
        if let Some(home_dir) = home_dir {
            let path = home_dir.join(".codex").join("sessions");
            if path.exists() {
                roots.push(TranscriptSessionRoot {
                    kind: TranscriptSessionSource::Codex,
                    path,
                });
            }
        }
    }

    if filter
        .as_ref()
        .is_none_or(|client| client.allows(&TranscriptSessionSource::ClaudeProjects))
    {
        let claude_config_root = claude_config_dir
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from))
            .or_else(|| home_dir.map(|home| home.join(".claude")));

        if let Some(claude_root) = claude_config_root {
            let path = claude_root.join("projects");
            if path.exists() {
                roots.push(TranscriptSessionRoot {
                    kind: TranscriptSessionSource::ClaudeProjects,
                    path,
                });
            }
        }
    }

    if filter
        .as_ref()
        .is_none_or(|client| client.allows(&TranscriptSessionSource::QoderProjects))
    {
        let qoder_root = qoder_projects_dir
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("QODER_PROJECTS_DIR").map(PathBuf::from))
            .or_else(|| home_dir.map(|home| home.join(".qoder").join("projects")));

        if let Some(qoder_root) = qoder_root {
            if qoder_root.exists() {
                roots.push(TranscriptSessionRoot {
                    kind: TranscriptSessionSource::QoderProjects,
                    path: qoder_root,
                });
            }
        }
    }

    if filter
        .as_ref()
        .is_none_or(|client| client.allows(&TranscriptSessionSource::AugmentSessions))
    {
        let augment_root = augment_sessions_dir
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("AUGMENT_SESSIONS_DIR").map(PathBuf::from))
            .or_else(|| home_dir.map(|home| home.join(".augment").join("sessions")));

        if let Some(augment_root) = augment_root {
            if augment_root.exists() {
                roots.push(TranscriptSessionRoot {
                    kind: TranscriptSessionSource::AugmentSessions,
                    path: augment_root,
                });
            }
        }
    }

    roots
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn prefers_override_for_claude_config_dir() {
        let dir = tempdir().expect("tempdir");
        let home = dir.path().join("home");
        let custom_claude_root = dir.path().join("custom-claude").join("config");
        let codex_root = home.join(".codex").join("sessions");
        let default_claude_root = home.join(".claude").join("projects");
        let override_claude_root = custom_claude_root.join("projects");

        std::fs::create_dir_all(&codex_root).expect("create codex root");
        std::fs::create_dir_all(&default_claude_root).expect("create default claude projects root");
        std::fs::create_dir_all(&override_claude_root)
            .expect("create override claude projects root");

        let roots = discover_transcript_session_roots_with_overrides(
            Some(&home),
            Some(&custom_claude_root),
        );

        assert!(
            roots
                .iter()
                .any(|root| root.kind == TranscriptSessionSource::Codex && root.path == codex_root)
        );
        assert!(roots.iter().any(|root| {
            root.kind == TranscriptSessionSource::ClaudeProjects && root.path == override_claude_root
        }));
        assert!(!roots.iter().any(|root| {
            root.kind == TranscriptSessionSource::ClaudeProjects
                && root.path == default_claude_root
        }));
    }

    #[test]
    fn filters_roots_by_client_name() {
        let dir = tempdir().expect("tempdir");
        let home = dir.path().join("home");
        let qoder_root = home.join(".qoder").join("projects");
        let augment_root = home.join(".augment").join("sessions");
        let claude_root = home.join(".claude").join("projects");
        let codex_root = home.join(".codex").join("sessions");

        for root in [&qoder_root, &augment_root, &claude_root, &codex_root] {
            std::fs::create_dir_all(root).expect("create root");
        }

        let qoder_only = discover_transcript_session_roots_with_overrides_and_client(
            Some(&home),
            None,
            None,
            None,
            Some("qoder"),
        );
        assert_eq!(qoder_only.len(), 1);
        assert!(qoder_only
            .iter()
            .all(|root| root.kind == TranscriptSessionSource::QoderProjects));

        let augment_only = discover_transcript_session_roots_for_client(Some("auggie"));
        assert!(augment_only
            .iter()
            .all(|root| root.kind == TranscriptSessionSource::AugmentSessions));

        let all = discover_transcript_session_roots_for_client(Some("all"));
        assert!(all.iter().any(|root| root.kind == TranscriptSessionSource::Codex));
        assert!(all
            .iter()
            .any(|root| root.kind == TranscriptSessionSource::ClaudeProjects));
        assert!(all
            .iter()
            .any(|root| root.kind == TranscriptSessionSource::QoderProjects));
        assert!(all
            .iter()
            .any(|root| root.kind == TranscriptSessionSource::AugmentSessions));
    }

    #[test]
    fn qoder_and_augment_roots_can_be_overridden() {
        let dir = tempdir().expect("tempdir");
        let home = dir.path().join("home");
        let custom_qoder = dir.path().join("qoder-overrides");
        let custom_augment = dir.path().join("augment-overrides");
        let qoder_root = custom_qoder.join("projects");
        let augment_root = custom_augment.join("sessions");
        let default_qoder_root = home.join(".qoder").join("projects");
        let default_augment_root = home.join(".augment").join("sessions");

        std::fs::create_dir_all(&qoder_root).expect("create override qoder");
        std::fs::create_dir_all(&augment_root).expect("create override augment");

        let roots = discover_transcript_session_roots_with_overrides_and_client(
            Some(&home),
            None,
            Some(&qoder_root),
            Some(&augment_root),
            Some("all"),
        );

        assert!(roots
            .iter()
            .any(|root| root.kind == TranscriptSessionSource::QoderProjects && root.path == qoder_root));
        assert!(roots
            .iter()
            .any(|root| root.kind == TranscriptSessionSource::AugmentSessions && root.path == augment_root));
        assert!(
            !roots
                .iter()
                .any(|root| root.kind == TranscriptSessionSource::QoderProjects
                    && root.path == default_qoder_root)
        );
        assert!(
            !roots
                .iter()
                .any(|root| root.kind == TranscriptSessionSource::AugmentSessions
                    && root.path == default_augment_root)
        );
    }
}
