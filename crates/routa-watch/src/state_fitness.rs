use super::{FitnessViewMode, RuntimeState};

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
            "mode={};branch={};ahead={};files={}",
            self.fitness_view_mode.as_str(),
            self.branch,
            self.ahead_count.unwrap_or(0),
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
