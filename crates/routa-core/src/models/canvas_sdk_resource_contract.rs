use serde::Serialize;

pub const CANVAS_SDK_MANIFEST_RESOURCE_URI: &str = "resource://routa/canvas-sdk/manifest";

const CANVAS_SDK_MANIFEST_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/canvas/canvas-sdk-manifest.json"
));
const CANVAS_SDK_CHARTS_DEF: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/canvas/sdk/charts.d.ts"
));
const CANVAS_SDK_CONTAINERS_DEF: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/canvas/sdk/containers.d.ts"
));
const CANVAS_SDK_CONTROLS_DEF: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/canvas/sdk/controls.d.ts"
));
const CANVAS_SDK_DATA_DISPLAY_DEF: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/canvas/sdk/data-display.d.ts"
));
const CANVAS_SDK_HOOKS_DEF: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/canvas/sdk/hooks.d.ts"
));
const CANVAS_SDK_INDEX_DEF: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/canvas/sdk/index.d.ts"
));
const CANVAS_SDK_PRIMITIVES_DEF: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/canvas/sdk/primitives.d.ts"
));
const CANVAS_SDK_THEME_CONTEXT_DEF: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/canvas/sdk/theme-context.d.ts"
));
const CANVAS_SDK_TOKENS_DEF: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/canvas/sdk/tokens.d.ts"
));

const CANVAS_SDK_DEFINITION_FILES: &[(&str, &str)] = &[
    ("primitives", CANVAS_SDK_PRIMITIVES_DEF),
    ("hooks", CANVAS_SDK_HOOKS_DEF),
    ("data-display", CANVAS_SDK_DATA_DISPLAY_DEF),
    ("containers", CANVAS_SDK_CONTAINERS_DEF),
    ("controls", CANVAS_SDK_CONTROLS_DEF),
    ("charts", CANVAS_SDK_CHARTS_DEF),
    ("index", CANVAS_SDK_INDEX_DEF),
    ("theme-context", CANVAS_SDK_THEME_CONTEXT_DEF),
    ("tokens", CANVAS_SDK_TOKENS_DEF),
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasSdkResolvedResource {
    pub uri: String,
    pub mime_type: String,
    pub text: String,
}

pub fn get_canvas_sdk_definition_resource_uri(name: &str) -> String {
    format!("resource://routa/canvas-sdk/defs/{name}")
}

pub fn get_canvas_sdk_definition_resource_uris() -> Vec<String> {
    CANVAS_SDK_DEFINITION_FILES
        .iter()
        .map(|(name, _)| get_canvas_sdk_definition_resource_uri(name))
        .collect()
}

pub fn read_canvas_sdk_resource(uri: &str) -> Option<CanvasSdkResolvedResource> {
    if uri == CANVAS_SDK_MANIFEST_RESOURCE_URI {
        return Some(CanvasSdkResolvedResource {
            uri: uri.to_string(),
            mime_type: "application/json".to_string(),
            text: format!("{CANVAS_SDK_MANIFEST_JSON}\n"),
        });
    }

    CANVAS_SDK_DEFINITION_FILES
        .iter()
        .find(|(name, _)| get_canvas_sdk_definition_resource_uri(name) == uri)
        .map(|(_, source)| CanvasSdkResolvedResource {
            uri: uri.to_string(),
            mime_type: "text/plain".to_string(),
            text: (*source).to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_canvas_sdk_manifest_resource() {
        let resource = read_canvas_sdk_resource(CANVAS_SDK_MANIFEST_RESOURCE_URI)
            .expect("expected manifest resource");

        assert_eq!(resource.mime_type, "application/json");
        assert!(resource
            .text
            .contains("\"moduleSpecifier\": \"routa/canvas\""));
    }

    #[test]
    fn reads_canvas_sdk_definition_resource() {
        let resource = read_canvas_sdk_resource("resource://routa/canvas-sdk/defs/primitives")
            .expect("expected primitives resource");

        assert_eq!(resource.mime_type, "text/plain");
        assert!(resource.text.contains("export declare function Stack"));
    }
}
