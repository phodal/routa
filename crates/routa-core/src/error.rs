//! Core error type for the Routa platform.
//!
//! `ServerError` is used throughout the core domain (stores, RPC, etc.).
//! When the `axum` feature is enabled, it also implements `IntoResponse`
//! so it can be used directly as an axum handler error type.

#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error("Database error: {0}")]
    Database(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

// ---------------------------------------------------------------------------
// axum integration (opt-in via feature flag)
// ---------------------------------------------------------------------------

#[cfg(feature = "axum")]
impl axum::response::IntoResponse for ServerError {
    fn into_response(self) -> axum::response::Response {
        use axum::http::StatusCode;

        let (status, message) = match &self {
            ServerError::Database(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
            ServerError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            ServerError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            ServerError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
        };

        let body = serde_json::json!({ "error": message });
        (status, axum::Json(body)).into_response()
    }
}
