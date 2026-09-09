//! Unified office-floor write + Feishu mirror policy.

use tauri::{AppHandle, Emitter, Manager};

use crate::commands::channels::{xu_notify_boss, mirror_text_to_feishu_meeting};
use crate::desktop_db::{self, FouDb, MessageRow};

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn feishu_sync_level(db: &FouDb) -> String {
    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(_) => return "all".into(),
    };
    desktop_db::setting_get(&conn, "feishu_sync_level")
        .ok()
        .flatten()
        .filter(|s| s == "all" || s == "boss_only" || s == "meeting_only")
        .unwrap_or_else(|| "all".into())
}

fn should_mirror_feishu(db: &FouDb, phase: &str, force: bool) -> bool {
    if force {
        return true;
    }
    let level = feishu_sync_level(db);
    match level.as_str() {
        "meeting_only" => {
            matches!(phase, "开会" | "待确认" | "失败")
                || phase.contains("拍板")
                || phase.contains("验收")
        }
        "boss_only" => {
            matches!(
                phase,
                "开会" | "待确认" | "失败" | "交付" | "落地" | "实现" | "回复" | "分析"
            )
        }
        _ => true,
    }
}

/// Write office-floor + optional Feishu mirror per sync policy.
pub fn publish_office_message(
    app: &AppHandle,
    employee_id: Option<&str>,
    emp_name: &str,
    phase: &str,
    body: &str,
    mirror_force: bool,
) {
    let clipped: String = body.chars().take(2_500).collect();
    if clipped.trim().is_empty() {
        return;
    }
    let label = match phase {
        "失败" => format!("【{emp_name} · 失败】{clipped}"),
        "待确认" | "开会" => format!("【{emp_name} · 开会】{clipped}"),
        "已受理" => format!("【{emp_name} · 已受理】{clipped}"),
        "进度" => format!("【{emp_name} · 进度】{clipped}"),
        "交付" => format!("【{emp_name} · 交付】{clipped}"),
        other => format!("【{emp_name} · {other}】{clipped}"),
    };
    if let Some(db) = app.try_state::<FouDb>() {
        if let Ok(conn) = db.0.lock() {
            let _ = desktop_db::append_message(
                &conn,
                &MessageRow {
                    id: format!("om_{}_{}", phase.chars().next().unwrap_or('x'), now_ms()),
                    session_tag: "office-floor".into(),
                    employee_id: employee_id.map(|s| s.to_string()),
                    role: if phase == "已受理" {
                        "system".into()
                    } else {
                        "assistant".into()
                    },
                    content: label.clone(),
                    image_path: None,
                    created_at: now_ms(),
                },
            );
        }
        let mirror = should_mirror_feishu(&db, phase, mirror_force);
        drop(db);
        if mirror {
            let db_arc = app.state::<FouDb>().0.clone();
            let text = label.clone();
            tauri::async_runtime::spawn(async move {
                let db = FouDb(db_arc);
                if let Err(e) = mirror_text_to_feishu_meeting(&db, &text).await {
                    eprintln!("[xu] feishu mirror failed: {e}");
                }
            });
        }
    }
    let _ = app.emit("xu-office-notify", ());
}

/// Boss plan/acceptance templates via notify_boss (force).
pub fn notify_boss_plan_review(app: &AppHandle, project_name: &str, body: &str) {
    let app = app.clone();
    let project_name = project_name.to_string();
    let body = body.to_string();
    tauri::async_runtime::spawn(async move {
        let db = app.state::<FouDb>();
        let _ = xu_notify_boss(
            app.clone(),
            db,
            "plan_review".into(),
            format!("虚募阁 · {project_name} 计划待拍板"),
            body,
            Some("feishu".into()),
            Some(true),
        )
        .await;
    });
}
