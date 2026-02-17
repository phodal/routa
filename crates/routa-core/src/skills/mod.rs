//! Skills discovery and registry.
//!
//! Discovers SKILL.md files from well-known directories on the filesystem,
//! matching the TypeScript implementation's behavior.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::RwLock;

/// A discovered skill definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDefinition {
    pub name: String,
    pub description: String,
    pub content: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
}

/// Well-known directory patterns where skills can be found.
const SKILL_DIRS: &[&str] = &[
    ".opencode/skills",
    ".claude/skills",
    ".agents/skills",
    ".codex/skills",
    ".cursor/skills",
];

const SKILL_FILENAME: &str = "SKILL.md";

/// In-memory registry for discovered skills.
pub struct SkillRegistry {
    skills: RwLock<HashMap<String, SkillDefinition>>,
}

impl SkillRegistry {
    pub fn new() -> Self {
        Self {
            skills: RwLock::new(HashMap::new()),
        }
    }

    /// Discover and load skills from well-known directories.
    pub fn reload(&self, cwd: &str) {
        let mut discovered = HashMap::new();

        let cwd_path = Path::new(cwd);

        // Scan well-known directories relative to cwd
        for dir_pattern in SKILL_DIRS {
            let skill_dir = cwd_path.join(dir_pattern);
            if skill_dir.is_dir() {
                discover_skills_in_dir(&skill_dir, &mut discovered);
            }
        }

        // Also scan home directory skill locations
        if let Some(home) = dirs::home_dir() {
            for dir_pattern in SKILL_DIRS {
                let skill_dir = home.join(dir_pattern);
                if skill_dir.is_dir() {
                    discover_skills_in_dir(&skill_dir, &mut discovered);
                }
            }
        }

        let count = discovered.len();
        if let Ok(mut skills) = self.skills.write() {
            *skills = discovered;
        }
        tracing::info!("Discovered {} skills", count);
    }

    /// Get a skill by name.
    pub fn get_skill(&self, name: &str) -> Option<SkillDefinition> {
        self.skills
            .read()
            .ok()
            .and_then(|s| s.get(name).cloned())
    }

    /// List all discovered skills.
    pub fn list_skills(&self) -> Vec<SkillDefinition> {
        self.skills
            .read()
            .map(|s| s.values().cloned().collect())
            .unwrap_or_default()
    }
}

/// Recursively discover SKILL.md files in a directory.
fn discover_skills_in_dir(dir: &Path, out: &mut HashMap<String, SkillDefinition>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // Look for SKILL.md in the subdirectory
            let skill_file = path.join(SKILL_FILENAME);
            if skill_file.is_file() {
                if let Some(skill) = parse_skill_file(&skill_file) {
                    out.insert(skill.name.clone(), skill);
                }
            }
            // Recurse one level deeper
            discover_skills_in_dir(&path, out);
        } else if path.file_name().map(|f| f == SKILL_FILENAME).unwrap_or(false) {
            if let Some(skill) = parse_skill_file(&path) {
                out.insert(skill.name.clone(), skill);
            }
        }
    }
}

/// Parse a SKILL.md file into a SkillDefinition.
fn parse_skill_file(path: &Path) -> Option<SkillDefinition> {
    let content = std::fs::read_to_string(path).ok()?;

    // Extract skill name from the directory name or the first heading
    let name = path
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // Extract description from the first paragraph after the heading
    let description = content
        .lines()
        .skip_while(|l| l.starts_with('#') || l.trim().is_empty())
        .take_while(|l| !l.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    Some(SkillDefinition {
        name,
        description: if description.is_empty() {
            "No description".to_string()
        } else {
            description
        },
        content,
        source: path.to_string_lossy().to_string(),
        license: None,
        metadata: HashMap::new(),
    })
}
