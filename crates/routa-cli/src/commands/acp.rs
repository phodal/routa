//! `routa acp` — ACP agent management commands.
//!
//! Provides:
//!   - `routa acp install <agent_id>` — install an agent (download runtime if needed)
//!   - `routa acp uninstall <agent_id>` — remove an installed agent
//!   - `routa acp list` — list agents from the registry with installation status
//!   - `routa acp installed` — list locally installed agents
//!   - `routa acp runtime status` — show Node.js / uv runtime health

use clap::{Args, Subcommand};
use dialoguer::{theme::ColorfulTheme, Select};
use routa_core::acp::registry_types::InstalledAgentInfo;
use routa_core::acp::runtime_manager::{current_platform, RuntimeType};
use routa_core::acp::{fetch_registry_json, get_presets, AcpPaths, DistributionType};
use routa_core::state::AppState;
use std::collections::HashMap;

use super::print_json;

#[derive(Subcommand)]
pub enum AcpAction {
    /// Run Routa as an ACP server over stdio (other agents can connect to it).
    Serve {
        /// Workspace ID
        #[arg(long, default_value = "default")]
        workspace_id: String,
        /// Default ACP provider for child agents (e.g. "opencode", "claude")
        #[arg(long, default_value = "opencode")]
        provider: String,
    },
    /// Install an ACP agent (downloads runtime if needed).
    Install {
        /// Agent ID from the ACP registry (e.g. "opencode")
        agent_id: String,
        /// Distribution type override: npx | uvx | binary
        #[arg(long)]
        dist: Option<String>,
    },
    /// Uninstall a previously-installed ACP agent.
    Uninstall {
        /// Agent ID to remove
        agent_id: String,
    },
    /// List agents from the ACP registry with their install status.
    List,
    /// List locally-installed ACP agents.
    Installed,
    /// Show Node.js / uv runtime status.
    RuntimeStatus,
    /// Download and cache Node.js (managed runtime) if not already present.
    EnsureNode,
    /// Download and cache uv (managed runtime) if not already present.
    EnsureUv,
}

#[derive(Args, Clone, Debug)]
pub struct TopLevelInstallArgs {
    pub agent_id: Option<String>,
    #[arg(long)]
    pub dist: Option<String>,
}

#[derive(Args, Clone, Debug)]
pub struct TopLevelUninstallArgs {
    pub agent_id: Option<String>,
}

#[derive(Clone, Debug)]
struct ProviderInventoryEntry {
    canonical_id: String,
    install_id: Option<String>,
    display_name: String,
    version: Option<String>,
    source: &'static str,
    distribution: Vec<String>,
    installed_info: Option<InstalledAgentInfo>,
}

pub async fn install(
    state: &AppState,
    agent_id: &str,
    dist_override: Option<&str>,
) -> Result<(), String> {
    println!("[acp install] Fetching registry…");

    let registry_json = fetch_registry_json().await?;
    let agent = find_agent(&registry_json, agent_id)?;

    let name = agent
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(agent_id);
    let version = agent
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("latest")
        .to_string();

    let dist = agent
        .get("distribution")
        .cloned()
        .unwrap_or(serde_json::Value::Object(Default::default()));

    // Determine the best distribution type
    let dist_type = if let Some(explicit) = dist_override {
        explicit.to_string()
    } else {
        choose_dist_type(&dist)
    };

    println!("[acp install] Installing '{name}' v{version} via {dist_type}");

    match dist_type.as_str() {
        "npx" => {
            install_npx(state, agent_id, name, &version, &dist).await?;
        }
        "uvx" => {
            install_uvx(state, agent_id, name, &version, &dist).await?;
        }
        "binary" => {
            install_binary(state, agent_id, name, &version, &dist).await?;
        }
        other => {
            return Err(format!(
                "Unknown distribution type '{other}'. Use npx, uvx, or binary."
            ));
        }
    }

    print_json(&serde_json::json!({
        "success": true,
        "agentId": agent_id,
        "name": name,
        "version": version,
        "distributionType": dist_type,
    }));
    Ok(())
}

pub async fn uninstall(state: &AppState, agent_id: &str) -> Result<(), String> {
    println!("[acp uninstall] Removing '{agent_id}'…");

    if let Some(info) = state
        .acp_installation_state
        .get_installed_info(agent_id)
        .await
    {
        if info.dist_type == DistributionType::Binary {
            state
                .acp_binary_manager
                .uninstall(agent_id)
                .await
                .map_err(|e| format!("Binary removal failed: {e}"))?;
        }
    }

    state
        .acp_installation_state
        .uninstall(agent_id)
        .await
        .map_err(|e| format!("State update failed: {e}"))?;

    print_json(&serde_json::json!({
        "success": true,
        "agentId": agent_id,
        "message": format!("Agent '{}' uninstalled", agent_id),
    }));
    Ok(())
}

pub async fn install_top_level(
    state: &AppState,
    agent_id: Option<&str>,
    dist_override: Option<&str>,
) -> Result<(), String> {
    let inventory = build_provider_inventory(state).await?;
    let selected = match agent_id {
        Some(id) => find_inventory_entry(&inventory, id)
            .cloned()
            .ok_or_else(|| format!("Provider '{id}' not found in presets or ACP registry"))?,
        None => pick_provider_to_install(&inventory)?,
    };

    let install_id = selected.install_id.as_deref().ok_or_else(|| {
        format!(
            "Provider '{}' is preset-only and has no ACP registry distribution yet. Install it manually and run it via its preset id.",
            selected.canonical_id
        )
    })?;

    install(state, install_id, dist_override).await
}

pub async fn uninstall_top_level(state: &AppState, agent_id: Option<&str>) -> Result<(), String> {
    let inventory = build_provider_inventory(state).await?;
    let installed: Vec<ProviderInventoryEntry> = inventory
        .into_iter()
        .filter(|entry| entry.installed_info.is_some())
        .collect();

    if installed.is_empty() {
        return Err("No Routa-managed ACP providers are currently installed".to_string());
    }

    let selected = match agent_id {
        Some(id) => find_inventory_entry(&installed, id)
            .cloned()
            .ok_or_else(|| format!("Installed provider '{id}' not found"))?,
        None => pick_provider_to_uninstall(&installed)?,
    };

    uninstall(
        state,
        selected
            .installed_info
            .as_ref()
            .map(|info| info.agent_id.as_str())
            .unwrap_or(&selected.canonical_id),
    )
    .await
}

pub async fn list(state: &AppState) -> Result<(), String> {
    let _ = state.acp_installation_state.load().await;

    println!("[acp list] Fetching registry…");
    let registry = fetch_registry_json().await?;

    let agents = registry
        .get("agents")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();

    let npx_ok = routa_core::shell_env::which("npx").is_some();
    let uvx_ok = routa_core::shell_env::which("uv").is_some();

    let mut rows: Vec<serde_json::Value> = Vec::new();
    for agent in &agents {
        let id = agent.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let dist = agent.get("distribution").cloned().unwrap_or_default();
        let installed = state.acp_installation_state.is_installed(id).await
            || quick_check_installed(&dist, npx_ok, uvx_ok);

        rows.push(serde_json::json!({
            "id": id,
            "name": agent.get("name").and_then(|v| v.as_str()).unwrap_or(id),
            "version": agent.get("version").and_then(|v| v.as_str()).unwrap_or(""),
            "description": agent.get("description").and_then(|v| v.as_str()).unwrap_or(""),
            "distribution": dist_summary(&dist),
            "installed": installed,
        }));
    }

    print_json(&serde_json::json!({ "agents": rows, "total": rows.len() }));
    Ok(())
}

pub async fn list_installed(state: &AppState) -> Result<(), String> {
    let _ = state.acp_installation_state.load().await;
    let installed = state.acp_installation_state.get_all_installed().await;
    print_json(&serde_json::json!({ "installed": installed, "total": installed.len() }));
    Ok(())
}

pub async fn runtime_status(state: &AppState) -> Result<(), String> {
    let rm = &state.acp_runtime_manager;
    let platform = current_platform();

    let check = |rt: RuntimeType| async move {
        let managed = rm.get_managed_runtime(&rt).await;
        let system = rm.get_system_runtime(&rt);
        serde_json::json!({
            "available": managed.is_some() || system.is_some(),
            "managed": managed.as_ref().map(|i| i.path.to_string_lossy().to_string()),
            "system":  system.as_ref().map(|i| i.path.to_string_lossy().to_string()),
        })
    };

    let (node, npx, uv, uvx) = tokio::join!(
        check(RuntimeType::Node),
        check(RuntimeType::Npx),
        check(RuntimeType::Uv),
        check(RuntimeType::Uvx),
    );

    print_json(&serde_json::json!({
        "platform": platform,
        "runtimes": {
            "node": node,
            "npx":  npx,
            "uv":   uv,
            "uvx":  uvx,
        }
    }));
    Ok(())
}

/// Download Node.js (managed) if not already present.
pub async fn ensure_node(state: &AppState) -> Result<(), String> {
    println!("[acp runtime] Ensuring Node.js…");
    let info = state
        .acp_runtime_manager
        .ensure_runtime(&RuntimeType::Node)
        .await?;
    print_json(&serde_json::json!({
        "success": true,
        "runtime": "node",
        "path": info.path.to_string_lossy(),
        "version": info.version,
        "managed": info.is_managed,
    }));
    Ok(())
}

/// Download uv (managed) if not already present.
pub async fn ensure_uv(state: &AppState) -> Result<(), String> {
    println!("[acp runtime] Ensuring uv…");
    let info = state
        .acp_runtime_manager
        .ensure_runtime(&RuntimeType::Uv)
        .await?;
    print_json(&serde_json::json!({
        "success": true,
        "runtime": "uv",
        "path": info.path.to_string_lossy(),
        "version": info.version,
        "managed": info.is_managed,
    }));
    Ok(())
}

fn find_agent<'a>(
    registry: &'a serde_json::Value,
    agent_id: &str,
) -> Result<&'a serde_json::Value, String> {
    registry
        .get("agents")
        .and_then(|a| a.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|a| a.get("id").and_then(|v| v.as_str()) == Some(agent_id))
        })
        .ok_or_else(|| format!("Agent '{agent_id}' not found in registry"))
}

/// Pick the best distribution type given availability.
fn choose_dist_type(dist: &serde_json::Value) -> String {
    let npx_ok = routa_core::shell_env::which("npx").is_some();
    let uvx_ok = routa_core::shell_env::which("uv").is_some();

    if dist.get("npx").is_some() && npx_ok {
        return "npx".into();
    }
    if dist.get("uvx").is_some() && uvx_ok {
        return "uvx".into();
    }
    // Fall back without requiring system runtime (will download managed one)
    if dist.get("npx").is_some() {
        return "npx".into();
    }
    if dist.get("uvx").is_some() {
        return "uvx".into();
    }
    if dist.get("binary").is_some() {
        return "binary".into();
    }
    "npx".into()
}

async fn install_npx(
    state: &AppState,
    agent_id: &str,
    name: &str,
    version: &str,
    dist: &serde_json::Value,
) -> Result<(), String> {
    // Ensure Node.js / npx is available (download if needed)
    println!("[acp install] Ensuring npx runtime…");
    let _npx_info = state
        .acp_runtime_manager
        .ensure_runtime(&RuntimeType::Npx)
        .await
        .map_err(|e| format!("Failed to ensure npx runtime: {e}"))?;
    println!("[acp install] npx ready: {:?}", _npx_info.path);

    let package = dist
        .get("npx")
        .and_then(|v| v.get("package"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    state
        .acp_installation_state
        .mark_installed(agent_id, version, DistributionType::Npx, None, package)
        .await
        .map_err(|e| format!("Failed to save state: {e}"))?;

    println!("[acp install] '{name}' installed (npx will fetch on first run)");
    Ok(())
}

async fn install_uvx(
    state: &AppState,
    agent_id: &str,
    name: &str,
    version: &str,
    dist: &serde_json::Value,
) -> Result<(), String> {
    println!("[acp install] Ensuring uv/uvx runtime…");
    let _uv_info = state
        .acp_runtime_manager
        .ensure_runtime(&RuntimeType::Uvx)
        .await
        .map_err(|e| format!("Failed to ensure uvx runtime: {e}"))?;
    println!("[acp install] uvx ready: {:?}", _uv_info.path);

    let package = dist
        .get("uvx")
        .and_then(|v| v.get("package"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    state
        .acp_installation_state
        .mark_installed(agent_id, version, DistributionType::Uvx, None, package)
        .await
        .map_err(|e| format!("Failed to save state: {e}"))?;

    println!("[acp install] '{name}' installed (uvx will fetch on first run)");
    Ok(())
}

async fn install_binary(
    state: &AppState,
    agent_id: &str,
    name: &str,
    version: &str,
    dist: &serde_json::Value,
) -> Result<(), String> {
    let platform = AcpPaths::current_platform();
    let binary_config = dist
        .get("binary")
        .and_then(|b| b.get(&platform))
        .ok_or_else(|| format!("No binary for platform '{platform}'"))?;

    let binary_info: routa_core::acp::BinaryInfo = serde_json::from_value(binary_config.clone())
        .map_err(|e| format!("Invalid binary config: {e}"))?;

    println!("[acp install] Downloading binary for '{name}'…");
    let exe = state
        .acp_binary_manager
        .install_binary(agent_id, version, &binary_info)
        .await
        .map_err(|e| format!("Binary install failed: {e}"))?;

    let exe_str = exe.to_string_lossy().to_string();
    state
        .acp_installation_state
        .mark_installed(
            agent_id,
            version,
            DistributionType::Binary,
            Some(exe_str.clone()),
            None,
        )
        .await
        .map_err(|e| format!("State update failed: {e}"))?;

    println!("[acp install] '{name}' binary installed → {exe_str}");
    Ok(())
}

fn quick_check_installed(dist: &serde_json::Value, npx_ok: bool, uvx_ok: bool) -> bool {
    (dist.get("npx").is_some() && npx_ok) || (dist.get("uvx").is_some() && uvx_ok)
}

fn dist_summary(dist: &serde_json::Value) -> Vec<String> {
    let mut types = Vec::new();
    if dist.get("npx").is_some() {
        types.push("npx".to_string());
    }
    if dist.get("uvx").is_some() {
        types.push("uvx".to_string());
    }
    if dist.get("binary").is_some() {
        types.push("binary".to_string());
    }
    types
}

async fn build_provider_inventory(state: &AppState) -> Result<Vec<ProviderInventoryEntry>, String> {
    let _ = state.acp_installation_state.load().await;

    let installed = state.acp_installation_state.get_all_installed().await;
    let installed_by_key: HashMap<String, InstalledAgentInfo> = installed
        .into_iter()
        .map(|info| (canonical_provider_key(&info.agent_id).to_string(), info))
        .collect();

    let registry_json = fetch_registry_json().await?;
    let registry_agents = registry_json
        .get("agents")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();

    let mut registry_by_key: HashMap<String, serde_json::Value> = HashMap::new();
    for agent in registry_agents {
        if let Some(id) = agent.get("id").and_then(|v| v.as_str()) {
            registry_by_key.insert(canonical_provider_key(id).to_string(), agent);
        }
    }

    let mut entries = Vec::new();
    let mut seen = HashMap::new();

    for preset in get_presets() {
        let key = canonical_provider_key(&preset.id).to_string();
        let registry_agent = registry_by_key.get(&key);
        let installed_info = installed_by_key.get(&key).cloned();
        entries.push(build_inventory_entry(
            &key,
            Some(&preset),
            registry_agent,
            installed_info,
        ));
        seen.insert(key, true);
    }

    for (key, registry_agent) in registry_by_key {
        if seen.contains_key(&key) {
            continue;
        }
        let installed_info = installed_by_key.get(&key).cloned();
        entries.push(build_inventory_entry(
            &key,
            None,
            Some(&registry_agent),
            installed_info,
        ));
    }

    entries.sort_by(|a, b| {
        let a_rank = provider_sort_rank(a);
        let b_rank = provider_sort_rank(b);
        a_rank.cmp(&b_rank).then_with(|| {
            a.display_name
                .to_lowercase()
                .cmp(&b.display_name.to_lowercase())
        })
    });
    Ok(entries)
}

fn build_inventory_entry(
    canonical_id: &str,
    preset: Option<&routa_core::acp::AcpPreset>,
    registry_agent: Option<&serde_json::Value>,
    installed_info: Option<InstalledAgentInfo>,
) -> ProviderInventoryEntry {
    let source = match (preset.is_some(), registry_agent.is_some()) {
        (true, true) => "preset+registry",
        (true, false) => "preset",
        (false, true) => "registry",
        (false, false) => "unknown",
    };

    let install_id = registry_agent
        .and_then(|agent| agent.get("id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let display_name = preset
        .map(|p| p.name.clone())
        .or_else(|| {
            registry_agent
                .and_then(|agent| agent.get("name"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| canonical_id.to_string());

    let version = registry_agent
        .and_then(|agent| agent.get("version"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let distribution = registry_agent
        .and_then(|agent| agent.get("distribution"))
        .map(dist_summary)
        .unwrap_or_default();

    ProviderInventoryEntry {
        canonical_id: canonical_id.to_string(),
        install_id,
        display_name,
        version,
        source,
        distribution,
        installed_info,
    }
}

fn provider_sort_rank(entry: &ProviderInventoryEntry) -> u8 {
    if entry.installed_info.is_some() {
        0
    } else if entry.install_id.is_some() {
        1
    } else {
        2
    }
}

fn pick_provider_to_install(
    entries: &[ProviderInventoryEntry],
) -> Result<ProviderInventoryEntry, String> {
    let installable: Vec<&ProviderInventoryEntry> = entries
        .iter()
        .filter(|entry| entry.install_id.is_some())
        .collect();

    if installable.is_empty() {
        return Err("No ACP registry providers are available to install".to_string());
    }

    let items: Vec<String> = installable
        .iter()
        .map(|entry| format_provider_install_label(entry))
        .collect();

    let index = Select::with_theme(&ColorfulTheme::default())
        .with_prompt("Select an ACP provider to install")
        .items(&items)
        .default(0)
        .interact_opt()
        .map_err(|e| format!("Interactive selection failed: {e}"))?;

    index
        .map(|idx| installable[idx].to_owned())
        .ok_or_else(|| "Install cancelled".to_string())
}

fn pick_provider_to_uninstall(
    entries: &[ProviderInventoryEntry],
) -> Result<ProviderInventoryEntry, String> {
    let items: Vec<String> = entries
        .iter()
        .map(format_provider_uninstall_label)
        .collect();

    let index = Select::with_theme(&ColorfulTheme::default())
        .with_prompt("Select an ACP provider to uninstall")
        .items(&items)
        .default(0)
        .interact_opt()
        .map_err(|e| format!("Interactive selection failed: {e}"))?;

    index
        .map(|idx| entries[idx].clone())
        .ok_or_else(|| "Uninstall cancelled".to_string())
}

fn format_provider_install_label(entry: &ProviderInventoryEntry) -> String {
    let version = entry.version.as_deref().unwrap_or("unknown");
    let dist = if entry.distribution.is_empty() {
        "manual".to_string()
    } else {
        entry.distribution.join("/")
    };
    let installed = entry
        .installed_info
        .as_ref()
        .map(|info| format!(" installed via {:?}", info.dist_type))
        .unwrap_or_default();
    format!(
        "{} ({}) [{}] v{}{}",
        entry.display_name, entry.canonical_id, entry.source, version, installed
    ) + &format!(" · {dist}")
}

fn format_provider_uninstall_label(entry: &ProviderInventoryEntry) -> String {
    let info = entry
        .installed_info
        .as_ref()
        .expect("installed entry required for uninstall label");
    format!(
        "{} ({}) [{}] via {:?} · installed {}",
        entry.display_name, entry.canonical_id, entry.source, info.dist_type, info.installed_at
    )
}

fn find_inventory_entry<'a>(
    entries: &'a [ProviderInventoryEntry],
    needle: &str,
) -> Option<&'a ProviderInventoryEntry> {
    let canonical = canonical_provider_key(needle);
    entries.iter().find(|entry| {
        entry.canonical_id == canonical
            || entry.install_id.as_deref() == Some(needle)
            || entry.install_id.as_deref().map(canonical_provider_key) == Some(canonical)
            || entry
                .installed_info
                .as_ref()
                .map(|info| info.agent_id.as_str())
                == Some(needle)
    })
}

fn canonical_provider_key(id: &str) -> &str {
    match id.strip_suffix("-registry").unwrap_or(id) {
        "codex-acp" => "codex",
        "qodercli" => "qoder",
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_inventory_entry, canonical_provider_key, find_inventory_entry, ProviderInventoryEntry,
    };
    use routa_core::acp::registry_types::{DistributionType, InstalledAgentInfo};
    use routa_core::acp::AcpPreset;

    #[test]
    fn canonical_key_maps_aliases() {
        assert_eq!(canonical_provider_key("codex-acp"), "codex");
        assert_eq!(canonical_provider_key("codex"), "codex");
        assert_eq!(canonical_provider_key("qodercli"), "qoder");
        assert_eq!(canonical_provider_key("auggie-registry"), "auggie");
    }

    #[test]
    fn inventory_entry_prefers_preset_name_and_registry_install_id() {
        let preset = AcpPreset {
            id: "codex-acp".to_string(),
            name: "Codex".to_string(),
            command: "codex-acp".to_string(),
            args: vec![],
            description: "Preset".to_string(),
            env_bin_override: None,
            resume: None,
        };
        let registry = serde_json::json!({
            "id": "codex",
            "name": "Codex ACP",
            "version": "1.2.3",
            "description": "Registry",
            "distribution": { "npx": { "package": "@scope/codex" } }
        });
        let entry = build_inventory_entry("codex", Some(&preset), Some(&registry), None);

        assert_eq!(entry.canonical_id, "codex");
        assert_eq!(entry.install_id.as_deref(), Some("codex"));
        assert_eq!(entry.display_name, "Codex");
        assert_eq!(entry.source, "preset+registry");
        assert_eq!(entry.distribution, vec!["npx"]);
    }

    #[test]
    fn find_inventory_entry_matches_installed_agent_id() {
        let entries = vec![ProviderInventoryEntry {
            canonical_id: "opencode".to_string(),
            install_id: Some("opencode".to_string()),
            display_name: "OpenCode".to_string(),
            version: Some("latest".to_string()),
            source: "preset+registry",
            distribution: vec!["npx".to_string()],
            installed_info: Some(InstalledAgentInfo {
                agent_id: "opencode".to_string(),
                version: "latest".to_string(),
                dist_type: DistributionType::Npx,
                installed_at: "2026-03-27T00:00:00Z".to_string(),
                binary_path: None,
                package: Some("opencode-ai".to_string()),
            }),
        }];

        assert!(find_inventory_entry(&entries, "opencode").is_some());
    }
}
