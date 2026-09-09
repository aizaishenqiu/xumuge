//! Ollama / local-model tool_call JSON resilience.
//! Local models often wrap args in ```json fences, truncate, or dump tool calls in content.

use serde_json::{json, Value};

/// Strip markdown code fences and trim junk around JSON.
pub fn strip_markdown_fences(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if let Some(rest) = s.strip_prefix("```json") {
        s = rest.to_string();
    } else if let Some(rest) = s.strip_prefix("```JSON") {
        s = rest.to_string();
    } else if let Some(rest) = s.strip_prefix("```") {
        s = rest.to_string();
    }
    if let Some(idx) = s.rfind("```") {
        s = s[..idx].to_string();
    }
    s.trim().to_string()
}

/// Best-effort recover a JSON object/array from noisy model output.
pub fn extract_json_slice(raw: &str) -> String {
    let s = strip_markdown_fences(raw);
    let bytes = s.as_bytes();
    let start_obj = bytes.iter().position(|&b| b == b'{' || b == b'[');
    let end_obj = bytes.iter().rposition(|&b| b == b'}' || b == b']');
    match (start_obj, end_obj) {
        (Some(a), Some(b)) if a < b => s[a..=b].to_string(),
        _ => s,
    }
}

/// Light repair: drop trailing commas before } or ].
pub fn repair_json_light(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let chars: Vec<char> = raw.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == ',' {
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j < chars.len() && (chars[j] == '}' || chars[j] == ']') {
                i += 1;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

pub fn parse_tool_arguments(raw: &str) -> Value {
    let cleaned = repair_json_light(&extract_json_slice(raw));
    if cleaned.trim().is_empty() {
        return json!({});
    }
    serde_json::from_str(&cleaned).unwrap_or_else(|_| {
        // Last resort: treat whole string as { "raw": "..." }
        json!({ "raw": raw.chars().take(2000).collect::<String>() })
    })
}

/// When the model puts a tool call inside assistant content instead of tool_calls[].
pub fn extract_tool_calls_from_content(content: &str) -> Option<Vec<(String, String, String)>> {
    let cleaned = repair_json_light(&extract_json_slice(content));
    let v: Value = serde_json::from_str(&cleaned).ok()?;

    // { "name": "...", "arguments": {...} } or { "tool": "...", "args": {...} }
    if let Some(name) = v
        .get("name")
        .or_else(|| v.get("tool"))
        .or_else(|| v.get("function").and_then(|f| f.get("name")))
        .and_then(|x| x.as_str())
    {
        let args = v
            .get("arguments")
            .or_else(|| v.get("args"))
            .or_else(|| v.get("parameters"))
            .or_else(|| v.get("function").and_then(|f| f.get("arguments")))
            .cloned()
            .unwrap_or(json!({}));
        let args_s = match args {
            Value::String(s) => s,
            other => other.to_string(),
        };
        return Some(vec![("content_tool".into(), name.to_string(), args_s)]);
    }

    // { "tool_calls": [ { "function": { "name", "arguments" } } ] }
    if let Some(arr) = v.get("tool_calls").and_then(|x| x.as_array()) {
        let mut out = Vec::new();
        for (i, item) in arr.iter().enumerate() {
            let name = item
                .get("function")
                .and_then(|f| f.get("name"))
                .or_else(|| item.get("name"))
                .and_then(|x| x.as_str())
                .unwrap_or("unknown");
            let args = item
                .get("function")
                .and_then(|f| f.get("arguments"))
                .or_else(|| item.get("arguments"))
                .cloned()
                .unwrap_or(json!({}));
            let args_s = match args {
                Value::String(s) => s,
                other => other.to_string(),
            };
            out.push((format!("content_tool_{i}"), name.to_string(), args_s));
        }
        if !out.is_empty() {
            return Some(out);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_fence() {
        let s = strip_markdown_fences("```json\n{\"a\":1}\n```");
        assert!(s.contains("\"a\""));
        assert!(!s.contains("```"));
    }

    #[test]
    fn parses_fenced_args() {
        let v = parse_tool_arguments("```json\n{\"path\":\"a.md\",\"content\":\"hi\"}\n```");
        assert_eq!(v["path"], "a.md");
    }
}
