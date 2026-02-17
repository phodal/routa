//! RPC error type that bridges `ServerError` to JSON-RPC errors.

use super::types;
use crate::error::ServerError;

/// Unified RPC error that can be converted to a JSON-RPC error response.
#[derive(Debug, thiserror::Error)]
pub enum RpcError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Invalid params: {0}")]
    InvalidParams(String),

    #[error("Method not found: {0}")]
    MethodNotFound(String),
}

impl RpcError {
    /// Convert to a JSON-RPC error code.
    pub fn code(&self) -> i64 {
        match self {
            RpcError::NotFound(_) => types::NOT_FOUND,
            RpcError::BadRequest(_) => types::BAD_REQUEST,
            RpcError::Internal(_) => types::INTERNAL_ERROR,
            RpcError::InvalidParams(_) => types::INVALID_PARAMS,
            RpcError::MethodNotFound(_) => types::METHOD_NOT_FOUND,
        }
    }

    /// Convert to a JSON-RPC error response.
    pub fn to_response(&self, id: Option<serde_json::Value>) -> types::JsonRpcResponse {
        types::JsonRpcResponse::error(id, self.code(), self.to_string())
    }
}

impl From<ServerError> for RpcError {
    fn from(err: ServerError) -> Self {
        match err {
            ServerError::NotFound(msg) => RpcError::NotFound(msg),
            ServerError::BadRequest(msg) => RpcError::BadRequest(msg),
            ServerError::Database(msg) => RpcError::Internal(msg),
            ServerError::Internal(msg) => RpcError::Internal(msg),
        }
    }
}
