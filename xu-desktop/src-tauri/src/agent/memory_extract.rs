//! Post-turn memory extraction into xu.db (structured pref/decision/constraint/fact).
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-30
//! @version 1.0.0
//! @category AgentLoop
//! @algo heuristic-plus-llm-structured-extraction

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use rusqlite::Connection;
use serde::Deserialize;
use serde_json::json;

use crate::agent::stream::AgentMessage;
use crate::desktop_db::{self, MemoryRow};

const SETTING_AUTO: &str = "xu.memory.autoExtract";

#[derive(Debug, Clone)]
pub struct ExtractItem {
    pub kind: String,
    pub title: String,
    pub body: String,
    pub pinned: bool,
}

#[derive(Debug, Deserialize)]
struct LlmExtractPayload {
    items: Option<Vec<LlmExtractItem>>,
}

#[derive(Debug, Deserialize)]
struct LlmExtractItem {
    kind: Option<String>,
    title: Option<String>,
    body: Option<String>,
}

pub fn auto_extract_enabled(conn: &Connection) -> bool {
    desktop_db::setting_get(conn, SETTING_AUTO)
        .ok()
        .flatten()
        .map(|v| v != "0" && v != "false")
        .unwrap_or(true)
}

fn stable_id(scope: &str, scope_id: Option<&str>, kind: &str, title: &str) -> String {
    let mut h = DefaultHasher::new();
    scope.hash(&mut h);
    scope_id.unwrap_or("").hash(&mut h);
    kind.hash(&mut h);
    normalize_key(title).hash(&mut h);
    format!("mem_{}_{:x}", kind, h.finish())
}

fn normalize_key(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(|c| c.to_lowercase())
        .take(80)
        .collect()
}

fn clip(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn recent_dialogue(messages: &[AgentMessage]) -> String {
    let mut parts: Vec<String> = Vec::new();
    for m in messages
        .iter()
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
    {
        let role = if m.role == "assistant" {
            "助手"
        } else if m.role == "user" {
            "用户"
        } else {
            continue;
        };
        let text = m.content.trim();
        if text.is_empty() {
            continue;
        }
        parts.push(format!("{role}：{}", clip(text, 600)));
    }
    parts.join("\n")
}

fn looks_like_pref_or_rule(text: &str) -> bool {
    const KEYS: &[&str] = &[
        "以后",
        "下次",
        "请记住",
        "记住",
        "偏好",
        "不要",
        "禁止",
        "必须",
        "永远",
        "统一",
        "始终",
        "默认用",
        "用中文",
        "用英文",
        "别再",
        "务必",
        "约定",
        "规范",
        "prefer",
        "always",
        "never",
        "remember",
    ];
    KEYS.iter().any(|k| text.contains(k))
}

fn classify_line(text: &str) -> &'static str {
    let t = text.to_lowercase();
    if text.contains("禁止")
        || text.contains("不要")
        || text.contains("别再")
        || text.contains("不得")
        || t.contains("never")
        || t.contains("禁止")
    {
        "constraint"
    } else if text.contains("决定")
        || text.contains("确认")
        || text.contains("就用")
        || text.contains("选定")
        || text.contains("采用")
    {
        "decision"
    } else if looks_like_pref_or_rule(text) {
        "pref"
    } else {
        "fact"
    }
}

/// Heuristic structured extract (no LLM). Prefers user rules + assistant conclusions.
pub fn extract_items_heuristic(messages: &[AgentMessage], task_hint: &str) -> Vec<ExtractItem> {
    if messages.len() < 2 {
        return Vec::new();
    }
    let mut items: Vec<ExtractItem> = Vec::new();

    let users: Vec<&str> = messages
        .iter()
        .rev()
        .filter(|m| m.role == "user")
        .take(3)
        .map(|m| m.content.trim())
        .filter(|s| !s.is_empty())
        .collect();

    for u in users {
        if !looks_like_pref_or_rule(u) {
            continue;
        }
        let kind = classify_line(u);
        let body = clip(u, 500);
        if body.chars().count() < 8 {
            continue;
        }
        let title = format!(
            "{}：{}",
            match kind {
                "constraint" => "约束",
                "decision" => "决策",
                "pref" => "偏好",
                _ => "要点",
            },
            clip(u, 36)
        );
        items.push(ExtractItem {
            kind: kind.into(),
            title,
            body,
            pinned: kind == "pref" || kind == "constraint",
        });
    }

    // If no rule-like user lines, fall back to a compact fact from last assistant (not raw dump).
    if items.is_empty() {
        let assistant: String = messages
            .iter()
            .rev()
            .filter(|m| m.role == "assistant")
            .take(1)
            .map(|m| m.content.trim())
            .filter(|s| s.chars().count() >= 80)
            .map(|s| clip(s, 400))
            .collect();
        if !assistant.is_empty() {
            let title = if task_hint.trim().chars().count() > 4 {
                format!("要点：{}", clip(task_hint.trim(), 40))
            } else {
                "回合要点".into()
            };
            items.push(ExtractItem {
                kind: "fact".into(),
                title,
                body: assistant,
                pinned: false,
            });
        }
    }

    dedupe_items(items)
}

fn dedupe_items(items: Vec<ExtractItem>) -> Vec<ExtractItem> {
    let mut out: Vec<ExtractItem> = Vec::new();
    for it in items {
        let key = normalize_key(&format!("{}:{}", it.kind, it.title));
        if out
            .iter()
            .any(|x| normalize_key(&format!("{}:{}", x.kind, x.title)) == key)
        {
            continue;
        }
        out.push(it);
    }
    out.truncate(6);
    out
}

fn parse_llm_items(raw: &str) -> Vec<ExtractItem> {
    let trimmed = raw.trim();
    let json_str = if let Some(start) = trimmed.find('{') {
        let end = trimmed.rfind('}').unwrap_or(trimmed.len() - 1);
        &trimmed[start..=end]
    } else {
        trimmed
    };
    let Ok(payload) = serde_json::from_str::<LlmExtractPayload>(json_str) else {
        return Vec::new();
    };
    let mut items = Vec::new();
    for it in payload.items.unwrap_or_default() {
        let kind_raw = it.kind.unwrap_or_default().to_lowercase();
        let kind = match kind_raw.as_str() {
            "pref" | "preference" | "偏好" => "pref",
            "decision" | "决策" => "decision",
            "constraint" | "约束" | "rule" => "constraint",
            "fact" | "事实" | "要点" => "fact",
            _ => continue,
        };
        let body = it.body.unwrap_or_default().trim().to_string();
        if body.chars().count() < 6 {
            continue;
        }
        let title = it
            .title
            .unwrap_or_default()
            .trim()
            .chars()
            .take(48)
            .collect::<String>();
        let title = if title.is_empty() {
            format!("{}：{}", kind, clip(&body, 32))
        } else {
            title
        };
        items.push(ExtractItem {
            kind: kind.into(),
            title,
            body: clip(&body, 600),
            pinned: kind == "pref" || kind == "constraint",
        });
    }
    dedupe_items(items)
}

/// Lightweight LLM JSON extract. Returns empty on failure.
pub async fn extract_items_llm(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
    model: &str,
    messages: &[AgentMessage],
    task_hint: &str,
) -> Vec<ExtractItem> {
    let dialogue = recent_dialogue(messages);
    if dialogue.chars().count() < 40 {
        return Vec::new();
    }
    let system = "你是记忆抽取器。从对话中只提取可跨会话复用的知识。输出唯一 JSON：\
{\"items\":[{\"kind\":\"pref|decision|constraint|fact\",\"title\":\"短标题\",\"body\":\"一句话\"}]}\
。最多 5 条；无则 items:[]. 不要 markdown。kind：pref=用户偏好/风格，decision=已定方案，constraint=禁止/必须，fact=可复用事实。";
    let user = format!(
        "任务提示：{}\n\n对话：\n{}",
        clip(task_hint, 120),
        clip(&dialogue, 3500)
    );
    let body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user}
        ],
        "stream": false,
        "temperature": 0.1
    });
    let text = match crate::agent::stream::invoke_chat_completions_text(client, url, api_key, &body)
        .await
    {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    parse_llm_items(&text)
}

pub fn upsert_extracted_items(
    conn: &Connection,
    items: &[ExtractItem],
    scope: &str,
    scope_id: Option<&str>,
    source: &str,
) {
    let now = chrono::Utc::now().timestamp_millis();
    for it in items {
        let id = stable_id(scope, scope_id, &it.kind, &it.title);
        let tags = format!(r#"["{}","auto_extract","structured"]"#, it.kind);
        let row = MemoryRow {
            id,
            scope: scope.into(),
            scope_id: scope_id.map(|s| s.to_string()),
            title: it.title.clone(),
            body: it.body.clone(),
            tags,
            source: source.into(),
            version: 1,
            confidence: if source == "auto_extract" { 0.72 } else { 0.85 },
            expires_at: None,
            conflict_key: Some(format!("{}:{}", it.kind, normalize_key(&it.title))),
            citation: "chat turn".into(),
            reason: "从当前对话抽取的可复用信息".into(),
            pinned: it.pinned,
            created_at: now,
            updated_at: now,
        };
        // Preserve original created_at if updating
        if let Ok(existing) = desktop_db::get_memory(conn, &row.id) {
            let mut row = row;
            row.created_at = existing.created_at;
            row.pinned = row.pinned || existing.pinned;
            let _ = desktop_db::upsert_memory(conn, &row);
        } else {
            let _ = desktop_db::upsert_memory(conn, &row);
        }
    }
}

/// Sync path: heuristic structured extract + upsert (dedupe by stable id).
pub fn maybe_extract_memory(
    conn: &Connection,
    messages: &[AgentMessage],
    scope: &str,
    scope_id: Option<&str>,
    task_hint: &str,
) {
    if !auto_extract_enabled(conn) {
        return;
    }
    if messages.len() < 4 {
        return;
    }
    let items = extract_items_heuristic(messages, task_hint);
    if items.is_empty() {
        return;
    }
    upsert_extracted_items(conn, &items, scope, scope_id, "auto_extract");
}

/// Async path: prefer LLM extract, fall back to heuristic.
/// Does **not** hold a DB lock across the LLM await — caller should not pass a locked guard into LLM.
pub async fn extract_memory_items_for_turn(
    messages: &[AgentMessage],
    task_hint: &str,
    llm: Option<(&reqwest::Client, &str, &str, &str)>,
) -> Vec<ExtractItem> {
    if messages.len() < 4 {
        return Vec::new();
    }
    let mut items = if let Some((client, url, key, model)) = llm {
        extract_items_llm(client, url, key, model, messages, task_hint).await
    } else {
        Vec::new()
    };
    if items.is_empty() {
        items = extract_items_heuristic(messages, task_hint);
    }
    items
}

/// Persist items previously extracted (sync; hold DB lock only here).
pub fn persist_extracted_if_enabled(
    conn: &Connection,
    items: &[ExtractItem],
    scope: &str,
    scope_id: Option<&str>,
) {
    if !auto_extract_enabled(conn) || items.is_empty() {
        return;
    }
    upsert_extracted_items(conn, items, scope, scope_id, "auto_extract");
}

/// Async convenience: extract then persist (releases any prior lock before LLM).
pub async fn maybe_extract_memory_async(
    db: &crate::desktop_db::FouDb,
    messages: &[AgentMessage],
    scope: &str,
    scope_id: Option<&str>,
    task_hint: &str,
    llm: Option<(&reqwest::Client, &str, &str, &str)>,
) {
    let enabled = {
        let Ok(conn) = db.0.lock() else {
            return;
        };
        auto_extract_enabled(&conn)
    };
    if !enabled {
        return;
    }
    let items = extract_memory_items_for_turn(messages, task_hint, llm).await;
    if items.is_empty() {
        return;
    }
    if let Ok(conn) = db.0.lock() {
        upsert_extracted_items(&conn, &items, scope, scope_id, "auto_extract");
    }
}

/// Persist a rolling session summary after context compaction.
pub fn write_session_summary_memory(
    conn: &Connection,
    scope: &str,
    scope_id: Option<&str>,
    summary: &str,
    session_hint: &str,
) {
    if !auto_extract_enabled(conn) {
        return;
    }
    let body = clip(summary.trim(), 1200);
    if body.chars().count() < 40 {
        return;
    }
    let now = chrono::Utc::now().timestamp_millis();
    let title = if session_hint.trim().is_empty() {
        format!("会话摘要 · {}", now / 1000)
    } else {
        format!("会话摘要：{}", clip(session_hint.trim(), 40))
    };
    // One rolling summary per scope: update same stable id
    let id = stable_id(scope, scope_id, "session_summary", "rolling");
    let mut created_at = now;
    if let Ok(existing) = desktop_db::get_memory(conn, &id) {
        created_at = existing.created_at;
    }
    let row = MemoryRow {
        id,
        scope: scope.into(),
        scope_id: scope_id.map(|s| s.to_string()),
        title,
        body,
        tags: r#"["session_summary","auto_extract","structured"]"#.into(),
        source: "session_summary".into(),
        version: 1,
        confidence: 0.82,
        expires_at: None,
        conflict_key: Some(format!("session_summary:{}", session_hint.trim())),
        citation: format!("session:{session_hint}"),
        reason: "上下文压缩后保留后续任务所需信息".into(),
        pinned: false,
        created_at,
        updated_at: now,
    };
    let _ = desktop_db::upsert_memory(conn, &row);
}
