//! Auto-precipitate per-employee ordered playbook candidates from repeated tool patterns.
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-30
//! @version 2.0.0
//! @category AgentLoop
//! @algo ordered-tool-fingerprint

use rusqlite::{params, Connection};

use crate::desktop_db::{self, MemoryRow};

const THRESHOLD: i64 = 5;

pub fn record_tool_run(
    conn: &Connection,
    employee_id: &str,
    employee_name: Option<&str>,
    tools: &[String],
) -> Result<(), String> {
    let eid = employee_id.trim();
    if eid.is_empty() {
        return Ok(());
    }
    let mut uniq: Vec<String> = Vec::new();
    for t in tools {
        let n = t.trim();
        if n.is_empty() {
            continue;
        }
        if !uniq.iter().any(|x| x == n) {
            uniq.push(n.to_string());
        }
    }
    if uniq.len() < 2 {
        return Ok(());
    }
    let signature = uniq.join("->");
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO agent_tool_fingerprints(employee_id, signature, hit_count, last_tools, updated_at)
         VALUES(?1,?2,1,?3,?4)
         ON CONFLICT(employee_id, signature) DO UPDATE SET
           hit_count = hit_count + 1,
           last_tools = excluded.last_tools,
           updated_at = excluded.updated_at",
        params![eid, signature, signature, now],
    )
    .map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row(
            "SELECT hit_count FROM agent_tool_fingerprints WHERE employee_id = ?1 AND signature = ?2",
            params![eid, signature],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if count == THRESHOLD || (count > THRESHOLD && count % THRESHOLD == 0) {
        upsert_playbook_memory(conn, eid, employee_name, &uniq, count, now)?;
    }
    Ok(())
}

fn upsert_playbook_memory(
    conn: &Connection,
    employee_id: &str,
    employee_name: Option<&str>,
    tools: &[String],
    count: i64,
    now: i64,
) -> Result<(), String> {
    let id = format!(
        "playbook_{}_{}",
        employee_id.chars().take(12).collect::<String>(),
        {
            let mut h: u32 = 2166136261;
            for b in tools.join(",").bytes() {
                h ^= b as u32;
                h = h.wrapping_mul(16777619);
            }
            format!("{h:08x}")
        }
    );
    let who = employee_name.unwrap_or("本岗");
    let ordered = tools
        .iter()
        .enumerate()
        .map(|(i, tool)| {
            format!(
                "{}. 工具: `{tool}`\n   参数模板: `{{}}`\n   触发条件: 上一步成功或任务明确需要\n   失败修复: 缩小输入后重试一次；仍失败则停止并报告；不得写入真实密钥",
                i + 1
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let body = format!(
        "本岗 Playbook 候选（尚未晋级，不应自动执行）。已重复 {count} 次。\n\
         触发条件：同类任务且输入字段完整。\n\
         有序步骤：\n{ordered}\n\
         晋级要求：固定评测相对基线提升且违规率不增加。"
    );
    let row = MemoryRow {
        id: id.clone(),
        scope: "employee".into(),
        scope_id: Some(employee_id.to_string()),
        title: format!("{who} · Playbook 候选"),
        body,
        tags: r#"["candidate","auto"]"#.into(),
        source: "playbook_candidate".into(),
        version: 1,
        confidence: (0.55 + (count.min(9) as f64 * 0.05)).min(0.95),
        expires_at: None,
        conflict_key: Some(format!("playbook_candidate:{employee_id}")),
        citation: format!("tool-fingerprint:{count}"),
        reason: "同类有序工具轨迹重复后生成候选，需评测晋级".into(),
        pinned: false,
        created_at: now,
        updated_at: now,
    };
    // Keep original created_at if updating
    if let Ok(old) = desktop_db::get_memory(conn, &row.id) {
        let mut next = row;
        next.created_at = old.created_at;
        desktop_db::upsert_memory(conn, &next)?;
    } else {
        desktop_db::upsert_memory(conn, &row)?;
    }
    let _ = write_playbook_skill_file(conn, employee_id, employee_name, tools, count, &id);
    Ok(())
}

fn sanitize_file_stem(raw: &str) -> String {
    let s: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let s = s.trim_matches('_').to_string();
    if s.is_empty() {
        "employee".into()
    } else {
        s.chars().take(48).collect()
    }
}

fn resolve_user_skills_dir(conn: &Connection) -> Option<std::path::PathBuf> {
    if let Ok(Some(raw)) = desktop_db::setting_get(conn, "xu.skills.dataDir") {
        let t = raw.trim();
        if !t.is_empty() {
            return Some(std::path::PathBuf::from(t));
        }
    }
    let base = dirs::document_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Documents")))
        .or_else(dirs::home_dir)?;
    let preferred = base.join("虚募阁技能");
    let legacy = base.join("虚慕阁技能");
    if preferred.is_dir() {
        return Some(preferred);
    }
    if legacy.is_dir() {
        // One-shot rename so UI/help path 虚募阁技能 matches on-disk data
        if std::fs::rename(&legacy, &preferred).is_ok() {
            return Some(preferred);
        }
        return Some(legacy);
    }
    Some(preferred)
}

fn write_playbook_skill_file(
    conn: &Connection,
    employee_id: &str,
    employee_name: Option<&str>,
    tools: &[String],
    count: i64,
    playbook_id: &str,
) -> Result<(), String> {
    let Some(root) = resolve_user_skills_dir(conn) else {
        return Ok(());
    };
    let dir = root.join("playbooks");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem = sanitize_file_stem(employee_id);
    let hash = playbook_id.rsplit('_').next().unwrap_or("pb");
    let path = dir.join(format!("{stem}_{hash}.md"));
    let who = employee_name.unwrap_or("本岗");
    let ordered = tools
        .iter()
        .enumerate()
        .map(|(i, tool)| {
            format!(
                "{}. tool: `{tool}`\n   params: `{{}}`\n   trigger: previous step succeeded\n   recovery: retry once with reduced input, then stop; never persist secrets",
                i + 1
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let body = format!(
        "---\nname: {who} · Playbook 候选\nid: {playbook_id}\nemployeeId: {employee_id}\nversion: 1\nstatus: draft\n---\n\n\
         自动沉淀的有序候选，已重复 {count} 次；评测晋级前不得自动启用。\n\n\
         ## Steps\n{ordered}\n"
    );
    std::fs::write(&path, body.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}
