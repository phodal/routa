//! Skills discovery and registry.
//!
//! Discovers SKILL.md files from well-known directories on the filesystem,
//! matching the TypeScript implementation's behavior.
//!
//! SKILL.md files use YAML frontmatter for metadata:
//! ```markdown
//! ---
//! name: skill-name
//! description: What this skill does.
//! metadata:
//!   short-description: Brief label
//! ---
//!
//! Full instructions for the agent...
//! ```

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::RwLock;

/// YAML frontmatter parsed from a SKILL.md file.
#[derive(Debug, Deserialize)]
struct SkillFrontmatter {
    name: String,
    description: String,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    compatibility: Option<String>,
    #[serde(default)]
    metadata: SkillFrontmatterMetadata,
}

#[derive(Debug, Default, Deserialize)]
struct SkillFrontmatterMetadata {
    #[serde(default, rename = "short-description")]
    short_description: Option<String>,
}

/// A discovered skill definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDefinition {
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_description: Option<String>,
    pub content: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compatibility: Option<String>,
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
    ".gemini/skills",
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

/// Recursively discover SKILL.md files in a directory (max 2 levels deep).
fn discover_skills_in_dir(dir: &Path, out: &mut HashMap<String, SkillDefinition>) {
    discover_skills_recursive(dir, out, 0, 2);
}

fn discover_skills_recursive(
    dir: &Path,
    out: &mut HashMap<String, SkillDefinition>,
    depth: usize,
    max_depth: usize,
) {
    if depth > max_depth {
        return;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let skill_file = path.join(SKILL_FILENAME);
            if skill_file.is_file() {
                if let Some(skill) = parse_skill_file(&skill_file) {
                    out.insert(skill.name.clone(), skill);
                }
            }
            // Recurse deeper (handles .system subdirs, nested structures)
            discover_skills_recursive(&path, out, depth + 1, max_depth);
        } else if path.file_name().map(|f| f == SKILL_FILENAME).unwrap_or(false) {
            if let Some(skill) = parse_skill_file(&path) {
                out.insert(skill.name.clone(), skill);
            }
        }
    }
}

/// Extract YAML frontmatter from between `---` delimiters.
fn extract_frontmatter(contents: &str) -> Option<(String, String)> {
    let mut lines = contents.lines();
    if !matches!(lines.next(), Some(line) if line.trim() == "---") {
        return None;
    }

    let mut frontmatter_lines: Vec<&str> = Vec::new();
    let mut body_start = false;
    let mut body_lines: Vec<&str> = Vec::new();

    for line in lines {
        if !body_start {
            if line.trim() == "---" {
                body_start = true;
            } else {
                frontmatter_lines.push(line);
            }
        } else {
            body_lines.push(line);
        }
    }

    if frontmatter_lines.is_empty() || !body_start {
        return None;
    }

    Some((frontmatter_lines.join("\n"), body_lines.join("\n")))
}

/// Parse a SKILL.md file into a SkillDefinition.
///
/// Supports two formats:
/// 1. YAML frontmatter (preferred): `---\nname: ...\ndescription: ...\n---\n<body>`
/// 2. Legacy fallback: directory name as name, first paragraph as description
fn parse_skill_file(path: &Path) -> Option<SkillDefinition> {
    let raw = std::fs::read_to_string(path).ok()?;

    // Try YAML frontmatter first
    if let Some((frontmatter_str, body)) = extract_frontmatter(&raw) {
        if let Ok(fm) = serde_yaml::from_str::<SkillFrontmatter>(&frontmatter_str) {
            let short_desc = fm
                .metadata
                .short_description
                .filter(|s| !s.is_empty());

            return Some(SkillDefinition {
                name: fm.name,
                description: fm.description,
                short_description: short_desc,
                content: body.trim().to_string(),
                source: path.to_string_lossy().to_string(),
                license: fm.license,
                compatibility: fm.compatibility,
                metadata: HashMap::new(),
            });
        }
    }

    // Fallback: extract name from directory, description from first paragraph
    let name = path
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let description = raw
        .lines()
        .skip_while(|l| l.starts_with('#') || l.starts_with("---") || l.trim().is_empty())
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
        short_description: None,
        content: raw,
        source: path.to_string_lossy().to_string(),
        license: None,
        compatibility: None,
        metadata: HashMap::new(),
    })
}
