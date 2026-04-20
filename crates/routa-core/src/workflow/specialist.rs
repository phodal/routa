//! Specialist definition — load specialist prompts from YAML files.
//!
//! ```yaml
//! name: "Implementor"
//! id: "crafter"
//! description: "Executes implementation tasks, writes code"
//! role: "CRAFTER"
//! model_tier: "smart"
//! role_reminder: "Stay within task scope."
//! system_prompt: |
//!   ## Crafter (Implementor)
//!   Implement your assigned task — nothing more, nothing less.
//!   ...
//! ```

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SpecialistExecutionDef {
    /// Default agent role override.
    #[serde(default)]
    pub role: Option<String>,
    /// Default ACP provider to use when executing this specialist directly.
    #[serde(default)]
    pub provider: Option<String>,
    /// Default adapter/runtime hint for workflow execution.
    #[serde(default)]
    pub adapter: Option<String>,
    /// Default model tier.
    #[serde(default, alias = "modelTier")]
    pub model_tier: Option<String>,
    /// Default model override.
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SpecialistCapabilities {
    /// Candidate categories the specialist can process in dispatch mode.
    #[serde(default)]
    pub categories: Vec<String>,

    /// Optional cap on number of candidates per dispatch invocation.
    #[serde(default)]
    pub max_candidates: Option<usize>,
}

/// A specialist agent definition loaded from YAML.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecialistDef {
    /// Specialist ID (e.g., "crafter", "gate", "routa")
    pub id: String,

    /// Display name
    pub name: String,

    /// Description of what this specialist does
    #[serde(default)]
    pub description: Option<String>,

    /// Agent role: ROUTA, CRAFTER, GATE, DEVELOPER
    #[serde(default = "default_role")]
    pub role: String,

    /// Model tier: fast, smart, reasoning
    #[serde(default = "default_model_tier")]
    pub model_tier: String,

    /// The system prompt for this specialist
    pub system_prompt: String,

    /// A brief reminder appended to messages
    #[serde(default)]
    pub role_reminder: Option<String>,

    /// Structured execution defaults.
    #[serde(default)]
    pub execution: SpecialistExecutionDef,

    /// Default ACP provider for direct execution.
    #[serde(default)]
    pub default_provider: Option<String>,

    /// Default adapter type to use with this specialist
    #[serde(default)]
    pub default_adapter: Option<String>,

    /// Default model to use
    #[serde(default)]
    pub default_model: Option<String>,

    /// Custom metadata
    #[serde(default)]
    pub metadata: HashMap<String, String>,

    /// Capability metadata for dynamic specialist selection.
    #[serde(default)]
    pub capabilities: Option<SpecialistCapabilities>,
}

fn default_role() -> String {
    "DEVELOPER".to_string()
}

fn default_model_tier() -> String {
    "smart".to_string()
}

fn is_locale_directory_name(name: &str) -> bool {
    if name == "locales" {
        return true;
    }

    let mut parts = name.split('-');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(lang), None, None) => lang.len() == 2 && lang.chars().all(|c| c.is_ascii_lowercase()),
        (Some(lang), Some(region), None) => {
            lang.len() == 2
                && lang.chars().all(|c| c.is_ascii_lowercase())
                && region.len() == 2
                && region.chars().all(|c| c.is_ascii_uppercase())
        }
        _ => false,
    }
}

impl SpecialistDef {
    fn normalize_execution(mut self) -> Self {
        if let Some(role) = self.execution.role.clone() {
            self.role = role;
        }
        if let Some(model_tier) = self.execution.model_tier.clone() {
            self.model_tier = model_tier;
        }
        if let Some(provider) = self.execution.provider.clone() {
            self.default_provider = Some(provider);
        }
        if let Some(adapter) = self.execution.adapter.clone() {
            self.default_adapter = Some(adapter);
        }
        if let Some(model) = self.execution.model.clone() {
            self.default_model = Some(model);
        }
        self
    }

    /// Parse a specialist definition from a YAML string.
    pub fn from_yaml(yaml: &str) -> Result<Self, String> {
        let parsed: Self = serde_yaml::from_str(yaml)
            .map_err(|e| format!("Failed to parse specialist YAML: {e}"))?;
        Ok(parsed.normalize_execution())
    }

    /// Load a specialist definition from a YAML file.
    pub fn from_file(path: &str) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read specialist file '{path}': {e}"))?;
        Self::from_yaml(&content)
    }

    /// Load a specialist definition from a path, inferring format by extension.
    pub fn from_path(path: &str) -> Result<Self, String> {
        match Path::new(path)
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
        {
            "yaml" | "yml" => Self::from_file(path),
            _ => Err(format!(
                "Unsupported specialist file '{path}'. Expected .yaml or .yml"
            )),
        }
    }
}

/// Loads specialist definitions from a directory.
pub struct SpecialistLoader {
    /// Loaded specialists indexed by ID
    pub specialists: HashMap<String, SpecialistDef>,
}

impl Default for SpecialistLoader {
    fn default() -> Self {
        Self::new()
    }
}

impl SpecialistLoader {
    pub fn new() -> Self {
        Self {
            specialists: HashMap::new(),
        }
    }

    fn collect_resource_search_paths(resource_dir: &Path) -> Vec<PathBuf> {
        let mut search_paths = Vec::new();
        let mut current = resource_dir.to_path_buf();

        loop {
            search_paths.push(current.join("specialists"));
            search_paths.push(current.join("resources").join("specialists"));

            let next = current.join("_up_");
            if !next.is_dir() {
                break;
            }
            current = next;
        }

        search_paths
    }

    fn collect_specialist_paths(
        dir: &Path,
        include_locale_directories: bool,
        files: &mut Vec<PathBuf>,
    ) -> Result<(), String> {
        for entry in std::fs::read_dir(dir)
            .map_err(|e| format!("Failed to read directory '{}': {}", dir.display(), e))?
        {
            let entry = entry.map_err(|e| format!("Directory entry error: {e}"))?;
            let path = entry.path();

            if path.is_dir() {
                let should_skip = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| !include_locale_directories && is_locale_directory_name(name))
                    .unwrap_or(false);
                if should_skip {
                    continue;
                }
                Self::collect_specialist_paths(&path, include_locale_directories, files)?;
                continue;
            }

            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if matches!(ext, "yaml" | "yml") {
                files.push(path);
            }
        }

        Ok(())
    }

    fn locale_overlay_dirs(root: &Path, locale: &str) -> Vec<PathBuf> {
        if locale.is_empty() || locale == "en" {
            return Vec::new();
        }

        let candidates = vec![root.join("locales").join(locale), root.join(locale)];
        candidates
            .into_iter()
            .filter(|path| path.is_dir())
            .collect()
    }

    fn load_entries_from_directory(
        dir: &Path,
        context: &str,
    ) -> Result<Vec<(PathBuf, SpecialistDef)>, String> {
        let mut paths = Vec::new();
        Self::collect_specialist_paths(dir, false, &mut paths)?;
        paths.sort();

        let mut source_paths: HashMap<String, PathBuf> = HashMap::new();
        let mut entries = Vec::new();

        for path in paths {
            let specialist = SpecialistDef::from_file(path.to_str().unwrap_or(""))?;
            tracing::info!(
                "[SpecialistLoader] Loaded specialist: {} ({})",
                specialist.id,
                specialist.name
            );

            if let Some(previous_path) = source_paths.get(&specialist.id) {
                return Err(format!(
                    "[SpecialistLoader] Duplicate specialist id '{}' in '{}'; conflicts: '{}' and '{}'",
                    specialist.id,
                    context,
                    previous_path.display(),
                    path.display()
                ));
            }

            source_paths.insert(specialist.id.clone(), path.clone());
            entries.push((path, specialist));
        }

        Ok(entries)
    }

    /// Load all specialists from a directory.
    /// Runtime definitions and locale overlays are authored in YAML.
    pub fn load_dir(&mut self, dir: &str) -> Result<usize, String> {
        let dir_path = Path::new(dir);
        if !dir_path.is_dir() {
            return Err(format!("Specialist directory '{dir}' does not exist"));
        }

        let entries = Self::load_entries_from_directory(dir_path, dir)?;
        for (_, specialist) in &entries {
            self.specialists
                .insert(specialist.id.clone(), specialist.clone());
        }

        Ok(entries.len())
    }

    /// Load specialists from a directory and overlay locale-specific YAML definitions.
    /// Locale overlays only override specialists that already exist in the base runtime set.
    pub fn load_dir_with_locale(&mut self, dir: &str, locale: &str) -> Result<usize, String> {
        let dir_path = Path::new(dir);
        if !dir_path.is_dir() {
            return Err(format!("Specialist directory '{dir}' does not exist"));
        }

        let base_entries = Self::load_entries_from_directory(dir_path, dir)?;
        let mut loaded_count = base_entries.len();
        let base_ids = base_entries
            .iter()
            .map(|(_, specialist)| specialist.id.clone())
            .collect::<std::collections::HashSet<_>>();

        for (_, specialist) in base_entries {
            self.specialists.insert(specialist.id.clone(), specialist);
        }

        for overlay_dir in Self::locale_overlay_dirs(dir_path, locale) {
            let overlay_entries = Self::load_entries_from_directory(
                &overlay_dir,
                &format!("{} (locale {})", overlay_dir.display(), locale),
            )?;
            for (_, specialist) in overlay_entries {
                if !base_ids.contains(&specialist.id) {
                    tracing::warn!(
                        "[SpecialistLoader] Skipping locale overlay '{}' in '{}': no base specialist with matching id",
                        specialist.id,
                        overlay_dir.display()
                    );
                    continue;
                }

                self.specialists.insert(specialist.id.clone(), specialist);
                loaded_count += 1;
            }
        }

        Ok(loaded_count)
    }

    /// Get a specialist by ID.
    pub fn get(&self, id: &str) -> Option<&SpecialistDef> {
        self.specialists
            .get(id)
            .or_else(|| self.specialists.get(&id.to_lowercase()))
    }

    /// Get all loaded specialists.
    pub fn all(&self) -> &HashMap<String, SpecialistDef> {
        &self.specialists
    }

    /// Search directories for specialist files.
    /// Checks: `./specialists/`, `./resources/specialists/`, and custom paths.
    pub fn load_default_dirs(&mut self) -> usize {
        let mut total = 0;

        for dir in Self::default_search_paths() {
            if dir.is_dir() {
                let dir_str = dir.to_string_lossy().to_string();
                match self.load_dir(&dir_str) {
                    Ok(n) => {
                        tracing::info!(
                            "[SpecialistLoader] Loaded {} specialists from '{}'",
                            n,
                            dir_str
                        );
                        total += n;
                    }
                    Err(e) => {
                        tracing::warn!(
                            "[SpecialistLoader] Failed to load from '{}': {}",
                            dir_str,
                            e
                        );
                    }
                }
            }
        }

        total
    }

    /// Search default directories and overlay locale-specific YAML definitions.
    pub fn load_default_dirs_with_locale(&mut self, locale: &str) -> usize {
        let mut total = 0;

        for dir in Self::default_search_paths() {
            if dir.is_dir() {
                let dir_str = dir.to_string_lossy().to_string();
                match self.load_dir_with_locale(&dir_str, locale) {
                    Ok(n) => {
                        tracing::info!(
                            "[SpecialistLoader] Loaded {} specialists from '{}' with locale '{}'",
                            n,
                            dir_str,
                            locale
                        );
                        total += n;
                    }
                    Err(e) => {
                        tracing::warn!(
                            "[SpecialistLoader] Failed to load from '{}' with locale '{}': {}",
                            dir_str,
                            locale,
                            e
                        );
                    }
                }
            }
        }

        total
    }

    /// Default search paths in precedence order.
    pub fn default_search_paths() -> Vec<PathBuf> {
        let mut search_paths = Vec::new();

        if let Some(home_dir) = dirs::home_dir() {
            search_paths.push(home_dir.join(".routa").join("specialists"));
        }

        if let Ok(resource_dir) = std::env::var("ROUTA_SPECIALISTS_RESOURCE_DIR") {
            search_paths.extend(Self::collect_resource_search_paths(&PathBuf::from(
                resource_dir,
            )));
        }

        search_paths.push(PathBuf::from("specialists"));
        search_paths.push(PathBuf::from("resources/specialists"));
        search_paths.push(PathBuf::from("../resources/specialists"));

        search_paths
    }

    /// Get built-in fallback specialists (hardcoded, no files needed).
    pub fn builtin_specialists() -> Vec<SpecialistDef> {
        vec![
            SpecialistDef {
                id: "developer".to_string(),
                name: "Developer".to_string(),
                description: Some("Plans then implements itself".to_string()),
                role: "DEVELOPER".to_string(),
                model_tier: "smart".to_string(),
                system_prompt: "You are a skilled software developer. Plan first, then implement. \
                    Write clean, minimal code that satisfies the requirements.\n\
                    When done, summarize what you did.".to_string(),
                role_reminder: Some("Plan first, implement minimally, summarize when done.".to_string()),
                execution: SpecialistExecutionDef::default(),
                default_provider: None,
                default_adapter: None,
                default_model: None,
                metadata: HashMap::new(),
                capabilities: None,
            },
            SpecialistDef {
                id: "crafter".to_string(),
                name: "Implementor".to_string(),
                description: Some("Executes implementation tasks, writes code".to_string()),
                role: "CRAFTER".to_string(),
                model_tier: "fast".to_string(),
                system_prompt: "Implement the assigned task — nothing more, nothing less. \
                    Produce minimal, clean changes. Stay within scope.".to_string(),
                role_reminder: Some("Stay within task scope. No refactors, no scope creep.".to_string()),
                execution: SpecialistExecutionDef::default(),
                default_provider: None,
                default_adapter: None,
                default_model: None,
                metadata: HashMap::new(),
                capabilities: None,
            },
            SpecialistDef {
                id: "gate".to_string(),
                name: "Verifier".to_string(),
                description: Some("Reviews work and verifies completeness".to_string()),
                role: "GATE".to_string(),
                model_tier: "smart".to_string(),
                system_prompt: "You verify the implementation against acceptance criteria. \
                    Be evidence-driven: if you can't point to concrete evidence, it's not verified. \
                    No partial approvals.".to_string(),
                role_reminder: Some("Verify against acceptance criteria ONLY. Be evidence-driven.".to_string()),
                execution: SpecialistExecutionDef::default(),
                default_provider: None,
                default_adapter: None,
                default_model: None,
                metadata: HashMap::new(),
                capabilities: None,
            },
            SpecialistDef {
                id: "issue-refiner".to_string(),
                name: "Issue Refiner".to_string(),
                description: Some("Analyzes and refines requirements from issues".to_string()),
                role: "DEVELOPER".to_string(),
                model_tier: "smart".to_string(),
                system_prompt: "You analyze incoming issues and requirements. \
                    Break them down into clear, actionable tasks with acceptance criteria. \
                    Identify ambiguities and suggest clarifications.".to_string(),
                role_reminder: Some("Be specific about acceptance criteria and scope.".to_string()),
                execution: SpecialistExecutionDef::default(),
                default_provider: None,
                default_adapter: None,
                default_model: None,
                metadata: HashMap::new(),
                capabilities: None,
            },
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::ffi::OsString;
    use std::sync::{Mutex, MutexGuard, OnceLock};

    static ROUTA_SPECIALISTS_RESOURCE_DIR_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn specialists_resource_dir_lock() -> &'static Mutex<()> {
        ROUTA_SPECIALISTS_RESOURCE_DIR_LOCK.get_or_init(|| Mutex::new(()))
    }

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<OsString>,
    }

    impl EnvVarGuard {
        fn set_var_and_restore(value: &Path) -> Self {
            let key = "ROUTA_SPECIALISTS_RESOURCE_DIR";
            let previous = std::env::var_os(key);
            std::env::set_var(key, value);
            Self { key, previous }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(prev) = self.previous.clone() {
                std::env::set_var(self.key, prev);
            } else {
                std::env::remove_var(self.key);
            }
        }
    }

    struct SpecialistsResourceDirScope {
        _lock: MutexGuard<'static, ()>,
        _restore: EnvVarGuard,
    }

    fn with_specialists_resource_dir(path: &Path) -> SpecialistsResourceDirScope {
        let lock = specialists_resource_dir_lock().lock().unwrap();
        let restore = EnvVarGuard::set_var_and_restore(path);
        SpecialistsResourceDirScope {
            _lock: lock,
            _restore: restore,
        }
    }

    fn find_repo_root() -> PathBuf {
        let mut current = std::env::current_dir().unwrap();

        loop {
            if current.join("resources").join("specialists").is_dir() {
                return current;
            }

            if !current.pop() {
                panic!("Failed to locate repository root containing resources/specialists");
            }
        }
    }

    #[test]
    fn test_parse_specialist_yaml() {
        let yaml = r#"
id: "test-specialist"
name: "Test Specialist"
description: "A test specialist"
role: "DEVELOPER"
model_tier: "fast"
system_prompt: |
  You are a test specialist.
  Do test things.
role_reminder: "Stay on test."
"#;
        let spec = SpecialistDef::from_yaml(yaml).unwrap();
        assert_eq!(spec.id, "test-specialist");
        assert_eq!(spec.name, "Test Specialist");
        assert_eq!(spec.role, "DEVELOPER");
        assert!(spec.system_prompt.contains("test specialist"));
    }

    #[test]
    fn test_parse_specialist_yaml_execution() {
        let yaml = r#"
id: "cli-runner"
name: "CLI Runner"
execution:
  role: "CRAFTER"
  provider: "claude"
  model_tier: "smart"
  model: "sonnet-4.5"
system_prompt: |
  Run the task.
"#;

        let spec = SpecialistDef::from_yaml(yaml).unwrap();
        assert_eq!(spec.role, "CRAFTER");
        assert_eq!(spec.model_tier, "smart");
        assert_eq!(spec.default_provider.as_deref(), Some("claude"));
        assert_eq!(spec.default_model.as_deref(), Some("sonnet-4.5"));
    }

    #[test]
    fn test_builtin_specialists() {
        let builtins = SpecialistLoader::builtin_specialists();
        assert!(builtins.len() >= 4);
        assert!(builtins.iter().any(|s| s.id == "developer"));
        assert!(builtins.iter().any(|s| s.id == "crafter"));
        assert!(builtins.iter().any(|s| s.id == "gate"));
        assert!(builtins.iter().any(|s| s.id == "issue-refiner"));
    }

    #[test]
    fn test_default_search_paths_include_workspace_and_user_dir() {
        let temp_dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(
            temp_dir
                .path()
                .join("_up_")
                .join("_up_")
                .join("_up_")
                .join("resources")
                .join("specialists"),
        )
        .unwrap();
        let _scope = with_specialists_resource_dir(temp_dir.path());
        let search_paths = SpecialistLoader::default_search_paths();
        assert!(search_paths
            .iter()
            .any(|path| path == Path::new("specialists")));
        assert!(search_paths
            .iter()
            .any(|path| path == Path::new("resources/specialists")));
        assert!(search_paths
            .iter()
            .any(|path| path == &temp_dir.path().join("specialists")));
        assert!(search_paths
            .iter()
            .any(|path| path == &temp_dir.path().join("resources").join("specialists")));
        assert!(search_paths.iter().any(|path| {
            path == &temp_dir
                .path()
                .join("_up_")
                .join("_up_")
                .join("_up_")
                .join("resources")
                .join("specialists")
        }));
    }

    #[test]
    fn test_load_default_dirs_reads_tauri_resource_specialists() {
        let temp_dir = tempfile::tempdir().unwrap();
        let bundled_root = temp_dir.path().join("resources").join("specialists");
        std::fs::create_dir_all(bundled_root.join("team")).unwrap();
        std::fs::write(
            bundled_root.join("team").join("agent-lead.yaml"),
            r#"id: "team-agent-lead"
name: "Agent Lead"
role: "ROUTA"
system_prompt: "Coordinate the team."
"#,
        )
        .unwrap();

        let _scope = with_specialists_resource_dir(temp_dir.path());

        let mut loader = SpecialistLoader::new();
        let count = loader.load_default_dirs();

        assert_eq!(count, 1);
        assert!(loader.get("team-agent-lead").is_some());
    }

    #[test]
    fn test_load_default_dirs_reads_tauri_up_resource_specialists() {
        let temp_dir = tempfile::tempdir().unwrap();
        let bundled_root = temp_dir
            .path()
            .join("_up_")
            .join("_up_")
            .join("_up_")
            .join("resources")
            .join("specialists");
        std::fs::create_dir_all(bundled_root.join("team")).unwrap();
        std::fs::write(
            bundled_root.join("team").join("qa.yaml"),
            r#"id: "team-qa"
name: "QA Specialist"
role: "GATE"
system_prompt: "Verify the work."
"#,
        )
        .unwrap();

        let _scope = with_specialists_resource_dir(temp_dir.path());

        let mut loader = SpecialistLoader::new();
        let count = loader.load_default_dirs();

        assert_eq!(count, 1);
        assert!(loader.get("team-qa").is_some());
    }

    #[test]
    fn test_load_dir_recurses_and_skips_locale_directories() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();

        std::fs::create_dir_all(root.join("core")).unwrap();
        std::fs::create_dir_all(root.join("review")).unwrap();
        std::fs::create_dir_all(root.join("zh-CN")).unwrap();
        std::fs::create_dir_all(root.join("locales").join("zh-CN")).unwrap();

        std::fs::write(
            root.join("core").join("developer.yaml"),
            r#"id: "developer"
name: "Developer"
system_prompt: "Developer prompt"
"#,
        )
        .unwrap();
        std::fs::write(
            root.join("review").join("gate.yaml"),
            r#"id: "gate"
name: "Gate"
system_prompt: "Gate prompt"
"#,
        )
        .unwrap();
        std::fs::write(
            root.join("zh-CN").join("developer.yaml"),
            r#"id: "developer"
name: "开发者"
system_prompt: "中文 prompt"
"#,
        )
        .unwrap();
        std::fs::write(
            root.join("locales").join("zh-CN").join("gate.yaml"),
            r#"id: "gate"
name: "验证者"
system_prompt: "中文 gate"
"#,
        )
        .unwrap();

        let mut loader = SpecialistLoader::new();
        loader.load_dir(root.to_str().unwrap()).unwrap();

        assert!(loader.get("developer").is_some());
        assert!(loader.get("gate").is_some());
        assert_eq!(loader.all().len(), 2);
    }

    #[test]
    fn test_load_dir_ignores_markdown_runtime_files() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();

        std::fs::write(
            root.join("developer.yaml"),
            r#"id: "developer"
name: "Developer YAML"
system_prompt: "yaml prompt"
"#,
        )
        .unwrap();
        std::fs::write(
            root.join("developer.md"),
            r#"---
name: "Developer Markdown"
role: "DEVELOPER"
---

markdown prompt
"#,
        )
        .unwrap();

        let mut loader = SpecialistLoader::new();
        loader.load_dir(root.to_str().unwrap()).unwrap();

        let developer = loader.get("developer").unwrap();
        assert_eq!(developer.name, "Developer YAML");
        assert!(developer.system_prompt.contains("yaml prompt"));
    }

    #[test]
    fn test_load_dir_fails_on_duplicate_specialist_ids() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();

        std::fs::create_dir_all(root.join("core")).unwrap();
        std::fs::create_dir_all(root.join("review")).unwrap();
        std::fs::write(
            root.join("core").join("developer.yaml"),
            r#"id: "developer"
name: "Developer"
system_prompt: "first prompt"
"#,
        )
        .unwrap();
        std::fs::write(
            root.join("review").join("duplicate.yaml"),
            r#"id: "developer"
name: "Developer Duplicate"
system_prompt: "second prompt"
"#,
        )
        .unwrap();

        let mut loader = SpecialistLoader::new();
        let err = loader.load_dir(root.to_str().unwrap()).unwrap_err();

        assert!(err.contains("Duplicate specialist id 'developer'"));
        assert!(err.contains("conflicts"));
    }

    #[test]
    fn test_load_dir_with_locale_overlays_base_definitions() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();

        std::fs::create_dir_all(root.join("core")).unwrap();
        std::fs::create_dir_all(root.join("review")).unwrap();
        std::fs::create_dir_all(root.join("locales").join("zh-CN").join("core")).unwrap();

        std::fs::write(
            root.join("core").join("developer.yaml"),
            r#"id: "developer"
name: "Developer"
system_prompt: "English developer prompt"
"#,
        )
        .unwrap();
        std::fs::write(
            root.join("review").join("gate.yaml"),
            r#"id: "gate"
name: "Gate"
system_prompt: "English gate prompt"
"#,
        )
        .unwrap();
        std::fs::write(
            root.join("locales")
                .join("zh-CN")
                .join("core")
                .join("developer.yaml"),
            r#"id: "developer"
name: "开发者"
system_prompt: "中文 developer prompt"
"#,
        )
        .unwrap();

        let mut loader = SpecialistLoader::new();
        loader
            .load_dir_with_locale(root.to_str().unwrap(), "zh-CN")
            .unwrap();

        let developer = loader.get("developer").unwrap();
        let gate = loader.get("gate").unwrap();

        assert_eq!(developer.name, "开发者");
        assert_eq!(developer.system_prompt, "中文 developer prompt");
        assert_eq!(gate.name, "Gate");
        assert_eq!(gate.system_prompt, "English gate prompt");
    }

    #[test]
    fn test_load_default_dirs_with_locale_reads_bundled_overlays() {
        let temp_dir = tempfile::tempdir().unwrap();
        let bundled_root = temp_dir.path().join("resources").join("specialists");
        std::fs::create_dir_all(bundled_root.join("core")).unwrap();
        std::fs::create_dir_all(bundled_root.join("locales").join("zh-CN").join("core")).unwrap();
        std::fs::write(
            bundled_root.join("core").join("developer.yaml"),
            r#"id: "developer"
name: "Developer"
system_prompt: "English prompt"
"#,
        )
        .unwrap();
        std::fs::write(
            bundled_root
                .join("locales")
                .join("zh-CN")
                .join("core")
                .join("developer.yaml"),
            r#"id: "developer"
name: "开发者"
system_prompt: "中文 prompt"
"#,
        )
        .unwrap();

        let _scope = with_specialists_resource_dir(temp_dir.path());

        let mut loader = SpecialistLoader::new();
        let count = loader.load_default_dirs_with_locale("zh-CN");

        assert_eq!(count, 2);
        assert_eq!(loader.get("developer").unwrap().name, "开发者");
    }

    #[test]
    fn test_repository_specialist_resources_use_taxonomy_locale_overlays() {
        let repo_root = find_repo_root();
        let bundled_root = repo_root.join("resources").join("specialists");
        let english_overlay_root = bundled_root.join("locales").join("en");
        let chinese_overlay_root = bundled_root.join("locales").join("zh-CN");

        let mut runtime_loader = SpecialistLoader::new();
        runtime_loader
            .load_dir(bundled_root.to_str().unwrap())
            .unwrap();
        let runtime_ids: HashSet<String> = runtime_loader.all().keys().cloned().collect();

        let mut english_overlay_loader = SpecialistLoader::new();
        english_overlay_loader
            .load_dir(english_overlay_root.to_str().unwrap())
            .unwrap();
        let english_overlay_ids: HashSet<String> =
            english_overlay_loader.all().keys().cloned().collect();

        let mut chinese_overlay_loader = SpecialistLoader::new();
        chinese_overlay_loader
            .load_dir(chinese_overlay_root.to_str().unwrap())
            .unwrap();
        let chinese_overlay_ids: HashSet<String> =
            chinese_overlay_loader.all().keys().cloned().collect();

        assert!(
            !bundled_root.join("zh-CN").exists(),
            "legacy locale directory should not exist at {}",
            bundled_root.join("zh-CN").display()
        );
        assert_eq!(english_overlay_ids, runtime_ids);
        assert_eq!(chinese_overlay_ids, runtime_ids);
    }
}
