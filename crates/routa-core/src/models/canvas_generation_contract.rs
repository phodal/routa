use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasGenerationPromptContract {
    pub artifact_description: String,
    pub require_source_only: bool,
    pub allow_markdown_code_fences: bool,
    pub allow_prose: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasGenerationOutputContract {
    pub default_export_forms: Vec<String>,
    pub json_source_keys: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasGenerationImportContract {
    pub allowed_modules: Vec<String>,
    pub normalized_prefixes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasGenerationRuntimeContract {
    pub forbidden_globals: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasGenerationLayoutContract {
    pub forbidden_shell_chrome: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasGenerationStyleContract {
    pub principles: Vec<String>,
    pub forbidden_patterns: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasGenerationStorageContract {
    pub project_canvas_root: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasGenerationContract {
    pub schema_version: u32,
    pub prompt: CanvasGenerationPromptContract,
    pub output: CanvasGenerationOutputContract,
    pub imports: CanvasGenerationImportContract,
    pub runtime: CanvasGenerationRuntimeContract,
    pub layout: CanvasGenerationLayoutContract,
    pub style: CanvasGenerationStyleContract,
    pub storage: CanvasGenerationStorageContract,
}

const CANVAS_GENERATION_CONTRACT_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/canvas/canvas-generation-contract.json"
));

static CANVAS_GENERATION_CONTRACT: OnceLock<CanvasGenerationContract> = OnceLock::new();

pub fn get_canvas_generation_contract() -> &'static CanvasGenerationContract {
    CANVAS_GENERATION_CONTRACT.get_or_init(|| {
        serde_json::from_str(CANVAS_GENERATION_CONTRACT_JSON)
            .expect("canvas generation contract must parse")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_canvas_generation_contract() {
        let contract = get_canvas_generation_contract();

        assert_eq!(contract.schema_version, 1);
        assert!(contract
            .imports
            .allowed_modules
            .contains(&"routa/canvas".to_string()));
        assert!(contract
            .imports
            .allowed_modules
            .contains(&"@canvas-sdk".to_string()));
        assert_eq!(
            contract.storage.project_canvas_root,
            "~/.routa/projects/{folderSlug}/canvases"
        );
    }
}
