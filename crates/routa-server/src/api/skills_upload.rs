//! Skill Upload API - /api/skills/upload
//!
//! POST /api/skills/upload - Upload and extract a skill zip file

use axum::{routing::post, Router};
use axum_extra::extract::Multipart;

use crate::error::ServerError;
use crate::state::AppState;

const SKILLS_DIR: &str = ".agents/skills";

pub fn router() -> Router<AppState> {
    Router::new().route("/", post(upload_skill))
}

async fn upload_skill(
    mut multipart: Multipart,
) -> Result<axum::Json<serde_json::Value>, ServerError> {
    let mut file_name = String::new();
    let mut file_data: Option<Vec<u8>> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        if name == "file" {
            file_name = field
                .file_name()
                .unwrap_or("upload.zip")
                .to_string();
            let data = field
                .bytes()
                .await
                .map_err(|e| ServerError::BadRequest(format!("Failed to read file: {}", e)))?;
            file_data = Some(data.to_vec());
        }
    }

    let data = file_data.ok_or_else(|| ServerError::BadRequest("No file provided".into()))?;

    if !file_name.ends_with(".zip") {
        return Err(ServerError::BadRequest(
            "Only .zip files are supported".into(),
        ));
    }

    let cwd = std::env::current_dir().unwrap_or_default();
    let skills_dir = cwd.join(SKILLS_DIR);
    std::fs::create_dir_all(&skills_dir)
        .map_err(|e| ServerError::Internal(format!("Failed to create skills dir: {}", e)))?;

    // Write zip to temp file
    let temp_zip = skills_dir.join(format!("_upload_{}.zip", chrono::Utc::now().timestamp()));
    std::fs::write(&temp_zip, &data)
        .map_err(|e| ServerError::Internal(format!("Failed to write zip: {}", e)))?;

    // Extract using unzip command
    let result = tokio::task::spawn_blocking({
        let zip_path = temp_zip.to_string_lossy().to_string();
        let dest = skills_dir.to_string_lossy().to_string();
        move || {
            std::process::Command::new("unzip")
                .args(["-o", &zip_path, "-d", &dest])
                .output()
        }
    })
    .await
    .map_err(|e| ServerError::Internal(e.to_string()))?;

    // Clean up temp zip
    let _ = std::fs::remove_file(&temp_zip);

    match result {
        Ok(output) if output.status.success() => Ok(axum::Json(serde_json::json!({
            "success": true,
            "message": format!("Extracted {} to {}/", file_name, SKILLS_DIR),
        }))),
        Ok(output) => Err(ServerError::Internal(format!(
            "Unzip failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ))),
        Err(e) => Err(ServerError::Internal(format!("Unzip command failed: {}", e))),
    }
}
