use serde_json::{json, Value};

pub(crate) fn parse_json_lines(raw: &str) -> Vec<Value> {
    raw.lines()
        .filter_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
        .collect()
}

pub(crate) fn to_phase_results(events: &[Value]) -> Vec<Value> {
    events
        .iter()
        .filter_map(|event| {
            let kind = event
                .get("event")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if kind != "phase.complete" && kind != "phase.skip" {
                return None;
            }
            let phase = event.get("phase").and_then(Value::as_str)?;
            let status = event.get("status").and_then(Value::as_str)?;
            Some(json!({
                "phase": phase,
                "status": status,
                "durationMs": event.get("durationMs").and_then(Value::as_u64).unwrap_or(0),
                "reason": event.get("reason").and_then(Value::as_str),
                "message": event.get("message").and_then(Value::as_str),
                "metrics": event.get("metrics").and_then(Value::as_array),
                "index": event.get("index").and_then(Value::as_u64),
                "total": event.get("total").and_then(Value::as_u64),
            }))
        })
        .collect()
}

pub(crate) fn to_metric_results(events: &[Value]) -> Vec<Value> {
    let mut results = Vec::new();
    for event in events {
        match event
            .get("event")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "metric.complete" => {
                if let Some(name) = event.get("name").and_then(Value::as_str) {
                    results.push(json!({
                        "name": name,
                        "status": if event.get("passed").and_then(Value::as_bool).unwrap_or(false) { "passed" } else { "failed" },
                        "durationMs": event.get("durationMs").and_then(Value::as_u64),
                        "exitCode": event.get("exitCode").and_then(Value::as_i64),
                        "command": event.get("command").and_then(Value::as_str),
                        "sourceFile": event.get("sourceFile").and_then(Value::as_str),
                        "outputTail": event.get("outputTail").and_then(Value::as_str),
                    }));
                }
            }
            "metric.skip" => {
                if let Some(metrics) = event.get("metrics").and_then(Value::as_array) {
                    for metric in metrics.iter().filter_map(Value::as_str) {
                        results.push(json!({
                            "name": metric,
                            "status": "skipped",
                        }));
                    }
                }
            }
            _ => {}
        }
    }
    results
}
