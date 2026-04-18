use serde::{Deserialize, Serialize};

pub const FEATURE_TREE_SPEC_MANIFEST_RESOURCE_URI: &str =
    "resource://routa/specialists/feature-tree/manifest";

const FEATURE_TREE_SPEC_MANIFEST_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/specialists/specs/feature-tree/manifest.json"
));
const FEATURE_TREE_SPEC_NEXTJS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/specialists/specs/feature-tree/nextjs.spec.md"
));
const FEATURE_TREE_SPEC_AXUM: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/specialists/specs/feature-tree/axum.spec.md"
));
const FEATURE_TREE_SPEC_EXPRESS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/specialists/specs/feature-tree/express.spec.md"
));
const FEATURE_TREE_SPEC_SPRING_BOOT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/specialists/specs/feature-tree/spring-boot.spec.md"
));
const FEATURE_TREE_SPEC_GIN: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/specialists/specs/feature-tree/gin.spec.md"
));
const FEATURE_TREE_SPEC_EGGJS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/specialists/specs/feature-tree/eggjs.spec.md"
));

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeatureTreeFrameworkSpecEntry {
    pub id: String,
    pub title: String,
    pub resource_uri: String,
    pub file_name: String,
    pub description: String,
    pub signals: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeatureTreeSpecManifest {
    pub schema_version: usize,
    pub id: String,
    pub description: String,
    pub base_rules_in_prompt: bool,
    pub available_spec_ids: Vec<String>,
    pub selection_rules: Vec<String>,
    pub specs: Vec<FeatureTreeFrameworkSpecEntry>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeatureTreeSpecResolvedResource {
    pub uri: String,
    pub mime_type: String,
    pub text: String,
}

const FEATURE_TREE_SPEC_FILES: &[(&str, &str)] = &[
    ("nextjs", FEATURE_TREE_SPEC_NEXTJS),
    ("axum", FEATURE_TREE_SPEC_AXUM),
    ("express", FEATURE_TREE_SPEC_EXPRESS),
    ("spring-boot", FEATURE_TREE_SPEC_SPRING_BOOT),
    ("gin", FEATURE_TREE_SPEC_GIN),
    ("eggjs", FEATURE_TREE_SPEC_EGGJS),
];

pub fn get_feature_tree_spec_manifest() -> FeatureTreeSpecManifest {
    serde_json::from_str(FEATURE_TREE_SPEC_MANIFEST_JSON)
        .expect("feature-tree specialist spec manifest should parse")
}

pub fn get_feature_tree_spec_resource_uris() -> Vec<String> {
    get_feature_tree_spec_manifest()
        .specs
        .into_iter()
        .map(|spec| spec.resource_uri)
        .collect()
}

pub fn read_feature_tree_spec_resource(uri: &str) -> Option<FeatureTreeSpecResolvedResource> {
    if uri == FEATURE_TREE_SPEC_MANIFEST_RESOURCE_URI {
        return Some(FeatureTreeSpecResolvedResource {
            uri: uri.to_string(),
            mime_type: "application/json".to_string(),
            text: format!("{FEATURE_TREE_SPEC_MANIFEST_JSON}\n"),
        });
    }

    let manifest = get_feature_tree_spec_manifest();
    let spec = manifest
        .specs
        .iter()
        .find(|entry| entry.resource_uri == uri)?;
    FEATURE_TREE_SPEC_FILES
        .iter()
        .find(|(id, _)| *id == spec.id)
        .map(|(_, source)| FeatureTreeSpecResolvedResource {
            uri: uri.to_string(),
            mime_type: "text/markdown".to_string(),
            text: (*source).to_string(),
        })
}

pub fn build_feature_tree_spec_prompt_section() -> String {
    let manifest = get_feature_tree_spec_manifest();
    let example_uris = manifest
        .specs
        .iter()
        .map(|spec| format!("- {}: {}", spec.id, spec.resource_uri))
        .collect::<Vec<_>>()
        .join("\n");

    [
        "Framework overlay spec access:".to_string(),
        "- Base feature-grouping rules are already built into this system prompt.".to_string(),
        format!(
            "- Read the manifest first: `{FEATURE_TREE_SPEC_MANIFEST_RESOURCE_URI}`."
        ),
        "- If your provider supports MCP resources/read directly, use that.".to_string(),
        "- Otherwise call MCP tool `read_specialist_spec_resource` with the same URI.".to_string(),
        format!(
            "- Current bundled framework spec ids: {}.",
            manifest.available_spec_ids.join(", ")
        ),
        "- After reading the manifest, load only the framework specs supported by repository evidence.".to_string(),
        "- A repository may need multiple framework specs when it has multiple runtime surfaces, such as Next.js plus Axum.".to_string(),
        "- If no matching framework spec exists, continue with the built-in path model and repository evidence only.".to_string(),
        "- Available framework spec resources:".to_string(),
        example_uris,
    ]
    .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_feature_tree_spec_manifest_resource() {
        let resource = read_feature_tree_spec_resource(FEATURE_TREE_SPEC_MANIFEST_RESOURCE_URI)
            .expect("expected manifest resource");

        assert_eq!(resource.mime_type, "application/json");
        assert!(resource
            .text
            .contains("\"id\": \"feature-tree-framework-specs\""));
        assert!(resource.text.contains(
            "\"resourceUri\": \"resource://routa/specialists/feature-tree/specs/nextjs\""
        ));
    }

    #[test]
    fn reads_feature_tree_spec_resource() {
        let resource =
            read_feature_tree_spec_resource("resource://routa/specialists/feature-tree/specs/axum")
                .expect("expected axum resource");

        assert_eq!(resource.mime_type, "text/markdown");
        assert!(resource.text.contains("# Axum Feature Surface Overlay"));
        assert!(resource.text.contains("Router::new()"));
    }

    #[test]
    fn builds_feature_tree_prompt_section_with_manifest_uri() {
        let prompt = build_feature_tree_spec_prompt_section();

        assert!(prompt.contains("read_specialist_spec_resource"));
        assert!(prompt.contains(FEATURE_TREE_SPEC_MANIFEST_RESOURCE_URI));
        assert!(prompt.contains("nextjs"));
        assert!(prompt.contains("axum"));
    }
}
