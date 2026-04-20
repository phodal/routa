//! Docker utility functions for port allocation, container naming, and shell escaping.
//!
//! Mirrors the TypeScript utilities in `src/core/acp/docker/utils.ts`.

use regex::Regex;
use std::collections::HashSet;
use std::sync::LazyLock;
use tokio::net::TcpListener;

/// Start of ephemeral port range for Docker containers.
pub const DOCKER_EPHEMERAL_PORT_START: u16 = 49152;
/// End of ephemeral port range for Docker containers.
pub const DOCKER_EPHEMERAL_PORT_END: u16 = 65535;

/// Default Docker agent image name.
pub const DEFAULT_DOCKER_AGENT_IMAGE: &str = "routa/opencode-agent:latest";

/// Default container port for the OpenCode HTTP service.
pub const DEFAULT_CONTAINER_PORT: u16 = 4321;

/// Default health check timeout in milliseconds.
pub const DEFAULT_HEALTH_TIMEOUT_MS: u64 = 30_000;

/// Regex for detecting sensitive environment variable names.
static SENSITIVE_ENV_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(key|token|secret|password|auth)").unwrap());

/// Generate a unique container name from a session ID.
pub fn generate_container_name(session_id: &str) -> String {
    let short_id: String = session_id
        .chars()
        .filter(|c| c.is_alphanumeric())
        .take(8)
        .collect::<String>()
        .to_lowercase();

    if short_id.is_empty() {
        "routa-agent-session".to_string()
    } else {
        format!("routa-agent-{short_id}")
    }
}

/// Sanitize environment variables for logging (mask sensitive values).
pub fn sanitize_env_for_logging(
    env: Option<&std::collections::HashMap<String, String>>,
) -> std::collections::HashMap<String, String> {
    let mut safe = std::collections::HashMap::new();

    if let Some(env) = env {
        for (key, value) in env {
            if SENSITIVE_ENV_REGEX.is_match(key) {
                safe.insert(key.clone(), "***".to_string());
            } else {
                safe.insert(key.clone(), value.clone());
            }
        }
    }

    safe
}

/// Find an available port in the ephemeral range.
pub async fn find_available_port(used_ports: &HashSet<u16>) -> Result<u16, String> {
    for port in DOCKER_EPHEMERAL_PORT_START..=DOCKER_EPHEMERAL_PORT_END {
        if used_ports.contains(&port) {
            continue;
        }

        if is_port_free(port).await {
            return Ok(port);
        }
    }

    Err("No available ports in Docker ephemeral range (49152-65535)".to_string())
}

/// Check if a port is free by attempting to bind to it.
async fn is_port_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).await.is_ok()
}

/// Escape a string for safe use in shell commands.
pub fn shell_escape(input: &str) -> String {
    if input.is_empty() {
        return "''".to_string();
    }

    // Replace single quotes with escaped version
    let escaped = input.replace('\'', "'\\''");
    format!("'{escaped}'")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_container_name() {
        assert_eq!(
            generate_container_name("abc12345-def"),
            "routa-agent-abc12345"
        );
        assert_eq!(generate_container_name(""), "routa-agent-session");
        assert_eq!(generate_container_name("---"), "routa-agent-session");
    }

    #[test]
    fn test_shell_escape() {
        assert_eq!(shell_escape("hello"), "'hello'");
        assert_eq!(shell_escape("hello world"), "'hello world'");
        assert_eq!(shell_escape("it's"), "'it'\\''s'");
        assert_eq!(shell_escape(""), "''");
    }

    #[test]
    fn test_sanitize_env() {
        let mut env = std::collections::HashMap::new();
        env.insert("API_KEY".to_string(), "secret123".to_string());
        env.insert("PATH".to_string(), "/usr/bin".to_string());
        env.insert("SECRET_TOKEN".to_string(), "token456".to_string());

        let sanitized = sanitize_env_for_logging(Some(&env));
        assert_eq!(sanitized.get("API_KEY"), Some(&"***".to_string()));
        assert_eq!(sanitized.get("PATH"), Some(&"/usr/bin".to_string()));
        assert_eq!(sanitized.get("SECRET_TOKEN"), Some(&"***".to_string()));
    }
}
