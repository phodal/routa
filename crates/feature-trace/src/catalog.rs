use crate::error::FeatureTraceError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Ord, PartialOrd)]
pub enum FeatureSurfaceKind {
    Page,
    Api,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeatureSurface {
    pub kind: FeatureSurfaceKind,
    pub route: String,
    pub source_path: String,
    pub source_dir: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SurfaceLinkConfidence {
    High,
    Medium,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeatureSurfaceLink {
    pub kind: FeatureSurfaceKind,
    pub route: String,
    pub source_path: String,
    pub via_path: String,
    pub confidence: SurfaceLinkConfidence,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeatureSurfaceCatalog {
    pub surfaces: Vec<FeatureSurface>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProductFeature {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub group: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub pages: Vec<String>,
    #[serde(default)]
    pub apis: Vec<String>,
    #[serde(default)]
    pub source_files: Vec<String>,
    #[serde(default)]
    pub related_features: Vec<String>,
    #[serde(default)]
    pub domain_objects: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrontendPageDetail {
    pub name: String,
    pub route: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApiEndpointDetail {
    pub domain: String,
    pub method: String,
    pub endpoint: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeatureTreeCatalog {
    pub capability_groups: Vec<CapabilityGroup>,
    pub features: Vec<ProductFeature>,
    pub frontend_pages: Vec<FrontendPageDetail>,
    pub api_endpoints: Vec<ApiEndpointDetail>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProductFeatureLink {
    pub feature_id: String,
    pub feature_name: String,
    pub route: Option<String>,
    pub via_path: String,
    pub confidence: SurfaceLinkConfidence,
}

#[derive(Debug, Deserialize)]
struct FeatureTreeFrontmatter {
    #[serde(default)]
    feature_metadata: FeatureMetadata,
}

#[derive(Debug, Default, Deserialize)]
struct FeatureMetadata {
    #[serde(default)]
    capability_groups: Vec<CapabilityGroup>,
    #[serde(default)]
    features: Vec<ProductFeature>,
}

impl FeatureSurfaceCatalog {
    pub fn from_repo_root(repo_root: &Path) -> Result<Self, FeatureTraceError> {
        let app_root = repo_root.join("src").join("app");
        let mut paths = Vec::new();
        collect_paths(&app_root, &mut paths)?;

        let mut surfaces = Vec::new();
        for path in paths {
            let rel = path
                .strip_prefix(repo_root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if rel.ends_with("/page.tsx") {
                let route = normalize_page_route(&rel);
                let source_dir = rel.trim_end_matches("/page.tsx").to_string();
                surfaces.push(FeatureSurface {
                    kind: FeatureSurfaceKind::Page,
                    route,
                    source_path: rel,
                    source_dir,
                });
            } else if rel.contains("/api/") && rel.ends_with("/route.ts") {
                let route = normalize_api_route(&rel);
                let source_dir = rel.trim_end_matches("/route.ts").to_string();
                surfaces.push(FeatureSurface {
                    kind: FeatureSurfaceKind::Api,
                    route,
                    source_path: rel,
                    source_dir,
                });
            }
        }

        surfaces.sort_by(|a, b| {
            a.route
                .cmp(&b.route)
                .then(a.source_path.cmp(&b.source_path))
        });
        Ok(Self { surfaces })
    }

    pub fn best_links_for_path(&self, changed_path: &str) -> Vec<FeatureSurfaceLink> {
        let mut best_per_kind: BTreeMap<FeatureSurfaceKind, (usize, bool, &FeatureSurface)> =
            BTreeMap::new();

        for surface in &self.surfaces {
            let direct = changed_path == surface.source_path;
            let nested = surface.route != "/"
                && changed_path.starts_with(&(surface.source_dir.clone() + "/"));
            if !direct && !nested {
                continue;
            }

            let specificity = surface.source_dir.matches('/').count();
            let replace = match best_per_kind.get(&surface.kind) {
                Some((best_specificity, best_direct, _)) => {
                    (direct && !best_direct)
                        || (direct == *best_direct && specificity > *best_specificity)
                }
                None => true,
            };

            if replace {
                best_per_kind.insert(surface.kind.clone(), (specificity, direct, surface));
            }
        }

        best_per_kind
            .into_values()
            .map(|(_, direct, surface)| FeatureSurfaceLink {
                kind: surface.kind.clone(),
                route: surface.route.clone(),
                source_path: surface.source_path.clone(),
                via_path: changed_path.to_string(),
                confidence: if direct {
                    SurfaceLinkConfidence::High
                } else {
                    SurfaceLinkConfidence::Medium
                },
            })
            .collect()
    }
}

impl FeatureTreeCatalog {
    pub fn from_feature_tree_markdown(path: &Path) -> Result<Self, FeatureTraceError> {
        let raw = fs::read_to_string(path)?;
        let frontmatter = extract_frontmatter(&raw).ok_or(FeatureTraceError::MissingFrontmatter)?;
        let parsed: FeatureTreeFrontmatter = serde_yaml::from_str(frontmatter)?;
        let (frontend_pages, api_endpoints) = parse_feature_tree_tables(&raw);
        Ok(Self {
            capability_groups: parsed.feature_metadata.capability_groups,
            features: parsed.feature_metadata.features,
            frontend_pages,
            api_endpoints,
        })
    }

    pub fn frontend_page_for_route(&self, route: &str) -> Option<&FrontendPageDetail> {
        self.frontend_pages.iter().find(|page| page.route == route)
    }

    pub fn api_endpoint_for_declaration(
        &self,
        declaration: &str,
    ) -> Option<&ApiEndpointDetail> {
        let (method, endpoint) = split_declared_api(declaration)?;
        self.api_endpoints.iter().find(|api| {
            api.method.eq_ignore_ascii_case(method) && api.endpoint == endpoint
        })
    }

    pub fn best_links_for_surface(&self, surface: &FeatureSurfaceLink) -> Vec<ProductFeatureLink> {
        self.features
            .iter()
            .filter_map(|feature| {
                let source_match = feature.source_files.iter().any(|path| {
                    path == &surface.source_path || path == &surface.via_path
                });
                let route_match = match surface.kind {
                    FeatureSurfaceKind::Page => feature.pages.iter().any(|route| route == &surface.route),
                    FeatureSurfaceKind::Api => feature.apis.iter().any(|route| route == &surface.route),
                };
                if !source_match && !route_match {
                    return None;
                }
                Some(ProductFeatureLink {
                    feature_id: feature.id.clone(),
                    feature_name: feature.name.clone(),
                    route: Some(surface.route.clone()),
                    via_path: surface.via_path.clone(),
                    confidence: if source_match {
                        SurfaceLinkConfidence::High
                    } else {
                        SurfaceLinkConfidence::Medium
                    },
                })
            })
            .collect()
    }

    pub fn best_links_for_path(&self, changed_path: &str) -> Vec<ProductFeatureLink> {
        self.features
            .iter()
            .filter(|feature| {
                feature
                    .source_files
                    .iter()
                    .any(|path| path == changed_path)
            })
            .map(|feature| ProductFeatureLink {
                feature_id: feature.id.clone(),
                feature_name: feature.name.clone(),
                route: None,
                via_path: changed_path.to_string(),
                confidence: SurfaceLinkConfidence::High,
            })
            .collect()
    }
}

fn collect_paths(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), FeatureTraceError> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            collect_paths(&path, out)?;
        } else {
            out.push(path);
        }
    }
    Ok(())
}

fn extract_frontmatter(raw: &str) -> Option<&str> {
    let trimmed = raw.strip_prefix("---\n")?;
    let end = trimmed.find("\n---\n")?;
    Some(&trimmed[..end])
}

fn parse_feature_tree_tables(raw: &str) -> (Vec<FrontendPageDetail>, Vec<ApiEndpointDetail>) {
    let mut frontend_pages = Vec::new();
    let mut api_endpoints = Vec::new();

    let mut section = TableSection::None;
    let mut active_table = ActiveTable::None;
    let mut current_api_domain = String::new();

    for line in raw.lines() {
        let trimmed = line.trim();

        match trimmed {
            "## Frontend Pages" => {
                section = TableSection::FrontendPages;
                active_table = ActiveTable::None;
                continue;
            }
            "## API Endpoints" => {
                section = TableSection::ApiEndpoints;
                active_table = ActiveTable::None;
                continue;
            }
            _ if trimmed.starts_with("## ") => {
                section = TableSection::None;
                active_table = ActiveTable::None;
                continue;
            }
            _ => {}
        }

        match section {
            TableSection::FrontendPages => {
                if trimmed == "| Page | Route | Description |" {
                    active_table = ActiveTable::FrontendPages;
                    continue;
                }
                if active_table == ActiveTable::FrontendPages {
                    if trimmed == "|------|-------|-------------|" {
                        continue;
                    }
                    if trimmed.is_empty() || trimmed == "---" {
                        active_table = ActiveTable::None;
                        continue;
                    }
                    if let Some(cells) = parse_markdown_row(trimmed) {
                        if cells.len() >= 3 {
                            frontend_pages.push(FrontendPageDetail {
                                name: cells[0].clone(),
                                route: strip_inline_code(&cells[1]),
                                description: cells[2].clone(),
                            });
                        }
                    }
                }
            }
            TableSection::ApiEndpoints => {
                if let Some(domain) = trimmed.strip_prefix("### ") {
                    current_api_domain = domain
                        .rsplit_once(" (")
                        .map(|(label, _)| label.to_string())
                        .unwrap_or_else(|| domain.to_string());
                    active_table = ActiveTable::None;
                    continue;
                }
                if trimmed == "| Method | Endpoint | Description |" {
                    active_table = ActiveTable::ApiEndpoints;
                    continue;
                }
                if active_table == ActiveTable::ApiEndpoints {
                    if trimmed == "|--------|----------|-------------|" {
                        continue;
                    }
                    if trimmed.is_empty() {
                        active_table = ActiveTable::None;
                        continue;
                    }
                    if let Some(cells) = parse_markdown_row(trimmed) {
                        if cells.len() >= 3 {
                            api_endpoints.push(ApiEndpointDetail {
                                domain: current_api_domain.clone(),
                                method: cells[0].clone(),
                                endpoint: strip_inline_code(&cells[1]),
                                description: cells[2].clone(),
                            });
                        }
                    }
                }
            }
            TableSection::None => {}
        }
    }

    (frontend_pages, api_endpoints)
}

fn parse_markdown_row(line: &str) -> Option<Vec<String>> {
    let trimmed = line.trim();
    if !trimmed.starts_with('|') || !trimmed.ends_with('|') {
        return None;
    }
    Some(
        trimmed[1..trimmed.len() - 1]
            .split('|')
            .map(|cell| cell.trim().to_string())
            .collect(),
    )
}

fn strip_inline_code(value: &str) -> String {
    value.trim().trim_matches('`').to_string()
}

fn split_declared_api(declaration: &str) -> Option<(&str, &str)> {
    let (method, endpoint) = declaration.split_once(' ')?;
    Some((method.trim(), endpoint.trim()))
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum TableSection {
    #[default]
    None,
    FrontendPages,
    ApiEndpoints,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum ActiveTable {
    #[default]
    None,
    FrontendPages,
    ApiEndpoints,
}

fn normalize_page_route(rel: &str) -> String {
    if rel == "src/app/page.tsx" {
        return "/".to_string();
    }
    let route = rel
        .trim_start_matches("src/app/")
        .trim_end_matches("/page.tsx");
    format!("/{}", normalize_page_segments(route))
}

fn normalize_api_route(rel: &str) -> String {
    let mut route = rel
        .trim_start_matches("src/app/")
        .trim_end_matches("/route.ts")
        .to_string();
    route = route.replace("[...", "{");
    route = route.replace('[', "{");
    route = route.replace(']', "}");
    format!("/{route}")
}

fn normalize_page_segments(route: &str) -> String {
    route
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            if segment.starts_with("[...") && segment.ends_with(']') {
                format!(":{}", &segment[4..segment.len() - 1])
            } else if segment.starts_with('[') && segment.ends_with(']') {
                format!(":{}", &segment[1..segment.len() - 1])
            } else {
                segment.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn builds_catalog_and_picks_most_specific_matches() {
        let dir = tempdir().unwrap();
        let repo = dir.path();
        fs::create_dir_all(repo.join("src/app/workspace/[workspaceId]/sessions/[sessionId]"))
            .unwrap();
        fs::create_dir_all(repo.join("src/app/api/sessions/[sessionId]")).unwrap();
        fs::write(repo.join("src/app/page.tsx"), "").unwrap();
        fs::write(
            repo.join("src/app/workspace/[workspaceId]/sessions/[sessionId]/page.tsx"),
            "",
        )
        .unwrap();
        fs::write(repo.join("src/app/api/sessions/[sessionId]/route.ts"), "").unwrap();

        let catalog = FeatureSurfaceCatalog::from_repo_root(repo).unwrap();
        let links = catalog.best_links_for_path(
            "src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx",
        );

        assert_eq!(links.len(), 1);
        assert_eq!(
            links[0].route,
            "/workspace/:workspaceId/sessions/:sessionId"
        );

        let api_links = catalog.best_links_for_path("src/app/api/sessions/[sessionId]/route.ts");
        assert_eq!(api_links.len(), 1);
        assert_eq!(api_links[0].route, "/api/sessions/{sessionId}");
    }

    #[test]
    fn parses_feature_tree_frontmatter_and_links_surface() {
        let dir = tempdir().unwrap();
        let feature_tree = dir.path().join("FEATURE_TREE.md");
        fs::write(
            &feature_tree,
            r#"---
feature_metadata:
  features:
    - id: session-recovery
      name: Session Recovery
      pages:
        - /workspace/:workspaceId/sessions/:sessionId
      apis:
        - /api/sessions/{id}
      source_files:
        - src/app/workspace/[workspaceId]/sessions/[sessionId]/page.tsx
---

# Placeholder

    ## Frontend Pages

    | Page | Route | Description |
    |------|-------|-------------|
    | Workspace / Sessions | `/workspace/:workspaceId/sessions/:sessionId` | Session detail page |

    ---

    ## API Endpoints

    ### Sessions (1)

    | Method | Endpoint | Description |
    |--------|----------|-------------|
    | GET | `/api/sessions/{id}` | Get session by ID |
"#,
        )
        .unwrap();

        let catalog = FeatureTreeCatalog::from_feature_tree_markdown(&feature_tree).unwrap();
        let links = catalog.best_links_for_surface(&FeatureSurfaceLink {
            kind: FeatureSurfaceKind::Page,
            route: "/workspace/:workspaceId/sessions/:sessionId".to_string(),
            source_path: "src/app/workspace/[workspaceId]/sessions/[sessionId]/page.tsx".to_string(),
            via_path: "src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx".to_string(),
            confidence: SurfaceLinkConfidence::Medium,
        });

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].feature_id, "session-recovery");
        assert_eq!(links[0].route.as_deref(), Some("/workspace/:workspaceId/sessions/:sessionId"));
        assert_eq!(catalog.frontend_pages.len(), 1);
        assert_eq!(catalog.frontend_pages[0].description, "Session detail page");
        assert_eq!(catalog.api_endpoints.len(), 1);
        assert_eq!(catalog.api_endpoints[0].domain, "Sessions");
    }
}
