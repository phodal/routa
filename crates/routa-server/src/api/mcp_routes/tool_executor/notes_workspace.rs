use crate::state::AppState;

use super::{tool_result_error, tool_result_json, tool_result_text};

pub(super) async fn execute(
    state: &AppState,
    name: &str,
    args: &serde_json::Value,
    workspace_id: &str,
) -> Option<serde_json::Value> {
    let result = match name {
        "list_notes" => match state.note_store.list_by_workspace(workspace_id).await {
            Ok(notes) => {
                tool_result_text(&serde_json::to_string_pretty(&notes).unwrap_or_default())
            }
            Err(e) => tool_result_error(&e.to_string()),
        },
        "create_note" => {
            let title = args
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("Untitled");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let note_id = args
                .get("noteId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let session_id = args
                .get("sessionId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let note_type_str = args
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("general");
            let note_type = crate::models::note::NoteType::from_str(note_type_str);
            let note = crate::models::note::Note::new_with_session(
                note_id.clone(),
                title.to_string(),
                content.to_string(),
                workspace_id.to_string(),
                session_id,
                Some(crate::models::note::NoteMetadata {
                    note_type,
                    ..Default::default()
                }),
            );
            match state.note_store.save(&note).await {
                Ok(_) => tool_result_json(&serde_json::json!({
                    "success": true,
                    "noteId": note_id,
                    "title": title
                })),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "read_note" => {
            let note_id = args.get("noteId").and_then(|v| v.as_str()).unwrap_or("");
            match state.note_store.get(note_id, workspace_id).await {
                Ok(Some(note)) => {
                    tool_result_text(&serde_json::to_string_pretty(&note).unwrap_or_default())
                }
                Ok(None) => tool_result_error(&format!("Note not found: {note_id}")),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "set_note_content" => {
            let note_id = args.get("noteId").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let session_id = args
                .get("sessionId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            match state.note_store.get(note_id, workspace_id).await {
                Ok(Some(mut note)) => {
                    note.content = content.to_string();
                    if note.session_id.is_none() && session_id.is_some() {
                        note.session_id = session_id;
                    }
                    note.updated_at = chrono::Utc::now();
                    match state.note_store.save(&note).await {
                        Ok(_) => tool_result_json(&serde_json::json!({
                            "success": true,
                            "noteId": note_id
                        })),
                        Err(e) => tool_result_error(&e.to_string()),
                    }
                }
                Ok(None) => {
                    if note_id == "spec" || note_id == "task" {
                        let note_type = if note_id == "spec" {
                            crate::models::note::NoteType::Spec
                        } else {
                            crate::models::note::NoteType::Task
                        };
                        let title = if note_id == "spec" { "Spec" } else { "Tasks" };
                        let note = crate::models::note::Note::new_with_session(
                            note_id.to_string(),
                            title.to_string(),
                            content.to_string(),
                            workspace_id.to_string(),
                            session_id,
                            Some(crate::models::note::NoteMetadata {
                                note_type,
                                ..Default::default()
                            }),
                        );
                        match state.note_store.save(&note).await {
                            Ok(_) => tool_result_json(&serde_json::json!({
                                "success": true,
                                "noteId": note_id,
                                "created": true
                            })),
                            Err(e) => tool_result_error(&e.to_string()),
                        }
                    } else {
                        tool_result_error(&format!("Note not found: {note_id}"))
                    }
                }
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "append_to_note" => {
            let note_id = args.get("noteId").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            match state.note_store.get(note_id, workspace_id).await {
                Ok(Some(mut note)) => {
                    note.content = format!("{}\n{}", note.content, content);
                    note.updated_at = chrono::Utc::now();
                    match state.note_store.save(&note).await {
                        Ok(_) => tool_result_json(&serde_json::json!({
                            "success": true,
                            "noteId": note_id
                        })),
                        Err(e) => tool_result_error(&e.to_string()),
                    }
                }
                Ok(None) => tool_result_error(&format!("Note not found: {note_id}")),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "list_workspaces" => match state.workspace_store.list().await {
            Ok(ws) => tool_result_text(&serde_json::to_string_pretty(&ws).unwrap_or_default()),
            Err(e) => tool_result_error(&e.to_string()),
        },
        "get_workspace_info" => match state.workspace_store.get(workspace_id).await {
            Ok(Some(ws)) => {
                let agents = state
                    .agent_store
                    .list_by_workspace(workspace_id)
                    .await
                    .unwrap_or_default();
                let tasks = state
                    .task_store
                    .list_by_workspace(workspace_id)
                    .await
                    .unwrap_or_default();
                let notes = state
                    .note_store
                    .list_by_workspace(workspace_id)
                    .await
                    .unwrap_or_default();
                tool_result_json(&serde_json::json!({
                    "workspace": ws,
                    "agentCount": agents.len(),
                    "taskCount": tasks.len(),
                    "noteCount": notes.len(),
                    "agents": agents.iter().map(|a| serde_json::json!({
                        "id": a.id,
                        "name": a.name,
                        "role": a.role.as_str(),
                        "status": a.status.as_str()
                    })).collect::<Vec<_>>()
                }))
            }
            Ok(None) => tool_result_error(&format!("Workspace not found: {workspace_id}")),
            Err(e) => tool_result_error(&e.to_string()),
        },
        "list_skills" => {
            let skills = state.skill_registry.list_skills();
            tool_result_text(&serde_json::to_string_pretty(&skills).unwrap_or_default())
        }
        "list_specialists" => tool_result_json(&serde_json::json!({
            "specialists": [
                {
                    "role": "CRAFTER",
                    "description": "Implementation specialist - writes code, creates files, implements features",
                    "modelTiers": ["SMART", "BALANCED", "FAST"],
                    "defaultTier": "SMART"
                },
                {
                    "role": "GATE",
                    "description": "Verification specialist - reviews code, runs tests, validates implementations",
                    "modelTiers": ["SMART", "BALANCED"],
                    "defaultTier": "BALANCED"
                },
                {
                    "role": "DEVELOPER",
                    "description": "Solo developer - plans and implements independently",
                    "modelTiers": ["SMART", "BALANCED", "FAST"],
                    "defaultTier": "SMART"
                }
            ]
        })),
        _ => return None,
    };

    Some(result)
}
