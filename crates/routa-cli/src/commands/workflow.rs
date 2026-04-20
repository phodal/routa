//! `routa workflow` — Run YAML-defined agent workflows.

use routa_core::state::AppState;
use routa_core::workflow::executor::WorkflowExecutor;
use routa_core::workflow::schema::WorkflowDefinition;

/// Run a workflow from a YAML file.
pub async fn run(
    _state: &AppState,
    workflow_file: &str,
    verbose: bool,
    specialist_dir: Option<&str>,
    trigger_payload: Option<&str>,
) -> Result<(), String> {
    // Load .env / .env.local if present (for API keys, etc.)
    load_dotenv();

    // Load the workflow definition
    let workflow = WorkflowDefinition::from_file(workflow_file)?;

    println!("📄 Loaded workflow: {} ({})", workflow.name, workflow_file);
    println!(
        "   {} step(s), trigger: {}",
        workflow.steps.len(),
        workflow.trigger.trigger_type
    );
    println!();

    // Create the executor
    let mut executor = if let Some(dir) = specialist_dir {
        WorkflowExecutor::with_specialist_dir(dir)?
    } else {
        WorkflowExecutor::new()
    };

    executor.set_verbose(verbose);

    if let Some(payload) = trigger_payload {
        executor.set_trigger_payload(payload.to_string());
    }

    // Execute the workflow
    let result = executor.execute(&workflow).await?;

    // Exit with appropriate code
    if result.success {
        println!("\n🎉 Workflow completed successfully!");
        Ok(())
    } else {
        let failed_steps: Vec<_> = result
            .steps
            .iter()
            .filter(|s| !s.success)
            .map(|s| s.step_name.clone())
            .collect();
        Err(format!(
            "Workflow failed. Failed steps: {}",
            failed_steps.join(", ")
        ))
    }
}

/// List available specialist definitions.
pub async fn list_specialists(specialist_dir: Option<&str>) -> Result<(), String> {
    use routa_core::workflow::specialist::SpecialistLoader;

    let mut loader = SpecialistLoader::new();

    if let Some(dir) = specialist_dir {
        let count = loader.load_dir(dir)?;
        println!("Loaded {count} specialist(s) from '{dir}'");
    } else {
        let count = loader.load_default_dirs();
        println!("Loaded {count} specialist(s) from default directories");
    }

    // Also show builtins
    let builtins = SpecialistLoader::builtin_specialists();

    println!();
    println!("┌──────────────────┬────────────────────┬──────────┬──────────┐");
    println!("│ ID               │ Name               │ Role     │ Source   │");
    println!("├──────────────────┼────────────────────┼──────────┼──────────┤");

    for spec in loader.all().values() {
        println!(
            "│ {:<16} │ {:<18} │ {:<8} │ {:<8} │",
            truncate(&spec.id, 16),
            truncate(&spec.name, 18),
            truncate(&spec.role, 8),
            "file"
        );
    }

    for spec in &builtins {
        if loader.get(&spec.id).is_none() {
            println!(
                "│ {:<16} │ {:<18} │ {:<8} │ {:<8} │",
                truncate(&spec.id, 16),
                truncate(&spec.name, 18),
                truncate(&spec.role, 8),
                "builtin"
            );
        }
    }

    println!("└──────────────────┴────────────────────┴──────────┴──────────┘");
    Ok(())
}

/// Validate a workflow YAML file without executing it.
pub async fn validate(workflow_file: &str) -> Result<(), String> {
    let workflow = WorkflowDefinition::from_file(workflow_file)?;

    println!("✅ Workflow '{}' is valid", workflow.name);
    println!("   Version: {}", workflow.version);
    println!("   Trigger: {}", workflow.trigger.trigger_type);
    println!("   Steps: {}", workflow.steps.len());

    for (i, step) in workflow.steps.iter().enumerate() {
        println!(
            "   {}. {} (specialist: {}, adapter: {})",
            i + 1,
            step.name,
            step.specialist,
            step.adapter
        );
    }

    Ok(())
}

/// Load .env and .env.local files for environment variables.
fn load_dotenv() {
    // Try .env.local first (higher priority), then .env
    for filename in &[".env.local", ".env"] {
        let path = std::path::Path::new(filename);
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(path) {
                for line in content.lines() {
                    let line = line.trim();
                    // Skip comments and empty lines
                    if line.is_empty() || line.starts_with('#') {
                        continue;
                    }
                    // Parse KEY=VALUE
                    if let Some(eq_idx) = line.find('=') {
                        let key = line[..eq_idx].trim();
                        let mut value = line[eq_idx + 1..].trim().to_string();
                        // Strip surrounding quotes
                        if (value.starts_with('"') && value.ends_with('"'))
                            || (value.starts_with('\'') && value.ends_with('\''))
                        {
                            value = value[1..value.len() - 1].to_string();
                        }
                        // Only set if not already present (existing env vars take priority)
                        if std::env::var(key).is_err() {
                            std::env::set_var(key, &value);
                        }
                    }
                }
                tracing::info!("[Workflow] Loaded environment from '{}'", filename);
            }
        }
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max.saturating_sub(1)])
    }
}
