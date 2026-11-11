use routa_core::acp::SessionLaunchOptions;
use routa_core::orchestration::SpecialistConfig;

use super::{build_specialist_system_prompt, derive_allowed_native_tools};

pub(super) fn launch_options_from_params(
    params: &serde_json::Value,
    specialist: Option<&SpecialistConfig>,
    specialist_id: Option<String>,
) -> SessionLaunchOptions {
    SessionLaunchOptions {
        specialist_id: specialist_id.clone(),
        specialist_system_prompt: params
            .get("systemPrompt")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|prompt| !prompt.is_empty())
            .map(str::to_string)
            .or_else(|| specialist.and_then(build_specialist_system_prompt)),
        allowed_native_tools: derive_allowed_native_tools(specialist_id.as_deref()),
        base_url: params
            .get("baseUrl")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        api_key: params
            .get("apiKey")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        ..SessionLaunchOptions::default()
    }
}
