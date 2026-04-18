//! `routa feature-tree` command group.
//!
//! Wraps the TypeScript feature-tree generator script as a first-class
//! CLI command instead of a hidden script invocation.

use std::process::Command;

/// Run `feature-tree generate` — scan the repo and produce
/// `FEATURE_TREE.md` + `feature-tree.index.json`.
pub fn generate(
    repo_path: Option<&str>,
    dry_run: bool,
    framework: Option<&str>,
) -> Result<(), String> {
    let repo_root = repo_path
        .map(|p| std::path::PathBuf::from(p))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| ".".into()));

    let script = repo_root.join("scripts/docs/feature-tree-generator.ts");
    if !script.exists() {
        return Err(format!(
            "Feature tree generator script not found at {}",
            script.display()
        ));
    }

    let mut args: Vec<&str> = vec!["--import", "tsx"];
    let script_str = script.to_string_lossy();
    args.push(&script_str);

    if !dry_run {
        args.push("--save");
    } else {
        args.push("--json");
    }

    if let Some(fw) = framework {
        // For framework-specific generation, use the framework generator
        let fw_script = repo_root.join("scripts/docs/framework-feature-tree-generator.ts");
        if fw_script.exists() {
            let fw_script_str = fw_script.to_string_lossy().to_string();
            let mut fw_args = vec!["--import", "tsx", &fw_script_str];
            fw_args.push("--repo-root");
            let repo_root_str = repo_root.to_string_lossy().to_string();
            fw_args.push(&repo_root_str);
            if !dry_run {
                fw_args.push("--save");
            }
            eprintln!("🔍 Running framework-specific generator for: {fw}");
            let status = Command::new("node")
                .args(&fw_args)
                .current_dir(&repo_root)
                .status()
                .map_err(|e| format!("Failed to run framework generator: {e}"))?;
            if !status.success() {
                return Err(format!(
                    "Framework generator exited with status: {}",
                    status.code().unwrap_or(-1)
                ));
            }
            return Ok(());
        }
    }

    eprintln!("🌳 Generating feature tree…");
    let status = Command::new("node")
        .args(&args)
        .current_dir(&repo_root)
        .status()
        .map_err(|e| format!("Failed to run feature tree generator: {e}"))?;

    if !status.success() {
        return Err(format!(
            "Feature tree generator exited with status: {}",
            status.code().unwrap_or(-1)
        ));
    }

    if !dry_run {
        eprintln!("✅ Feature tree generated successfully.");
    }

    Ok(())
}

/// Run `feature-tree inspect` — read and display the current feature tree index.
pub fn inspect(repo_path: Option<&str>) -> Result<(), String> {
    let repo_root = repo_path
        .map(|p| std::path::PathBuf::from(p))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| ".".into()));

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
