//! `routa feature-tree` command group.
//!
//! Uses the shared feature-tree script as an execution backend while exposing
//! a stable Rust CLI surface for preflight, generate, commit, and inspect.

use std::path::PathBuf;

use routa_server::feature_tree::{
    ensure_feature_tree_success, run_feature_tree_script, workspace_root,
};

fn repo_root(repo_path: Option<&str>) -> Result<PathBuf, String> {
    let resolved = repo_path
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| ".".into()));

    if !resolved.exists() {
        return Err(format!(
            "Repository path does not exist: {}",
            resolved.display()
        ));
    }

    resolved
        .canonicalize()
        .map_err(|e| format!("Failed to resolve repository path: {e}"))
}

fn print_stdout(output: &std::process::Output) {
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.trim().is_empty() {
        print!("{stdout}");
    }
}

pub fn preflight(repo_path: Option<&str>, json_output: bool) -> Result<(), String> {
    let repo_root = repo_root(repo_path)?;
    let args = vec![
        "--mode".to_string(),
        "preflight".to_string(),
        "--repo-root".to_string(),
        repo_root.to_string_lossy().to_string(),
    ];

    let output = run_feature_tree_script(&args, &workspace_root())?;
    ensure_feature_tree_success(&output, "Feature tree preflight failed")?;

    if json_output {
        print_stdout(&output);
        return Ok(());
    }

    let parsed: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse preflight JSON: {e}"))?;
    let selected = parsed["selectedScanRoot"].as_str().unwrap_or("unknown");
    let frameworks = parsed["frameworksDetected"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_else(|| "generic".to_string());

    println!("🔎 Feature Tree Preflight");
    println!("  Repo root:        {}", repo_root.display());
    println!("  Selected root:    {selected}");
    println!("  Frameworks:       {frameworks}");
    Ok(())
}

pub fn generate(
    repo_path: Option<&str>,
    scan_root: Option<&str>,
    dry_run: bool,
    json_output: bool,
) -> Result<(), String> {
    let repo_root = repo_root(repo_path)?;
    let mut args = vec![
        "--mode".to_string(),
        "generate".to_string(),
        "--repo-root".to_string(),
        repo_root.to_string_lossy().to_string(),
    ];

    if let Some(scan_root) = scan_root {
        args.push("--scan-root".to_string());
        args.push(scan_root.to_string());
    }

    args.push(if dry_run {
        "--dry-run".to_string()
    } else {
        "--write".to_string()
    });

    if !json_output {
        eprintln!("🌳 Generating feature tree…");
    }

    let output = run_feature_tree_script(&args, &workspace_root())?;
    ensure_feature_tree_success(&output, "Feature tree generation failed")?;

    if json_output || dry_run {
        print_stdout(&output);
    } else {
        eprintln!("✅ Feature tree generated successfully.");
    }

    Ok(())
}

pub fn commit(
    repo_path: Option<&str>,
    scan_root: Option<&str>,
    metadata_file: Option<&str>,
    json_output: bool,
) -> Result<(), String> {
    let repo_root = repo_root(repo_path)?;
    let mut args = vec![
        "--mode".to_string(),
        "commit".to_string(),
        "--repo-root".to_string(),
        repo_root.to_string_lossy().to_string(),
    ];

    if let Some(scan_root) = scan_root {
        args.push("--scan-root".to_string());
        args.push(scan_root.to_string());
    }

    if let Some(metadata_file) = metadata_file {
        let metadata_path = PathBuf::from(metadata_file);
        if !metadata_path.exists() {
            return Err(format!(
                "Metadata file does not exist: {}",
                metadata_path.display()
            ));
        }
        args.push("--metadata-file".to_string());
        args.push(metadata_path.to_string_lossy().to_string());
    }

    let output = run_feature_tree_script(&args, &workspace_root())?;
    ensure_feature_tree_success(&output, "Feature tree commit failed")?;

    if json_output {
        print_stdout(&output);
    } else {
        eprintln!("✅ Feature tree committed successfully.");
    }

    Ok(())
}

/// Run `feature-tree inspect` — read and display the current feature tree index.
pub fn inspect(repo_path: Option<&str>) -> Result<(), String> {
    let repo_root = repo_root(repo_path)?;

    let json_path = repo_root.join("docs/product-specs/feature-tree.index.json");
    let md_path = repo_root.join("docs/product-specs/FEATURE_TREE.md");

    if json_path.exists() {
        let content = std::fs::read_to_string(&json_path)
            .map_err(|e| format!("Failed to read {}: {e}", json_path.display()))?;

        let parsed: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| format!("Failed to parse JSON: {e}"))?;

        let pages = parsed["pages"].as_array().map(|a| a.len()).unwrap_or(0);
        let contract_apis = parsed["contractApis"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(0);
        let nextjs_apis = parsed["nextjsApis"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(0);
        let rust_apis = parsed["rustApis"].as_array().map(|a| a.len()).unwrap_or(0);
        let generated_at = parsed["generatedAt"].as_str().unwrap_or("unknown");
        let features = parsed["metadata"]["features"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(0);

        println!("📊 Feature Tree Index");
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        println!("  Generated at:      {generated_at}");
        println!("  Pages:             {pages}");
        println!("  Contract APIs:     {contract_apis}");
        println!("  Next.js APIs:      {nextjs_apis}");
        println!("  Rust APIs:         {rust_apis}");
        println!("  Features:          {features}");
        println!("  Index file:        {}", json_path.display());
        println!(
            "  Markdown file:     {} ({})",
            md_path.display(),
            if md_path.exists() {
                "exists"
            } else {
                "missing"
            }
        );
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    } else if md_path.exists() {
        println!("📄 FEATURE_TREE.md exists at {}", md_path.display());
        println!("   JSON index not yet generated. Run `routa feature-tree generate` first.");
    } else {
        println!("❌ No feature tree found.");
        println!("   Run `routa feature-tree generate` to create one.");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::workspace_root;
    use routa_server::feature_tree::feature_tree_script_path;

    #[test]
    fn resolves_workspace_root_to_repo_root() {
        let root = workspace_root();
        assert!(root.join("Cargo.toml").exists());
        assert!(root.join("scripts/docs/feature-tree-generator.ts").exists());
    }

    #[test]
    fn resolves_feature_tree_script_from_workspace_root() {
        let script = feature_tree_script_path().expect("script path should resolve");
        assert!(script.ends_with("scripts/docs/feature-tree-generator.ts"));
    }
}
