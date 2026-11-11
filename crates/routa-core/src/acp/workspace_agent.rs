//! Desktop credential binding for hosted workspace providers.
//!
//! This mirrors `src/core/acp/workspace-agent/provider-endpoint.ts`. A session
//! base URL is caller-controlled, so an environment key is attached only to the
//! canonical HTTPS endpoint or to the operator-configured base when the session
//! does not replace that destination. The key itself is never returned to the
//! session record or included in errors.

use reqwest::Url;

const STANDARDCOMPUTE_DEFAULT_MODEL: &str = "standardcompute";
const ANTHROPIC_DEFAULT_MODEL: &str = "claude-sonnet-4-20250514";

pub const UBERLLM_EXPLICIT_MODEL_ERROR: &str =
    "Workspace agent (uberllm) requires an explicit model id. Set WORKSPACE_AGENT_MODEL or the session model.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostedWorkspaceSession {
    pub provider: &'static str,
    pub model_id: String,
    pub base_url: String,
    pub credential_source: &'static str,
}

pub(crate) struct EndpointPolicy {
    hosts: &'static [&'static str],
    paths: &'static [&'static str],
    canonical: &'static str,
    missing_key: &'static str,
}

const ATLASCLOUD: EndpointPolicy = EndpointPolicy {
    hosts: &["api.atlascloud.ai"],
    paths: &["/v1"],
    canonical: "https://api.atlascloud.ai/v1",
    missing_key: "Workspace agent (atlascloud) requires ATLASCLOUD_API_KEY",
};

const STANDARDCOMPUTE: EndpointPolicy = EndpointPolicy {
    hosts: &["api.stdcmpt.com"],
    paths: &["/v1"],
    canonical: "https://api.stdcmpt.com/v1",
    missing_key: "Workspace agent (standardcompute) requires STANDARDCOMPUTE_API_KEY",
};

const UBERLLM: EndpointPolicy = EndpointPolicy {
    hosts: &["api.uberllm.dev"],
    paths: &["/v1"],
    canonical: "https://api.uberllm.dev/v1",
    missing_key: "Workspace agent (uberllm) requires UBERLLM_API_KEY",
};

struct ResolvedCredential {
    api_key: Option<String>,
    base_url: String,
    source: &'static str,
    untrusted_session_base: bool,
    unsafe_base: bool,
}

pub(super) fn validate_session_cwd(cwd: &str) -> Result<(), String> {
    let path = std::path::Path::new(cwd);
    if !path.exists() {
        return Err(format!(
            "Invalid session cwd '{cwd}': directory does not exist"
        ));
    }
    if !path.is_dir() {
        return Err(format!(
            "Invalid session cwd '{cwd}': path is not a directory"
        ));
    }
    Ok(())
}

pub(super) const DESKTOP_HOSTED_PROMPT_UNAVAILABLE: &str =
    "Desktop hosted workspace prompt execution is not available";

pub fn is_workspace_provider(provider: &str) -> bool {
    matches!(
        provider.trim().to_ascii_lowercase().as_str(),
        "workspace" | "workspace-agent" | "routa-native"
    )
}

pub(crate) fn infer_hosted_provider(base_url: Option<&str>) -> Option<&'static EndpointPolicy> {
    let base_url = base_url?;
    if is_trusted(base_url, &ATLASCLOUD) {
        Some(&ATLASCLOUD)
    } else if is_trusted(base_url, &STANDARDCOMPUTE) {
        Some(&STANDARDCOMPUTE)
    } else if is_trusted(base_url, &UBERLLM) {
        Some(&UBERLLM)
    } else {
        None
    }
}

/// Resolve a hosted workspace session, or `Ok(None)` when this workspace
/// session is not one of the hosted providers implemented here.
pub fn prepare_hosted_workspace_session(
    request_model: Option<&str>,
    session_base_url: Option<&str>,
    session_api_key: Option<&str>,
) -> Result<Option<HostedWorkspaceSession>, String> {
    let inferred = infer_hosted_provider(session_base_url);
    let provider = inferred.or_else(provider_from_env);
    let Some(policy) = provider else {
        return Ok(None);
    };

    let resolved = resolve_credential(policy, session_base_url, session_api_key);
    if let Some(error) = credential_error(policy, &resolved) {
        return Err(error);
    }

    let explicit_model =
        non_empty(request_model).or_else(|| non_empty_env("WORKSPACE_AGENT_MODEL"));
    let model_id = match (policy.canonical, explicit_model) {
        (_, Some(model)) => model,
        ("https://api.stdcmpt.com/v1", None) => STANDARDCOMPUTE_DEFAULT_MODEL.to_string(),
        ("https://api.uberllm.dev/v1", None) => {
            return Err(UBERLLM_EXPLICIT_MODEL_ERROR.to_string())
        }
        _ => ANTHROPIC_DEFAULT_MODEL.to_string(),
    };

    Ok(Some(HostedWorkspaceSession {
        provider: provider_id(policy),
        model_id,
        base_url: resolved.base_url,
        credential_source: resolved.source,
    }))
}

fn provider_from_env() -> Option<&'static EndpointPolicy> {
    match non_empty_env("WORKSPACE_AGENT_PROVIDER")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "atlascloud" => Some(&ATLASCLOUD),
        "standardcompute" => Some(&STANDARDCOMPUTE),
        "uberllm" => Some(&UBERLLM),
        _ => None,
    }
}

fn provider_id(policy: &EndpointPolicy) -> &'static str {
    match policy.canonical {
        "https://api.atlascloud.ai/v1" => "atlascloud",
        "https://api.stdcmpt.com/v1" => "standardcompute",
        "https://api.uberllm.dev/v1" => "uberllm",
        _ => "unknown",
    }
}

fn resolve_credential(
    policy: &EndpointPolicy,
    session_base_url: Option<&str>,
    session_api_key: Option<&str>,
) -> ResolvedCredential {
    let explicit_key = non_empty(session_api_key);
    let session_base = non_empty(session_base_url);
    let operator_base = operator_base(policy);
    let env_key = env_keys(policy).iter().copied().find_map(non_empty_env);
    let chosen = session_base
        .clone()
        .or_else(|| operator_base.clone())
        .unwrap_or_else(|| policy.canonical.to_string());

    if let Some(explicit_key) = explicit_key {
        return match safe_caller_url(&chosen) {
            Some(base_url) => ResolvedCredential {
                api_key: Some(explicit_key),
                base_url,
                source: "session",
                untrusted_session_base: false,
                unsafe_base: false,
            },
            None => ResolvedCredential {
                api_key: None,
                base_url: chosen,
                source: "missing",
                untrusted_session_base: false,
                unsafe_base: true,
            },
        };
    }

    let trusted = is_trusted(&chosen, policy);
    let operator_authorized = operator_base.as_deref().is_some_and(|operator| {
        same_destination(&chosen, operator)
            && safe_caller_url(operator).is_some()
            && session_base
                .as_deref()
                .is_none_or(|session| same_destination(session, operator))
    });

    if env_key.is_some() && (trusted || operator_authorized) {
        let base_url = if trusted {
            canonical_outbound(&chosen).unwrap_or_else(|| policy.canonical.to_string())
        } else {
            safe_caller_url(operator_base.as_deref().unwrap_or(policy.canonical))
                .unwrap_or(policy.canonical.to_string())
        };
        return ResolvedCredential {
            api_key: env_key,
            base_url,
            source: "environment",
            untrusted_session_base: false,
            unsafe_base: false,
        };
    }

    ResolvedCredential {
        api_key: None,
        base_url: chosen,
        source: "missing",
        untrusted_session_base: session_base.is_some() && !trusted,
        unsafe_base: false,
    }
}

fn credential_error(policy: &EndpointPolicy, resolved: &ResolvedCredential) -> Option<String> {
    if resolved.api_key.is_some() {
        return None;
    }
    if resolved.unsafe_base {
        return Some(format!(
            "Workspace agent ({}) rejected an unsafe base URL",
            provider_id(policy)
        ));
    }
    if resolved.untrusted_session_base {
        return Some(format!(
            "Workspace agent ({}) requires a session apiKey for an untrusted base URL",
            provider_id(policy)
        ));
    }
    Some(policy.missing_key.to_string())
}

fn env_keys(policy: &EndpointPolicy) -> &'static [&'static str] {
    match policy.canonical {
        "https://api.atlascloud.ai/v1" => &["ATLASCLOUD_API_KEY", "ATLAS_CLOUD_API_KEY"],
        "https://api.stdcmpt.com/v1" => &["STANDARDCOMPUTE_API_KEY"],
        "https://api.uberllm.dev/v1" => &["UBERLLM_API_KEY"],
        _ => &[],
    }
}

fn operator_base(policy: &EndpointPolicy) -> Option<String> {
    match policy.canonical {
        "https://api.atlascloud.ai/v1" => {
            non_empty_env("ATLASCLOUD_API_BASE").or_else(|| non_empty_env("ATLAS_CLOUD_API_BASE"))
        }
        "https://api.stdcmpt.com/v1" => non_empty_env("STANDARDCOMPUTE_API_BASE"),
        "https://api.uberllm.dev/v1" => non_empty_env("UBERLLM_API_BASE"),
        _ => None,
    }
}

fn is_trusted(raw: &str, policy: &EndpointPolicy) -> bool {
    let Some(url) = parse_url(raw) else {
        return false;
    };
    if url.scheme() != "https" || has_userinfo(&url) {
        return false;
    }
    if url.port().is_some_and(|port| port != 443) {
        return false;
    }
    let host = normalized_host(&url);
    let path = normalized_path(&url);
    policy.hosts.contains(&host.as_str()) && policy.paths.contains(&path.as_str())
}

fn same_destination(left: &str, right: &str) -> bool {
    let (Some(left), Some(right)) = (parse_url(left), parse_url(right)) else {
        return false;
    };
    if has_userinfo(&left) || has_userinfo(&right) || !is_http(&left) || !is_http(&right) {
        return false;
    }
    left.scheme() == right.scheme()
        && normalized_host(&left) == normalized_host(&right)
        && port_or_default(&left) == port_or_default(&right)
        && normalized_path(&left) == normalized_path(&right)
}

fn safe_caller_url(raw: &str) -> Option<String> {
    let url = parse_url(raw)?;
    if !is_http(&url) || has_userinfo(&url) || url.host_str().is_none() {
        return None;
    }
    let port = url
        .port()
        .map(|port| format!(":{port}"))
        .unwrap_or_default();
    let query = url
        .query()
        .map(|query| format!("?{query}"))
        .unwrap_or_default();
    Some(format!(
        "{}://{}{port}{}{query}",
        url.scheme(),
        url.host_str()?,
        url.path()
    ))
}

fn canonical_outbound(raw: &str) -> Option<String> {
    let url = parse_url(raw)?;
    let host = normalized_host(&url);
    let path = normalized_path(&url);
    Some(format!("https://{host}{path}"))
}

fn parse_url(raw: &str) -> Option<Url> {
    Url::parse(raw.trim()).ok()
}

fn is_http(url: &Url) -> bool {
    matches!(url.scheme(), "https" | "http")
}

fn has_userinfo(url: &Url) -> bool {
    !url.username().is_empty() || url.password().is_some()
}

fn normalized_host(url: &Url) -> String {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    host.strip_suffix('.').unwrap_or(&host).to_string()
}

fn normalized_path(url: &Url) -> String {
    let path = url.path();
    let path = path
        .strip_suffix('/')
        .filter(|path| !path.is_empty())
        .unwrap_or(path);
    if path == "/" {
        String::new()
    } else {
        path.to_string()
    }
}

fn port_or_default(url: &Url) -> u16 {
    url.port_or_known_default().unwrap_or(0)
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn non_empty_env(name: &str) -> Option<String> {
    non_empty(std::env::var(name).ok().as_deref())
}

impl super::AcpManager {
    pub fn rewrite_notification_session_id(
        session_id: &str,
        mut notification: serde_json::Value,
    ) -> serde_json::Value {
        if let Some(object) = notification.as_object_mut() {
            object.insert(
                "sessionId".to_string(),
                serde_json::Value::String(session_id.to_string()),
            );
        }
        notification
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn connect_hosted_workspace_session(
        &self,
        session_id: &str,
        cwd: &str,
        workspace_id: &str,
        provider_name: &str,
        role: Option<String>,
        model: Option<String>,
        parent_session_id: Option<String>,
        options: &super::SessionLaunchOptions,
    ) -> Result<Option<(String, String)>, String> {
        if !is_workspace_provider(provider_name) {
            return Ok(None);
        }
        let Some(prepared) = prepare_hosted_workspace_session(
            model.as_deref(),
            options.base_url.as_deref(),
            options.api_key.as_deref(),
        )?
        else {
            return Ok(None);
        };
        let (ntx, _) = tokio::sync::broadcast::channel(256);
        let agent_session_id = format!("workspace-{}", &session_id[..session_id.len().min(8)]);
        self.register_managed_session(
            session_id.to_string(),
            cwd.to_string(),
            workspace_id.to_string(),
            provider_name.to_string(),
            role,
            Some(prepared.model_id.clone()),
            parent_session_id,
            options,
            super::AgentProcessType::Workspace,
            agent_session_id.clone(),
            ntx,
            None,
        )
        .await;
        tracing::info!(
            "[AcpManager] Workspace session {session_id} connected ({}, {}, {})",
            prepared.provider,
            prepared.model_id,
            prepared.credential_source,
        );
        Ok(Some((session_id.to_string(), agent_session_id)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    const SENTINEL: &str = "SENTINEL_ENV_KEY_DO_NOT_LEAK";

    struct EnvGuard {
        saved: Vec<(&'static str, Option<String>)>,
    }

    impl EnvGuard {
        fn set(values: &[(&'static str, Option<&str>)]) -> Self {
            let saved = values
                .iter()
                .map(|(key, value)| {
                    let previous = std::env::var(key).ok();
                    match value {
                        Some(value) => std::env::set_var(key, value),
                        None => std::env::remove_var(key),
                    }
                    (*key, previous)
                })
                .collect();
            Self { saved }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, value) in &self.saved {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
        }
    }

    #[test]
    fn spoofed_urls_are_not_hosted_providers() {
        let urls = [
            "https://attacker.example/api.stdcmpt.com/v1",
            "https://attacker.example/api.uberllm.dev/v1",
            "https://api.stdcmpt.com.evil.com/v1",
            "https://api.uberllm.dev.evil.com/v1",
            "https://notapi.stdcmpt.com/v1",
            "https://api.stdcmpt.com/v1/extra",
            "https://api.stdcmpt.com//v1",
            "https://api.stdcmpt.com/V1",
            "http://api.stdcmpt.com/v1",
            "https://api.stdcmpt.com:444/v1",
            "https://user:pass@api.stdcmpt.com/v1",
            "https://api.stdcmpt.com@evil.com/v1",
            "https://evil.com@api.stdcmpt.com/v1",
            "https://evil.com/api.uberllm.dev/v1",
            "https://api.uberllm.dev",
            "https://api.uberllm.dev/",
        ];
        for url in urls {
            assert!(
                infer_hosted_provider(Some(url)).is_none(),
                "{url} must not be trusted"
            );
        }
    }

    #[test]
    fn canonical_urls_select_their_provider() {
        let upper_host = STANDARDCOMPUTE.hosts[0].to_ascii_uppercase();
        assert_eq!(
            infer_hosted_provider(Some(&format!("https://{upper_host}/v1/")))
                .map(|policy| policy.canonical),
            Some(STANDARDCOMPUTE.canonical)
        );
        assert_eq!(
            infer_hosted_provider(Some(&format!("https://{}/v1", STANDARDCOMPUTE.hosts[0])))
                .map(|policy| policy.canonical),
            Some(STANDARDCOMPUTE.canonical)
        );
        assert_eq!(
            infer_hosted_provider(Some(&format!(
                "https://{}/v1",
                format!("{}.", STANDARDCOMPUTE.hosts[0])
            )))
            .map(|policy| policy.canonical),
            Some(STANDARDCOMPUTE.canonical)
        );
        assert_eq!(
            infer_hosted_provider(Some("https://api.uberllm.dev/v1"))
                .map(|policy| policy.canonical),
            Some(UBERLLM.canonical)
        );
        assert_eq!(
            infer_hosted_provider(Some("https://api.atlascloud.ai/v1"))
                .map(|policy| policy.canonical),
            Some(ATLASCLOUD.canonical)
        );
    }

    #[test]
    fn environment_key_stays_on_the_canonical_url_and_explicit_keys_stay_custom() {
        let _lock = ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::set(&[
            ("STANDARDCOMPUTE_API_KEY", Some(SENTINEL)),
            ("STANDARDCOMPUTE_API_BASE", None),
            ("WORKSPACE_AGENT_PROVIDER", Some("standardcompute")),
            ("WORKSPACE_AGENT_MODEL", None),
        ]);

        let trusted = prepare_hosted_workspace_session(
            None,
            Some("https://api.stdcmpt.com/v1?redirect=https://evil.example"),
            None,
        )
        .expect("canonical session should connect")
        .expect("standardcompute");
        assert_eq!(trusted.model_id, "standardcompute");
        assert_eq!(trusted.base_url, "https://api.stdcmpt.com/v1");
        assert_eq!(trusted.credential_source, "environment");
        assert!(!trusted.base_url.contains(SENTINEL));

        let custom = prepare_hosted_workspace_session(
            Some("deepseek/deepseek-v4-pro"),
            Some("https://proxy.example/v1"),
            Some("session-key"),
        )
        .expect("explicit session")
        .expect("provider from env");
        assert_eq!(custom.credential_source, "session");
        assert_eq!(custom.base_url, "https://proxy.example/v1");
        assert_eq!(custom.model_id, "deepseek/deepseek-v4-pro");
    }

    #[test]
    fn untrusted_session_url_cannot_receive_the_environment_key() {
        let _lock = ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::set(&[
            ("UBERLLM_API_KEY", Some(SENTINEL)),
            ("UBERLLM_API_BASE", Some("https://gateway.internal/v1")),
            ("WORKSPACE_AGENT_PROVIDER", Some("uberllm")),
            ("WORKSPACE_AGENT_MODEL", None),
        ]);

        let error = prepare_hosted_workspace_session(
            Some("deepseek/deepseek-v4-flash"),
            Some("https://api.uberllm.dev.evil.com/v1"),
            None,
        )
        .expect_err("spoofed host must fail");
        assert!(error.contains("untrusted base URL"));
        assert!(!error.contains(SENTINEL));

        let _cleared = EnvGuard::set(&[("UBERLLM_API_KEY", None)]);
        let missing = prepare_hosted_workspace_session(
            Some("deepseek/deepseek-v4-flash"),
            Some("https://api.uberllm.dev/v1"),
            None,
        )
        .expect_err("missing key");
        assert!(missing.contains("UBERLLM_API_KEY"));
        assert!(!missing.contains(SENTINEL));
    }

    #[test]
    fn uberllm_without_a_model_does_not_fall_back_to_another_provider() {
        let _lock = ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::set(&[
            ("UBERLLM_API_KEY", Some(SENTINEL)),
            ("WORKSPACE_AGENT_PROVIDER", Some("uberllm")),
            ("WORKSPACE_AGENT_MODEL", None),
            ("UBERLLM_API_BASE", None),
        ]);
        let error =
            prepare_hosted_workspace_session(None, Some("https://api.uberllm.dev/v1"), None)
                .expect_err("model required");
        assert_eq!(error, UBERLLM_EXPLICIT_MODEL_ERROR);
        assert!(!error.contains("claude-sonnet"));
        assert!(!error.contains(SENTINEL));
    }

    #[tokio::test]
    async fn desktop_workspace_session_connects_and_does_not_echo_the_key() {
        let _lock = ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::set(&[
            ("ATLASCLOUD_API_KEY", Some(SENTINEL)),
            ("ATLAS_CLOUD_API_KEY", None),
            ("ATLASCLOUD_API_BASE", None),
            ("WORKSPACE_AGENT_PROVIDER", Some("atlascloud")),
            ("WORKSPACE_AGENT_MODEL", None),
        ]);
        let dir = tempfile::tempdir().expect("temp dir");
        let manager = crate::acp::AcpManager::new();
        let options = crate::acp::SessionLaunchOptions {
            base_url: Some("https://evil.example/api.atlascloud.ai/v1".to_string()),
            ..crate::acp::SessionLaunchOptions::default()
        };
        let error = manager
            .create_session_with_options(
                "spoof".to_string(),
                dir.path().display().to_string(),
                "default".to_string(),
                Some("workspace".to_string()),
                None,
                None,
                None,
                None,
                None,
                options,
            )
            .await
            .expect_err("spoof must not connect");
        assert!(error.contains("untrusted base URL"));
        assert!(!error.contains(SENTINEL));

        let options = crate::acp::SessionLaunchOptions {
            base_url: Some("https://api.atlascloud.ai/v1".to_string()),
            ..crate::acp::SessionLaunchOptions::default()
        };
        let (session_id, agent_session_id) = manager
            .create_session_with_options(
                "trusted".to_string(),
                dir.path().display().to_string(),
                "default".to_string(),
                Some("workspace".to_string()),
                None,
                Some("qwen/qwen3.5-flash".to_string()),
                None,
                None,
                None,
                options,
            )
            .await
            .expect("canonical atlas session");
        assert!(agent_session_id.starts_with("workspace-"));
        let record = manager.get_session(&session_id).await.expect("session");
        assert_eq!(record.provider.as_deref(), Some("workspace"));
        assert_eq!(record.model.as_deref(), Some("qwen/qwen3.5-flash"));
        let prompt_error = manager
            .prompt(&session_id, "hello")
            .await
            .expect_err("no prompt");
        assert!(!prompt_error.contains(SENTINEL));
        assert!(manager.is_alive(&session_id).await);
    }
}
