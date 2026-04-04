//! LocalSessionProvider — JSONL file-based session storage.
//!
//! Stores sessions under `~/.routa/projects/{folder-slug}/sessions/{uuid}.jsonl`
//!
//! Each session file contains:
//! - A metadata entry (first line)
//! - Optional summary entries
//! - Message entries (one per line, appended)

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;

use super::folder_slug::{get_sessions_dir, to_folder_slug};
use super::jsonl_writer::{list_jsonl_files, read_jsonl_file, JsonlWriter};

/// Session metadata entry in JSONL file.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SessionJsonlEntry {
    #[serde(rename = "metadata")]
    Metadata(SessionMetadata),
    #[serde(rename = "summary")]
    Summary(SessionSummary),
    #[serde(other)]
    Message,
}

/// Raw JSONL entry for flexible deserialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawJsonlEntry {
    #[serde(rename = "type")]
    pub entry_type: Option<String>,
    #[serde(flatten)]
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMetadata {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub name: Option<String>,
    pub cwd: String,
    pub branch: Option<String>,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "routaAgentId")]
    pub routa_agent_id: Option<String>,
    pub provider: Option<String>,
    pub role: Option<String>,
    #[serde(rename = "modeId")]
    pub mode_id: Option<String>,
    pub model: Option<String>,
    #[serde(rename = "customCommand")]
    pub custom_command: Option<String>,
    #[serde(rename = "customArgs", default)]
    pub custom_args: Vec<String>,
    #[serde(rename = "parentSessionId")]
    pub parent_session_id: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    pub summary: String,
    #[serde(rename = "leafUuid")]
    pub leaf_uuid: Option<String>,
}

/// A session record for listing/retrieval.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecord {
    pub id: String,
    pub name: Option<String>,
    pub cwd: String,
    pub branch: Option<String>,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "routaAgentId")]
    pub routa_agent_id: Option<String>,
    pub provider: Option<String>,
    pub role: Option<String>,
    #[serde(rename = "modeId")]
    pub mode_id: Option<String>,
    pub model: Option<String>,
    #[serde(rename = "customCommand")]
    pub custom_command: Option<String>,
    #[serde(rename = "customArgs", default)]
    pub custom_args: Vec<String>,
    #[serde(rename = "parentSessionId")]
    pub parent_session_id: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

pub struct LocalSessionProvider {
    project_path: String,
    storage_root: Option<PathBuf>,
}

impl LocalSessionProvider {
    pub fn new(project_path: &str) -> Self {
        Self {
            project_path: project_path.to_string(),
            storage_root: None,
        }
    }

    pub fn new_with_storage_root(project_path: &str, storage_root: impl Into<PathBuf>) -> Self {
        Self {
            project_path: project_path.to_string(),
            storage_root: Some(storage_root.into()),
        }
    }

    fn sessions_dir(&self) -> PathBuf {
        self.storage_root.as_ref().map_or_else(
            || get_sessions_dir(&self.project_path),
            |root| {
                root.join(".routa")
                    .join("projects")
                    .join(to_folder_slug(&self.project_path))
                    .join("sessions")
            },
        )
    }

    fn session_file_path(&self, session_id: &str) -> PathBuf {
        self.sessions_dir().join(format!("{}.jsonl", session_id))
    }

    /// Save or update a session (writes metadata to JSONL file).
    pub async fn save(&self, session: &SessionRecord) -> Result<(), std::io::Error> {
        let file_path = self.session_file_path(&session.id);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let metadata = RawJsonlEntry {
            entry_type: Some("metadata".to_string()),
            data: serde_json::json!({
                "sessionId": session.id,
                "name": session.name,
                "cwd": session.cwd,
                "branch": session.branch,
                "workspaceId": session.workspace_id,
                "routaAgentId": session.routa_agent_id,
                "provider": session.provider,
                "role": session.role,
                "modeId": session.mode_id,
                "model": session.model,
                "customCommand": session.custom_command,
                "customArgs": session.custom_args,
                "parentSessionId": session.parent_session_id,
                "createdAt": session.created_at,
            }),
        };

        // Check if file exists — if so, update metadata in place
        if file_path.exists() {
            let entries: Vec<RawJsonlEntry> = read_jsonl_file(&file_path).await;
            let mut updated = false;
            let mut lines: Vec<String> = Vec::new();
            for entry in &entries {
                if entry.entry_type.as_deref() == Some("metadata") {
                    lines
                        .push(serde_json::to_string(&metadata).map_err(|e| {
                            std::io::Error::new(std::io::ErrorKind::InvalidData, e)
                        })?);
                    updated = true;
                } else {
                    lines
                        .push(serde_json::to_string(entry).map_err(|e| {
                            std::io::Error::new(std::io::ErrorKind::InvalidData, e)
                        })?);
                }
            }
            if !updated {
                lines.insert(
                    0,
                    serde_json::to_string(&metadata)
                        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?,
                );
            }
            let content = lines.join("\n") + "\n";
            fs::write(&file_path, content).await?;
        } else {
            let writer = JsonlWriter::new(&file_path);
            writer.append(&metadata).await?;
        }
        Ok(())
    }

    /// Get a session by ID.
    pub async fn get(&self, session_id: &str) -> Option<SessionRecord> {
        let file_path = self.session_file_path(session_id);
        let entries: Vec<RawJsonlEntry> = read_jsonl_file(&file_path).await;
        if entries.is_empty() {
            return None;
        }

        // Find metadata entry
        let metadata = entries
            .iter()
            .find(|e| e.entry_type.as_deref() == Some("metadata"))?;
        let data = &metadata.data;

        let created_at = data["createdAt"].as_str().unwrap_or_default().to_string();

        // Find last timestamp for updatedAt
        let updated_at = entries
            .iter()
            .rev()
            .find_map(|e| e.data["timestamp"].as_str())
            .unwrap_or(&created_at)
            .to_string();

        // Derive name: explicit name > summary > first user message > default
        let name = data["name"]
            .as_str()
            .map(|s| s.to_string())
            .or_else(|| {
                entries
                    .iter()
                    .find(|e| e.entry_type.as_deref() == Some("summary"))
                    .and_then(|e| e.data["summary"].as_str().map(|s| s.to_string()))
            })
            .or_else(|| {
                entries
                    .iter()
                    .find(|e| e.entry_type.as_deref() == Some("user_message"))
                    .and_then(|e| {
                        let msg = e.data["message"].as_str().unwrap_or_default();
                        if msg.len() > 80 {
                            Some(format!("{}…", &msg[..80]))
                        } else if !msg.is_empty() {
                            Some(msg.to_string())
                        } else {
                            None
                        }
                    })
            })
            .or_else(|| Some("Routa Session".to_string()));

        Some(SessionRecord {
            id: session_id.to_string(),
            name,
            cwd: data["cwd"].as_str().unwrap_or_default().to_string(),
            branch: data["branch"].as_str().map(|s| s.to_string()),
            workspace_id: data["workspaceId"]
                .as_str()
                .unwrap_or("default")
                .to_string(),
            routa_agent_id: data["routaAgentId"].as_str().map(|s| s.to_string()),
            provider: data["provider"].as_str().map(|s| s.to_string()),
            role: data["role"].as_str().map(|s| s.to_string()),
            mode_id: data["modeId"].as_str().map(|s| s.to_string()),
            model: data["model"].as_str().map(|s| s.to_string()),
            custom_command: data["customCommand"].as_str().map(|s| s.to_string()),
            custom_args: data["customArgs"]
                .as_array()
                .map(|items| {
                    items.iter()
                        .filter_map(|item| item.as_str().map(|value| value.to_string()))
                        .collect()
                })
                .unwrap_or_default(),
            parent_session_id: data["parentSessionId"].as_str().map(|s| s.to_string()),
            created_at,
            updated_at,
        })
    }

    /// List all sessions, optionally filtered by workspace.
    pub async fn list(&self, workspace_id: Option<&str>) -> Vec<SessionRecord> {
        let files = list_jsonl_files(self.sessions_dir()).await;
        let mut sessions = Vec::new();

        for file in files {
            let session_id = file
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();
            if let Some(session) = self.get(&session_id).await {
                if let Some(ws) = workspace_id {
                    if session.workspace_id != ws {
                        continue;
                    }
                }
                sessions.push(session);
            }
        }

        // Sort by updated_at descending
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        sessions
    }

    /// Delete a session.
    pub async fn delete(&self, session_id: &str) -> Result<(), std::io::Error> {
        let file_path = self.session_file_path(session_id);
        match fs::remove_file(&file_path).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        }
    }

    /// Append a message entry to a session's JSONL file.
    pub async fn append_message(
        &self,
        session_id: &str,
        entry: &serde_json::Value,
    ) -> Result<(), std::io::Error> {
        let writer = JsonlWriter::new(self.session_file_path(session_id));
        writer.append(entry).await
    }

    /// Get message history for a session (excludes metadata and summary entries).
    pub async fn get_history(&self, session_id: &str) -> Vec<serde_json::Value> {
        let file_path = self.session_file_path(session_id);
        let entries: Vec<RawJsonlEntry> = read_jsonl_file(&file_path).await;
        entries
            .into_iter()
            .filter(|e| {
                let t = e.entry_type.as_deref();
                t != Some("metadata") && t != Some("summary")
            })
            .map(|e| e.data)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_session(id: &str, cwd: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            name: Some("Test Session".to_string()),
            cwd: cwd.to_string(),
            branch: Some("main".to_string()),
            workspace_id: "ws-1".to_string(),
            routa_agent_id: Some("agent-1".to_string()),
            provider: Some("test".to_string()),
            role: Some("ROUTA".to_string()),
            mode_id: None,
            model: None,
            custom_command: None,
            custom_args: Vec::new(),
            parent_session_id: None,
            created_at: "2025-01-01T00:00:00.000Z".to_string(),
            updated_at: "2025-01-01T00:00:00.000Z".to_string(),
        }
    }

    #[tokio::test]
    async fn test_save_and_get() {
        let tmp = TempDir::new().unwrap();
        let project_path = tmp.path().join("my-project");
        std::fs::create_dir_all(&project_path).unwrap();
        let provider =
            LocalSessionProvider::new_with_storage_root(project_path.to_str().unwrap(), tmp.path());

        let mut session = make_session("sess-1", project_path.to_str().unwrap());
        session.custom_command = Some("uvx".to_string());
        session.custom_args = vec!["codex-acp".to_string(), "--stdio".to_string()];
        provider.save(&session).await.unwrap();

        let loaded = provider.get("sess-1").await;
        assert!(loaded.is_some());
        let loaded = loaded.unwrap();
        assert_eq!(loaded.id, "sess-1");
        assert_eq!(loaded.name.as_deref(), Some("Test Session"));
        assert_eq!(loaded.workspace_id, "ws-1");
        assert_eq!(loaded.custom_command.as_deref(), Some("uvx"));
        assert_eq!(
            loaded.custom_args,
            vec!["codex-acp".to_string(), "--stdio".to_string()]
        );
    }

    #[tokio::test]
    async fn test_list_sessions() {
        let tmp = TempDir::new().unwrap();
        let project_path = tmp.path().join("my-project");
        std::fs::create_dir_all(&project_path).unwrap();
        let provider =
            LocalSessionProvider::new_with_storage_root(project_path.to_str().unwrap(), tmp.path());

        let s1 = make_session("sess-1", project_path.to_str().unwrap());
        let mut s2 = make_session("sess-2", project_path.to_str().unwrap());
        s2.workspace_id = "ws-2".to_string();

        provider.save(&s1).await.unwrap();
        provider.save(&s2).await.unwrap();

        // List all
        let all = provider.list(None).await;
        assert_eq!(all.len(), 2);

        // Filter by workspace
        let ws1 = provider.list(Some("ws-1")).await;
        assert_eq!(ws1.len(), 1);
        assert_eq!(ws1[0].id, "sess-1");
    }

    #[tokio::test]
    async fn test_delete_session() {
        let tmp = TempDir::new().unwrap();
        let project_path = tmp.path().join("my-project");
        std::fs::create_dir_all(&project_path).unwrap();
        let provider =
            LocalSessionProvider::new_with_storage_root(project_path.to_str().unwrap(), tmp.path());

        let session = make_session("sess-1", project_path.to_str().unwrap());
        provider.save(&session).await.unwrap();
        assert!(provider.get("sess-1").await.is_some());

        provider.delete("sess-1").await.unwrap();
        assert!(provider.get("sess-1").await.is_none());
    }

    #[tokio::test]
    async fn test_append_and_get_history() {
        let tmp = TempDir::new().unwrap();
        let project_path = tmp.path().join("my-project");
        std::fs::create_dir_all(&project_path).unwrap();
        let provider =
            LocalSessionProvider::new_with_storage_root(project_path.to_str().unwrap(), tmp.path());

        let session = make_session("sess-1", project_path.to_str().unwrap());
        provider.save(&session).await.unwrap();

        let msg = serde_json::json!({
            "type": "user_message",
            "uuid": "msg-1",
            "message": "Hello world",
            "sessionId": "sess-1",
            "timestamp": "2025-01-01T00:01:00.000Z"
        });
        provider.append_message("sess-1", &msg).await.unwrap();

        let history = provider.get_history("sess-1").await;
        assert_eq!(history.len(), 1);
        assert_eq!(history[0]["message"], "Hello world");
    }

    #[tokio::test]
    async fn test_get_nonexistent_returns_none() {
        let tmp = TempDir::new().unwrap();
        let provider =
            LocalSessionProvider::new_with_storage_root(tmp.path().to_str().unwrap(), tmp.path());
        assert!(provider.get("nonexistent").await.is_none());
    }

    #[tokio::test]
    async fn test_delete_nonexistent_is_ok() {
        let tmp = TempDir::new().unwrap();
        let provider =
            LocalSessionProvider::new_with_storage_root(tmp.path().to_str().unwrap(), tmp.path());
        assert!(provider.delete("nonexistent").await.is_ok());
    }
}
