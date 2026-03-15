use routa_scanner::{has_failures, run_scans, write_report, ScanConfig};
use std::path::PathBuf;

pub async fn run(project_dir: Option<&str>, output_dir: &str, strict: bool) -> Result<(), String> {
    let mut config = ScanConfig::default();
    if let Some(dir) = project_dir {
        config.project_dir = PathBuf::from(dir);
    }
    config.strict = strict;

    let report = run_scans(&config);
    let output_dir = PathBuf::from(output_dir);
    let (json_path, md_path) =
        write_report(&report, &output_dir).map_err(|err| format!("write report failed: {err}"))?;

    println!("Scan completed. JSON report: {}", json_path.display());
    println!("Markdown report: {}", md_path.display());

    if strict && has_failures(&report) {
        return Err("Scan finished with failures in strict mode".to_string());
    }

    Ok(())
}
