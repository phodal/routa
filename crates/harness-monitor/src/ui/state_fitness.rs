use super::{FitnessViewMode, RuntimeState};
use std::path::Path;

impl FitnessViewMode {
    pub fn as_str(self) -> &'static str {
        match self {
            FitnessViewMode::Fast => "fast",
            FitnessViewMode::Full => "full",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            FitnessViewMode::Fast => "Entrix Fast",
            FitnessViewMode::Full => "Entrix Full",
        }
    }
}

impl RuntimeState {
    pub fn fitness_cache_key(&self) -> String {
        let mut file_markers = self
            .files
            .values()
            .filter(|file| file.dirty || file.conflicted)
            .map(|file| {
                format!(
                    "{}:{}:{}",
                    file.rel_path, file.state_code, file.last_modified_at_ms
                )
            })
            .collect::<Vec<_>>();
        file_markers.sort();
        format!(
            "mode={};branch={};ahead={};coverage={};files={}",
            self.fitness_view_mode.as_str(),
            self.branch,
            self.ahead_count.unwrap_or(0),
            coverage_artifact_marker(&self.repo_root),
            file_markers.join("|")
        )
    }

    pub fn toggle_fitness_view_mode(&mut self) {
        self.fitness_view_mode = match self.fitness_view_mode {
            FitnessViewMode::Fast => FitnessViewMode::Full,
            FitnessViewMode::Full => FitnessViewMode::Fast,
        };
        self.fitness_scroll = 0;
    }
}

fn coverage_artifact_marker(repo_root: &str) -> String {
    let artifact_path = Path::new(repo_root)
        .join("target")
        .join("coverage")
        .join("fitness-summary.json");
    match std::fs::metadata(&artifact_path) {
        Ok(metadata) => {
            let modified_ms = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis())
                .unwrap_or(0);
            format!("{modified_ms}:{}", metadata.len())
        }
        Err(_) => "missing".to_string(),
    }
}
