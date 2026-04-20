//! Stream event parsing helpers for `routa review`.

pub(crate) fn update_contains_turn_complete(history: &[serde_json::Value]) -> bool {
    history.iter().any(|entry| {
        entry
            .get("params")
            .and_then(|params| params.get("update"))
            .and_then(|update| update.get("sessionUpdate"))
            .and_then(|value| value.as_str())
            == Some("turn_complete")
    })
}

pub(crate) fn extract_agent_output_from_history(history: &[serde_json::Value]) -> String {
    let mut output = String::new();
    for entry in history {
        let Some(update) = entry
            .get("params")
            .and_then(|params| params.get("update"))
            .and_then(|update| update.as_object())
        else {
            continue;
        };

        let session_update = update
            .get("sessionUpdate")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if matches!(
            session_update,
            "agent_message" | "agent_message_chunk" | "agent_chunk"
        ) {
            if let Some(text) = extract_update_text(update) {
                output.push_str(&text);
            }
        }
    }
    output
}

pub(crate) fn extract_update_text(
    update: &serde_json::Map<String, serde_json::Value>,
) -> Option<String> {
    if let Some(text) = update
        .get("data")
        .and_then(|data| data.as_str())
        .and_then(extract_text_from_process_output_line)
    {
        return Some(text);
    }

    if let Some(delta) = update.get("delta").and_then(|delta| delta.as_str()) {
        return Some(delta.to_string());
    }

    if let Some(text) = update
        .get("content")
        .and_then(|content| content.get("text"))
        .and_then(|text| text.as_str())
    {
        return Some(text.to_string());
    }

    if let Some(text) = update
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(|content| content.get("text"))
        .and_then(|text| text.as_str())
    {
        return Some(text.to_string());
    }

    if let Some(text) = update.get("content").and_then(|content| content.as_str()) {
        return Some(text.to_string());
    }

    if let Some(text) = update.get("text").and_then(|text| text.as_str()) {
        return Some(text.to_string());
    }

    if let Some(text) = update.get("message").and_then(|text| text.as_str()) {
        return Some(text.to_string());
    }

    if let Some(text) = update
        .get("message")
        .and_then(|message| message.get("text"))
        .and_then(|text| text.as_str())
    {
        return Some(text.to_string());
    }

    if let Some(content) = update
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_array())
    {
        let mut output = String::new();
        for part in content {
            if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                output.push_str(text);
                continue;
            }
            if let Some(text) = part.get("content").and_then(|t| t.as_str()) {
                output.push_str(text);
            }
        }
        if !output.is_empty() {
            return Some(output);
        }
    }

    let content = update.get("content")?.as_array()?;
    let mut output = String::new();
    for part in content {
        if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
            output.push_str(text);
            continue;
        }
        if let Some(text) = part.get("content").and_then(|t| t.as_str()) {
            output.push_str(text);
        }
    }
    if output.is_empty() {
        None
    } else {
        Some(output)
    }
}

pub(crate) fn extract_text_from_prompt_result(value: &serde_json::Value) -> Option<String> {
    let mut parts = Vec::new();
    collect_prompt_text(value, &mut parts);
    let combined = parts.join("");
    if combined.trim().is_empty() {
        None
    } else {
        Some(combined)
    }
}

fn collect_prompt_text(value: &serde_json::Value, parts: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(|v| v.as_str()) {
                parts.push(text.to_string());
            }
            if let Some(delta) = map.get("delta").and_then(|v| v.as_str()) {
                parts.push(delta.to_string());
            }
            for nested in map.values() {
                collect_prompt_text(nested, parts);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_prompt_text(item, parts);
            }
        }
        _ => {}
    }
}

pub(crate) fn extract_agent_output_from_process_output(history: &[serde_json::Value]) -> String {
    let mut delta_output = String::new();

    for entry in history {
        let Some(update) = entry
            .get("params")
            .and_then(|params| params.get("update"))
            .and_then(|value| value.as_object())
        else {
            continue;
        };

        let session_update = update
            .get("sessionUpdate")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if session_update != "process_output" {
            continue;
        }

        let Some(data) = update.get("data").and_then(|value| value.as_str()) else {
            continue;
        };

        if let Some(parsed) = extract_text_from_process_output_line(data) {
            if data.contains("Agent message (non-delta) received: \"") {
                return parsed;
            }
            delta_output.push_str(&parsed);
        }
    }

    delta_output
}

fn decode_log_escaped_text(raw: &str) -> String {
    let quoted = format!("\"{raw}\"");
    serde_json::from_str::<String>(&quoted).unwrap_or_else(|_| {
        raw.replace("\\n", "\n")
            .replace("\\r", "\r")
            .replace("\\t", "\t")
            .replace("\\\"", "\"")
    })
}

fn extract_text_from_process_output_line(data: &str) -> Option<String> {
    let marker = "Agent message (non-delta) received: \"";
    if let Some(start) = data.find(marker) {
        let tail = &data[start + marker.len()..];
        if let Some(end) = tail.rfind('"') {
            let raw = &tail[..end];
            return Some(decode_log_escaped_text(raw));
        }
    }

    let marker = "delta: \"";
    if let Some(start) = data.find(marker) {
        let tail = &data[start + marker.len()..];
        if let Some(end) = tail.rfind('"') {
            let raw = &tail[..end];
            return Some(decode_log_escaped_text(raw));
        }
    }

    None
}
