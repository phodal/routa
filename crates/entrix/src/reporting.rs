//! Shared serialization helpers for fitness reports.

use serde_json::{json, Value};

use crate::model::FitnessReport;

/// Serialize a fitness report into a stable JSON-friendly structure.
pub fn report_to_dict(report: &FitnessReport) -> Value {
    json!({
        "final_score": report.final_score,
        "hard_gate_blocked": report.hard_gate_blocked,
        "score_blocked": report.score_blocked,
        "runtime_timed_out": report.runtime_timed_out,
        "dimensions": report.dimensions.iter().map(|ds| {
            json!({
                "name": ds.dimension,
                "weight": ds.weight,
                "score": ds.score,
                "passed": ds.passed,
                "total": ds.total,
                "hard_gate_failures": ds.hard_gate_failures,
                "results": ds.results.iter().map(|result| {
                    json!({
                        "name": result.metric_name,
                        "passed": result.passed,
                        "state": result.state.as_str(),
                        "tier": result.tier.as_str(),
                        "hard_gate": result.hard_gate,
                        "duration_ms": result.duration_ms,
                        "output": result.output,
                    })
                }).collect::<Vec<_>>(),
            })
        }).collect::<Vec<_>>(),
    })
}

/// Write JSON payload to a file path or stdout marker.
pub fn write_report_output(path: Option<&str>, payload: &Value) -> std::io::Result<()> {
    let path = match path {
        Some(p) => p,
        None => return Ok(()),
    };

    let serialized = serde_json::to_string_pretty(payload).map_err(std::io::Error::other)?;

    if path == "-" {
        println!("{serialized}");
        return Ok(());
    }

    std::fs::write(path, format!("{serialized}\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{DimensionScore, FitnessReport, MetricResult, Tier};

    #[test]
    fn test_report_to_dict_structure() {
        let result = MetricResult::new("lint", true, "ok", Tier::Fast);
        let ds = DimensionScore {
            dimension: "quality".to_string(),
            weight: 24,
            passed: 1,
            total: 1,
            score: 100.0,
            hard_gate_failures: Vec::new(),
            results: vec![result],
        };
        let report = FitnessReport {
            dimensions: vec![ds],
            final_score: 100.0,
            hard_gate_blocked: false,
            score_blocked: false,
            runtime_timed_out: false,
        };

        let dict = report_to_dict(&report);
        assert_eq!(dict["final_score"], 100.0);
        assert_eq!(dict["hard_gate_blocked"], false);
        assert_eq!(dict["score_blocked"], false);
        assert_eq!(dict["runtime_timed_out"], false);
        assert_eq!(dict["dimensions"][0]["name"], "quality");
        assert_eq!(dict["dimensions"][0]["weight"], 24);
        assert_eq!(dict["dimensions"][0]["results"][0]["name"], "lint");
        assert_eq!(dict["dimensions"][0]["results"][0]["state"], "pass");
    }

    #[test]
    fn test_report_to_dict_empty_report() {
        let report = FitnessReport::default();
        let dict = report_to_dict(&report);
        assert_eq!(dict["final_score"], 0.0);
        assert!(dict["dimensions"].as_array().unwrap().is_empty());
    }
}
