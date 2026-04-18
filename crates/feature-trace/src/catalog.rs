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
    #[serde(default, alias = "sourceFiles")]
    pub source_files: Vec<String>,
    #[serde(default, alias = "relatedFeatures")]
    pub related_features: Vec<String>,
    #[serde(default, alias = "domainObjects")]
    pub domain_objects: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrontendPageDetail {
    #[serde(alias = "title")]
    pub name: String,
    pub route: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApiEndpointDetail {
    pub domain: String,
    pub method: String,
    #[serde(alias = "path")]
    pub endpoint: String,
    #[serde(default, alias = "summary")]
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

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeatureSurfaceIndexPayload {
    #[serde(default)]
    pages: Vec<FrontendPageDetail>,
    #[serde(default)]
    apis: Vec<ApiEndpointDetail>,
    #[serde(default)]
    contract_apis: Vec<ApiEndpointDetail>,
    metadata: Option<FeatureSurfaceIndexMetadata>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeatureSurfaceIndexMetadata {
    #[serde(default, alias = "capability_groups")]
    capability_groups: Vec<CapabilityGroup>,
    #[serde(default)]
    features: Vec<ProductFeature>,
}

#[derive(Debug, Deserialize)]
struct OpenApiContract {
    #[serde(default)]
    paths: BTreeMap<String, BTreeMap<String, serde_yaml::Value>>,
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
    pub fn from_repo_root(repo_root: &Path) -> Result<Self, FeatureTraceError> {
        let feature_tree_path = repo_root.join("docs/product-specs/FEATURE_TREE.md");
        let surface_index_path = repo_root.join("docs/product-specs/feature-tree.index.json");
        let api_contract_path = repo_root.join("api-contract.yaml");

        let markdown_catalog = if feature_tree_path.exists() {
            Some(Self::from_feature_tree_markdown(&feature_tree_path)?)
        } else {
            None
        };
        let surface_index_catalog = if surface_index_path.exists() {
            match Self::from_surface_index_json(&surface_index_path) {
                Ok(catalog) => Some(catalog),
                Err(error) if markdown_catalog.is_some() => {
                    let _ = error;
                    None
                }
                Err(error) => return Err(error),
            }
        } else {
            None
        };

        let mut catalog = if let Some(index_catalog) = surface_index_catalog {
            index_catalog
        } else {
            markdown_catalog.clone().unwrap_or_default()
        };

        if let Some(markdown_catalog) = markdown_catalog {
            if catalog.capability_groups.is_empty() {
                catalog.capability_groups = markdown_catalog.capability_groups;
            }
            if catalog.features.is_empty() {
                catalog.features = markdown_catalog.features;
            }
            if catalog.frontend_pages.is_empty() {
                catalog.frontend_pages = markdown_catalog.frontend_pages;
            }
            catalog.api_endpoints =
                merge_api_endpoint_lists([catalog.api_endpoints, markdown_catalog.api_endpoints]);
        }

        if api_contract_path.exists() {
            if let Ok(contract_apis) = api_endpoints_from_openapi_contract(&api_contract_path) {
                catalog.api_endpoints =
                    merge_api_endpoint_lists([contract_apis, catalog.api_endpoints]);
            }
        }

        Ok(catalog)
    }

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

    pub fn from_surface_index_json(path: &Path) -> Result<Self, FeatureTraceError> {
        let payload: FeatureSurfaceIndexPayload = serde_json::from_str(&fs::read_to_string(path)?)?;
        let metadata = payload.metadata.unwrap_or_default();
        let api_endpoints = if payload.contract_apis.is_empty() {
            payload.apis
        } else {
            payload.contract_apis
        };

        Ok(Self {
            capability_groups: metadata.capability_groups,
            features: metadata.features,
            frontend_pages: payload.pages,
            api_endpoints,
        })
    }

    pub fn frontend_page_for_route(&self, route: &str) -> Option<&FrontendPageDetail> {
        self.frontend_pages.iter().find(|page| page.route == route)
    }

    pub fn api_endpoint_for_declaration(&self, declaration: &str) -> Option<&ApiEndpointDetail> {
        let (method, endpoint) = split_declared_api(declaration)?;
        self.api_endpoints
            .iter()
            .find(|api| api.method.eq_ignore_ascii_case(method) && api.endpoint == endpoint)
    }

    pub fn best_links_for_surface(&self, surface: &FeatureSurfaceLink) -> Vec<ProductFeatureLink> {
        self.features
            .iter()
            .filter_map(|feature| {
                let source_match = feature
                    .source_files
                    .iter()
                    .any(|path| path == &surface.source_path || path == &surface.via_path);
                let route_match = match surface.kind {
                    FeatureSurfaceKind::Page => {
                        feature.pages.iter().any(|route| route == &surface.route)
                    }
                    FeatureSurfaceKind::Api => {
                        feature.apis.iter().any(|route| route == &surface.route)
                    }
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
            .filter(|feature| feature.source_files.iter().any(|path| path == changed_path))
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

pub fn api_endpoints_from_openapi_contract(
    path: &Path,
) -> Result<Vec<ApiEndpointDetail>, FeatureTraceError> {
    let payload: OpenApiContract = serde_yaml::from_str(&fs::read_to_string(path)?)?;
    let mut endpoints = Vec::new();

    for (endpoint, methods) in payload.paths {
        let Some(domain) = domain_from_api_path(&endpoint) else {
            continue;
        };

        for (method, operation) in methods {
            let method_upper = method.trim().to_ascii_uppercase();
            if !is_http_method(&method_upper) {
                continue;
            }

            endpoints.push(ApiEndpointDetail {
                domain: domain.clone(),
                method: method_upper,
                endpoint: endpoint.clone(),
                description: operation_summary(&operation),
            });
        }
    }

    Ok(sort_api_endpoints(endpoints))
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
            "## API Endpoints" | "## API Contract Endpoints" | "## HTTP Contract Endpoints" => {
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
                if trimmed == "| Page | Route | Description |"
                    || trimmed == "| Page | Route | Source File | Description |"
                {
                    active_table = ActiveTable::FrontendPages;
                    continue;
                }
                if active_table == ActiveTable::FrontendPages {
                    if trimmed == "|------|-------|-------------|"
                        || trimmed == "|------|-------|-------------|-------------|"
                    {
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
                                description: if cells.len() >= 4 {
                                    cells[3].clone()
                                } else {
                                    cells[2].clone()
                                },
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
                if trimmed == "| Method | Endpoint | Description |"
                    || trimmed == "| Method | Endpoint | Details |"
                {
                    active_table = ActiveTable::ApiEndpoints;
                    continue;
                }
                if active_table == ActiveTable::ApiEndpoints {
                    if trimmed == "|--------|----------|-------------|"
                        || trimmed == "|--------|----------|---------|"
                    {
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

fn domain_from_api_path(endpoint: &str) -> Option<String> {
    let mut segments = endpoint
        .trim()
        .split('/')
        .filter(|segment| !segment.is_empty())
        .filter(|segment| !(segment.starts_with('{') && segment.ends_with('}')))
        .filter(|segment| !segment.starts_with(':'));
    let first = segments.next()?;
    if first == "api" {
        return segments
            .next()
            .map(str::to_string)
            .or_else(|| Some(first.to_string()));
    }
    Some(first.to_string())
}

fn is_http_method(method: &str) -> bool {
    matches!(
        method,
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD"
    )
}

fn operation_summary(operation: &serde_yaml::Value) -> String {
    operation
        .as_mapping()
        .and_then(|mapping| mapping.get(serde_yaml::Value::String("summary".to_string())))
        .and_then(serde_yaml::Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn merge_api_endpoint_lists<const N: usize>(
    lists: [Vec<ApiEndpointDetail>; N],
) -> Vec<ApiEndpointDetail> {
    let mut merged: BTreeMap<(String, String), ApiEndpointDetail> = BTreeMap::new();

    for list in lists {
        for endpoint in list {
            let key = (
                endpoint.method.trim().to_ascii_uppercase(),
                endpoint.endpoint.trim().to_string(),
            );

            if let Some(existing) = merged.get_mut(&key) {
                if existing.domain.trim().is_empty() && !endpoint.domain.trim().is_empty() {
                    existing.domain = endpoint.domain;
                }
                if existing.description.trim().is_empty() && !endpoint.description.trim().is_empty()
                {
                    existing.description = endpoint.description;
                }
                continue;
            }

            merged.insert(
                key,
                ApiEndpointDetail {
                    domain: endpoint.domain.trim().to_string(),
                    method: endpoint.method.trim().to_ascii_uppercase(),
                    endpoint: endpoint.endpoint.trim().to_string(),
                    description: endpoint.description.trim().to_string(),
                },
            );
        }
    }

    sort_api_endpoints(merged.into_values().collect())
}

fn sort_api_endpoints(mut endpoints: Vec<ApiEndpointDetail>) -> Vec<ApiEndpointDetail> {
    endpoints.sort_by(|left, right| {
        left.domain
            .cmp(&right.domain)
            .then(left.endpoint.cmp(&right.endpoint))
            .then(left.method.cmp(&right.method))
    });
    endpoints
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
            source_path: "src/app/workspace/[workspaceId]/sessions/[sessionId]/page.tsx"
                .to_string(),
            via_path:
                "src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx"
                    .to_string(),
            confidence: SurfaceLinkConfidence::Medium,
        });

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].feature_id, "session-recovery");
        assert_eq!(
            links[0].route.as_deref(),
            Some("/workspace/:workspaceId/sessions/:sessionId")
        );
        assert_eq!(catalog.frontend_pages.len(), 1);
        assert_eq!(catalog.frontend_pages[0].description, "Session detail page");
        assert_eq!(catalog.api_endpoints.len(), 1);
        assert_eq!(catalog.api_endpoints[0].domain, "Sessions");
    }

    #[test]
    fn loads_surface_index_json_with_metadata_and_contract_apis() {
        let dir = tempdir().unwrap();
        let surface_index = dir.path().join("feature-tree.index.json");
        fs::write(
            &surface_index,
            r#"{
  "pages": [
    {
      "route": "/workspace/:workspaceId/spec",
      "title": "Workspace / Spec",
      "description": "Spec board"
    }
  ],
  "apis": [
    {
      "domain": "spec",
      "method": "GET",
      "path": "/api/spec/issues",
      "summary": "List issue specs"
    }
  ],
  "contractApis": [
    {
      "domain": "spec",
      "method": "GET",
      "path": "/api/spec/issues",
      "summary": "List local issue specs"
    }
  ],
  "metadata": {
    "capabilityGroups": [
      {
        "id": "governance-settings",
        "name": "Governance and Settings"
      }
    ],
    "features": [
      {
        "id": "harness-console",
        "name": "Harness Console",
        "group": "governance-settings",
        "pages": ["/workspace/:workspaceId/spec"],
        "apis": ["GET /api/spec/issues"],
        "sourceFiles": ["src/app/workspace/[workspaceId]/spec/page.tsx"],
        "relatedFeatures": ["workspace-overview"],
        "domainObjects": ["spec"]
      }
    ]
  }
}"#,
        )
        .unwrap();

        let catalog = FeatureTreeCatalog::from_surface_index_json(&surface_index).unwrap();

        assert_eq!(catalog.capability_groups.len(), 1);
        assert_eq!(catalog.features.len(), 1);
        assert_eq!(catalog.features[0].source_files.len(), 1);
        assert_eq!(
            catalog.features[0].related_features,
            vec!["workspace-overview"]
        );
        assert_eq!(catalog.features[0].domain_objects, vec!["spec"]);
        assert_eq!(catalog.frontend_pages[0].name, "Workspace / Spec");
        assert_eq!(
            catalog.api_endpoints[0].description,
            "List local issue specs"
        );
    }

    #[test]
    fn repo_root_loader_prefers_openapi_contract_and_index_metadata() {
        let dir = tempdir().unwrap();
        let repo_root = dir.path();
        let specs_dir = repo_root.join("docs/product-specs");
        fs::create_dir_all(&specs_dir).unwrap();
        fs::write(
            specs_dir.join("feature-tree.index.json"),
            r#"{
  "apis": [
    {
      "domain": "spec",
      "method": "GET",
      "path": "/api/spec/issues",
      "summary": ""
    }
  ],
  "metadata": {
    "features": [
      {
        "id": "harness-console",
        "name": "Harness Console",
        "apis": ["GET /api/spec/issues"]
      }
    ]
  }
}"#,
        )
        .unwrap();
        fs::write(
            repo_root.join("api-contract.yaml"),
            r#"openapi: 3.1.0
paths:
  /api/spec/issues:
    get:
      summary: List local issue specs
"#,
        )
        .unwrap();

        let catalog = FeatureTreeCatalog::from_repo_root(repo_root).unwrap();

        assert_eq!(catalog.features.len(), 1);
        assert_eq!(catalog.api_endpoints.len(), 1);
        assert_eq!(catalog.api_endpoints[0].domain, "spec");
        assert_eq!(catalog.api_endpoints[0].method, "GET");
        assert_eq!(catalog.api_endpoints[0].endpoint, "/api/spec/issues");
        assert_eq!(
            catalog.api_endpoints[0].description,
            "List local issue specs"
        );
    }

    #[test]
    fn repo_root_loader_falls_back_to_markdown_when_surface_index_is_invalid() {
        let dir = tempdir().unwrap();
        let repo_root = dir.path();
        let specs_dir = repo_root.join("docs/product-specs");
        fs::create_dir_all(&specs_dir).unwrap();
        fs::write(
            specs_dir.join("FEATURE_TREE.md"),
            r#"---
feature_metadata:
  features:
    - id: harness-console
      name: Harness Console
      apis:
        - GET /api/spec/issues
---

# Placeholder

## Frontend Pages

| Page | Route | Description |
|------|-------|-------------|
| Workspace / Spec | `/workspace/:workspaceId/spec` | Spec board |

## API Contract Endpoints

### Spec (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/spec/issues` | List local issue specs |
"#,
        )
        .unwrap();
        fs::write(specs_dir.join("feature-tree.index.json"), "{ invalid").unwrap();

        let catalog = FeatureTreeCatalog::from_repo_root(repo_root).unwrap();

        assert_eq!(catalog.features.len(), 1);
        assert_eq!(catalog.frontend_pages.len(), 1);
        assert_eq!(catalog.api_endpoints.len(), 1);
        assert_eq!(catalog.api_endpoints[0].endpoint, "/api/spec/issues");
    }

    #[test]
    fn repo_root_loader_returns_default_catalog_when_sources_are_missing() {
        let dir = tempdir().unwrap();
        let catalog = FeatureTreeCatalog::from_repo_root(dir.path()).unwrap();

        assert!(catalog.capability_groups.is_empty());
        assert!(catalog.features.is_empty());
        assert!(catalog.frontend_pages.is_empty());
        assert!(catalog.api_endpoints.is_empty());
    }

    #[test]
    fn parses_openapi_contract_with_path_item_metadata_and_non_api_routes() {
        let dir = tempdir().unwrap();
        let contract_path = dir.path().join("api-contract.yaml");
        fs::write(
            &contract_path,
            r#"openapi: 3.1.0
paths:
  /admin/dashboard:
    summary: Admin dashboard routes
    parameters: []
    get:
      summary: Render admin dashboard
  /v1/users:
    get:
      summary: List users
  /api/spec/issues:
    get:
      summary: List local issue specs
"#,
        )
        .unwrap();

        let apis = api_endpoints_from_openapi_contract(&contract_path).unwrap();

        assert_eq!(apis.len(), 3);
        assert!(apis.iter().any(|api| {
            api.domain == "admin"
                && api.endpoint == "/admin/dashboard"
                && api.description == "Render admin dashboard"
        }));
        assert!(apis.iter().any(|api| {
            api.domain == "v1" && api.endpoint == "/v1/users" && api.method == "GET"
        }));
        assert!(apis
            .iter()
            .any(|api| { api.domain == "spec" && api.endpoint == "/api/spec/issues" }));
    }
}
