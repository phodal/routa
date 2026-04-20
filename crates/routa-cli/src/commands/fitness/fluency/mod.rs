mod baseline;
mod detector;
mod engine;
mod evidence_pack;
mod model;
mod report;
mod snapshot;
mod support;
mod types;

pub use engine::evaluate_harness_fluency;
pub use report::format_text_report;
pub use types::{
    CriterionStatus, EvaluateOptions, FluencyMode, HarnessFluencyReport, LevelChange, ReportFraming,
};

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_projection;
