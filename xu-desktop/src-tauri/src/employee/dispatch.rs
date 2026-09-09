//! Dispatch entry for Xu Native Agent.
//! Must not spawn hermes CLI.
//! Workflow: analyze (read-only) → task breakdown → IM confirm if needed → implement.
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-30
//! @version 1.0.0
//! @category AgentLoop
//! @algo bounded-dispatch

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::agent::memory_extract::maybe_extract_memory;
use crate::agent::stream::{
    is_local_llm, run_agent_loop, AgentEndpoint, AgentMessage, AgentRunOpts, AgentRuntime,
};
use crate::agent::tool_policy::ProjectToolPolicy;
use crate::agent::tools::ToolMode;
use crate::desktop_db::{self, FouDb, MemoryRow, MessageRow};
use crate::StreamChunk;

fn normalize_code_editor_surface(raw: Option<&str>) -> String {
    match raw.map(str::trim).unwrap_or("builtin") {
        "external" => "external".into(),
        _ => "builtin".into(),
    }
}

fn is_im_inbound_text(user_text: &str) -> bool {
    user_text.contains("【飞书群派活】") || user_text.contains("【企微派活】")
}

fn ide_open_system_hint(surface: &str) -> &'static str {
    if surface == "external" {
        "需要在本机 IDE 打开代码时调用 ide_open，勿空口声称已在 IDE 保存。"
    } else {
        "改码请用 write_file / patch_file；查看代码时系统会在应用内编辑器自动打开，勿调用 ide_open 打开外部 IDE。"
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmpEndpoint {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub api_key_env: String,
    pub brain_slot: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmpDispatchResult {
    pub job_id: String,
    pub session_id: String,
    pub queued_only: bool,
    pub message: String,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn user_address_for_prompt(name: Option<&str>) -> String {
    name.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "您".to_string())
}

fn user_address_prompt_suffix(name: Option<&str>) -> String {
    format!(
        "\n\n【用户称呼】回复时请称用户为「{}」。",
        user_address_for_prompt(name)
    )
}

/// Boss / 职责里要交付 Word、Excel、PPT 时，必须直接实现，不能卡在分析空口报路径。
fn task_wants_office_docs(text: &str) -> bool {
    let t = text.to_lowercase();
    t.contains(".docx")
        || t.contains(".xlsx")
        || t.contains(".pptx")
        || t.contains("word")
        || t.contains("excel")
        || t.contains("powerpoint")
        || t.contains("ppt")
        || text.contains("文档")
        || text.contains("表格")
        || text.contains("演示")
        || text.contains("需求文档")
        || text.contains("产品文档")
        || text.contains("PRD")
        || text.contains("路线图")
}

fn qa_dispatch_guard_snippet(task: &str) -> &'static str {
    let t = task.to_lowercase();
    if t.contains("qa")
        || t.contains("测试")
        || t.contains("wait_dev")
        || t.contains("waiting_dev")
        || t.contains("质检")
    {
        "\n【QA 铁律】必须先 list_dir 检查 frontend/backend 是否有 .ts/.vue/.rs 等源码；无源码禁止 write_file/office_write 测试报告，只输出 XU_PHASE: WAITING_DEV 并结束。\n"
    } else {
        ""
    }
}

/// Still used to decide Feishu mirror spam (not office-floor visibility).
fn office_floor_worthy(text: &str) -> bool {
    let t = text.trim();
    if t.is_empty() {
        return false;
    }
    if t.contains("XU_NEED_CONFIRM") || t.contains("XU_CROSS_MODULE") {
        return true;
    }
    let keys = [
        "开会",
        "会议",
        "排期",
        "待确认",
        "请老板",
        "需要老板",
        "请审批",
        "请拍板",
        "阻塞",
        "blocked",
        "请安排",
        "需要安排",
        "老板安排",
        "评审",
        "对齐会",
    ];
    keys.iter().any(|k| t.contains(k))
}

/// Always write employee phase text to office-floor (ACK / progress / finals).
fn append_office_floor_always(
    conn: &rusqlite::Connection,
    employee_id: &str,
    emp_name: &str,
    phase: &str,
    body: &str,
) {
    let clipped: String = body.chars().take(2_500).collect();
    let label = match phase {
        "失败" => format!("【{emp_name} · 失败】{clipped}"),
        "待确认" | "开会" => format!("【{emp_name} · 开会】{clipped}"),
        "已受理" => format!("【{emp_name} · 已受理】{clipped}"),
        "进度" => format!("【{emp_name} · 进度】{clipped}"),
        "交付" => format!("【{emp_name} · 交付】{clipped}"),
        other => format!("【{emp_name} · {other}】{clipped}"),
    };
    let _ = desktop_db::append_message(
        conn,
        &MessageRow {
            id: format!("om_{}_{}", phase.chars().next().unwrap_or('x'), now_ms()),
            session_tag: "office-floor".into(),
            employee_id: Some(employee_id.to_string()),
            role: if phase == "已受理" {
                "system".into()
            } else {
                "assistant".into()
            },
            content: label,
            image_path: None,
            created_at: now_ms(),
        },
    );
}

fn notify_office(app: &AppHandle) {
    static GEN: AtomicU64 = AtomicU64::new(0);
    let app = app.clone();
    let my_gen = GEN.fetch_add(1, Ordering::Relaxed) + 1;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if GEN.load(Ordering::Relaxed) != my_gen {
            return;
        }
        let _ = app.emit("xu-office-notify", ());
    });
}

fn emit_status(app: &AppHandle, session_id: &str, kind: &str, content: &str) {
    let _ = app.emit(
        "xu:chunk",
        StreamChunk {
            kind: kind.into(),
            content: content.into(),
            session_id: session_id.into(),
            run_id: format!("employee:{session_id}"),
        },
    );
}

fn emit_emp(app: &AppHandle, employee_id: &str, state: &str, action: &str, message: &str) {
    crate::employee::events::emit_employee_event(app, employee_id, state, action, message);
}

fn maybe_request_delivery_review(
    app: &AppHandle,
    employee_id: &str,
    task_text: &str,
    delivery_body: &str,
) {
    crate::employee::events::emit_delivery_review_request(
        app,
        employee_id,
        task_text,
        delivery_body,
    );
}

/// Best-effort: mirror office assistant text to the bound Feishu meeting group.
fn mirror_office_assistant_to_feishu(app: &AppHandle, text: &str) {
    let text = text.trim().to_string();
    if text.is_empty() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let db = app.state::<FouDb>();
        if let Err(e) = crate::commands::channels::mirror_text_to_feishu_meeting(&db, &text).await {
            eprintln!("[xu] feishu meeting mirror failed: {e}");
        }
    });
}

/// Accept dispatch, start Xu Native Agent in background, return immediately.
/// `direct_implement`: Boss 深派活时跳过分析，直接落文件。
/// `qa_mode`: 轻量问答，必须中文回一条，不上全量实现。
#[tauri::command]
pub fn xu_emp_dispatch_task(
    app: AppHandle,
    db: State<'_, FouDb>,
    runtime: State<'_, AgentRuntime>,
    employee_id: String,
    task: String,
    force_new_session: Option<bool>,
    project_id: Option<String>,
    direct_implement: Option<bool>,
    qa_mode: Option<bool>,
    endpoint: EmpEndpoint,
    workspace_root: String,
    composed_message: String,
    ide_cli: Option<String>,
    code_editor_surface: Option<String>,
    project_tool_policy: Option<ProjectToolPolicy>,
    user_address_name: Option<String>,
) -> Result<EmpDispatchResult, String> {
    if workspace_root.trim().is_empty() {
        return Err("请先为该员工设置可写工作区路径".into());
    }
    let user_text = if !composed_message.trim().is_empty() {
        composed_message.trim().to_string()
    } else {
        task.trim().to_string()
    };
    if user_text.is_empty() {
        return Err("任务内容为空".into());
    }
    if endpoint.model.trim().is_empty() {
        return Err("员工脑槽未配置模型，请先在设置中配置 Ops 三脑".into());
    }
    if endpoint.base_url.trim().is_empty() {
        return Err("员工脑槽未配置 baseUrl".into());
    }

    let ide_cli_opt = ide_cli
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string());
    let surface_opt = Some(normalize_code_editor_surface(
        code_editor_surface.as_deref(),
    ));

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        desktop_db::assert_token_quota(&conn)?;
    }

    let job_id = format!(
        "job_{}_{}",
        now_ms(),
        &employee_id.chars().take(8).collect::<String>()
    );
    let force = force_new_session.unwrap_or(false);
    let qa = qa_mode.unwrap_or(false);
    let wants_office = task_wants_office_docs(&user_text) || task_wants_office_docs(&task);
    let direct = !qa && (direct_implement.unwrap_or(false) || wants_office);
    let qa_guard = qa_dispatch_guard_snippet(&format!("{task}{user_text}"));
    let user_addr_label = user_address_for_prompt(user_address_name.as_deref());
    let user_addr_suffix = user_address_prompt_suffix(user_address_name.as_deref());

    let (session_id, history, emp_name, read_extra, memory_preamble) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let acl = desktop_db::get_employee_acl(&conn, &employee_id)?
            .ok_or_else(|| "员工不存在".to_string())?;
        let emp_name = acl.name;
        let read_extra = acl.read_extra_paths;

        let memory_hint = format!("模式 pattern task_distill {}", task);
        let memory_preamble = desktop_db::build_memory_preamble(
            &conn,
            Some(&employee_id),
            Some(&emp_name),
            project_id.as_deref(),
            Some(&memory_hint),
        )
        .unwrap_or_default();

        let existing = if force {
            None
        } else {
            desktop_db::get_employee_session(&conn, &employee_id)?
        };

        let session_id = if let Some(sid) = existing {
            if desktop_db::chat_session_exists(&conn, &sid)? {
                sid
            } else {
                let sid = format!(
                    "xu_{}_{}",
                    now_ms(),
                    &employee_id.chars().take(6).collect::<String>()
                );
                desktop_db::create_chat_session(
                    &conn,
                    &sid,
                    &format!("派活 · {emp_name}"),
                    Some(&employee_id),
                    &endpoint.brain_slot,
                    &endpoint.model,
                )?;
                desktop_db::set_employee_session(&conn, &employee_id, &sid)?;
                sid
            }
        } else {
            let sid = format!(
                "xu_{}_{}",
                now_ms(),
                &employee_id.chars().take(6).collect::<String>()
            );
            desktop_db::create_chat_session(
                &conn,
                &sid,
                &format!("派活 · {emp_name}"),
                Some(&employee_id),
                &endpoint.brain_slot,
                &endpoint.model,
            )?;
            desktop_db::set_employee_session(&conn, &employee_id, &sid)?;
            sid
        };

        let history = desktop_db::list_chat_messages(&conn, &session_id, 24)?;
        desktop_db::append_chat_message(&conn, &session_id, "user", &user_text)?;
        desktop_db::set_employee_status(&conn, &employee_id, "working")?;

        let _ = desktop_db::append_message(
            &conn,
            &MessageRow {
                id: format!("om_u_{}", now_ms()),
                session_tag: "office-floor".into(),
                employee_id: Some(employee_id.clone()),
                role: "boss".into(),
                content: format!("【派活】{}", task.chars().take(500).collect::<String>()),
                image_path: None,
                created_at: now_ms(),
            },
        );
        append_office_floor_always(
            &conn,
            &employee_id,
            &emp_name,
            "已受理",
            "已收到 Boss 消息，开始处理…",
        );

        let payload = serde_json::json!({
            "jobId": job_id,
            "employeeId": employee_id,
            "sessionId": session_id,
            "workspaceRoot": workspace_root,
            "model": endpoint.model,
            "provider": endpoint.provider,
            "baseUrl": endpoint.base_url,
            "brainSlot": endpoint.brain_slot,
            "apiKeyEnv": endpoint.api_key_env,
            "forceNewSession": force,
            "projectId": project_id,
            "task": task,
            "directImplement": direct,
            "state": if direct { "implementing" } else { "analyzing" },
            "at": now_ms(),
        });
        conn.execute(
            "INSERT INTO settings(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![
                format!("xu.dispatch.last.{employee_id}"),
                payload.to_string()
            ],
        )
        .map_err(|e| e.to_string())?;

        (session_id, history, emp_name, read_extra, memory_preamble)
    };
    notify_office(&app);
    // Immediate receipt for office UI (before LLM starts)
    emit_emp(
        &app,
        &employee_id,
        "working",
        "accepted",
        if wants_office {
            "已收到：将直接生成 Office 文档…"
        } else {
            "已收到消息，开始工作…"
        },
    );

    let agent_endpoint = AgentEndpoint {
        provider: endpoint.provider.clone(),
        model: endpoint.model.clone(),
        base_url: endpoint.base_url.clone(),
        api_key_env: endpoint.api_key_env.clone(),
        api_format: "openai".into(),
        preset_id: String::new(),
    };
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut map = runtime.cancels.lock().map_err(|e| e.to_string())?;
        map.insert(session_id.clone(), cancel.clone());
    }
    let workspace_for_task = workspace_root.trim().to_string();
    let read_paths: Vec<PathBuf> = read_extra.into_iter().map(PathBuf::from).collect();
    let runtime_for_slots = AgentRuntime::clone(&runtime);
    let project_id_for_slot = project_id.clone();

    // ── Light Q&A: must reply in Chinese; no full implement ─────────────
    if qa {
        emit_emp(&app, &employee_id, "working", "replying", "正在回复老板…");
        let mut system = format!(
            "你是虚募阁的 AI 员工「{emp_name}」。\n\
             {user_addr_label}在办公室对话框里跟你说话。用简洁中文直接回复（2～8 句）。\n\
             不要假答应；不清楚就说需要开会确认。若必须确认，输出 XU_NEED_CONFIRM: 列表。\n\
             本轮是问答，不要大规模写文件；可用 list_dir/read_file 查工作区。"
        );
        if !memory_preamble.is_empty() {
            system.push_str("\n\n");
            system.push_str(&memory_preamble);
        }
        system.push_str(&user_addr_suffix);
        let mut messages: Vec<AgentMessage> = vec![AgentMessage {
            role: "system".into(),
            content: system,
            images: None,
        }];
        for m in &history {
            if m.role == "user" || m.role == "assistant" {
                messages.push(AgentMessage {
                    role: m.role.clone(),
                    content: m.content.clone(),
                    images: None,
                });
            }
        }
        messages.push(AgentMessage {
            role: "user".into(),
            content: format!("【办公室对谈】\n{user_text}"),
            images: None,
        });
        let qa_opts = AgentRunOpts {
            workspace_root: Some(PathBuf::from(&workspace_for_task)),
            read_extra_paths: read_paths.clone(),
            enable_tools: true,
            tool_mode: ToolMode::ReadOnly,
            employee_id: Some(employee_id.clone()),
            usage_source: "employee_qa".into(),
            require_approval: false,
            boss_granted_session: false,
            ide_cli: ide_cli_opt.clone(),
            code_editor_surface: surface_opt.clone(),
            apply_global_prefs: true,
            snapshot_batch: None,
            require_write: false,
            require_canvas_write: false,
            project_id: project_id.clone(),
            project_tool_policy: project_tool_policy.clone(),
            memory_scope: Some(if project_id.is_some() {
                "project".into()
            } else {
                "employee".into()
            }),
            memory_scope_id: project_id.clone().or_else(|| Some(employee_id.clone())),
            memory_task_hint: Some(user_text.chars().take(160).collect()),
            release_gate: false,
            im_inbound: is_im_inbound_text(&user_text),
            max_tokens: None,
            disable_thinking: false,
        };
        let app2 = app.clone();
        let session_for_task = session_id.clone();
        let employee_for_task = employee_id.clone();
        let job_for_task = job_id.clone();
        let emp_name_for_msg = emp_name.clone();
        tauri::async_runtime::spawn(async move {
            let project_id_for_slot = project_id_for_slot.clone();
            let runtime_for_slots = runtime_for_slots.clone();
            let _permit = match runtime_for_slots
                .acquire_employee_permit(
                    project_id_for_slot.as_deref(),
                    is_local_llm(&agent_endpoint.base_url),
                )
                .await
            {
                Ok(p) => p,
                Err(e) => {
                    emit_emp(&app2, &employee_for_task, "blocked", "queue_full", &e);
                    return;
                }
            };
            let result = run_agent_loop(
                &app2,
                &session_for_task,
                &agent_endpoint,
                &messages,
                qa_opts,
                cancel,
            )
            .await;
            let xu_db = app2.state::<FouDb>().0.clone();
            let cancels = app2.state::<AgentRuntime>().cancels.clone();
            match result {
                Ok(text) => {
                    let body = if text.trim().is_empty() {
                        "（已收到，暂无更多说明）".to_string()
                    } else {
                        text
                    };
                    if user_text.contains("【企微客服草稿") {
                        crate::commands::wecom_inbound::apply_kf_draft_from_qa(
                            &FouDb(xu_db.clone()),
                            &user_text,
                            &body,
                        );
                    }
                    let need = extract_need_confirm(&body);
                    {
                        let conn = match xu_db.lock() {
                            Ok(c) => c,
                            Err(e) => e.into_inner(),
                        };
                        let _ = desktop_db::append_chat_message(
                            &conn,
                            &session_for_task,
                            "assistant",
                            &body,
                        );
                        if need.is_empty() {
                            crate::employee::deliverables::flush_deliverable_summary(
                                &app2,
                                &employee_for_task,
                                true,
                            );
                            let floor_body =
                                crate::employee::deliverables::enrich_body_with_deliverables(
                                    &employee_for_task,
                                    &body,
                                );
                            append_office_floor_always(
                                &conn,
                                &employee_for_task,
                                &emp_name_for_msg,
                                "回复",
                                &floor_body,
                            );
                            drop(conn);
                            mirror_office_assistant_to_feishu(
                                &app2,
                                &format!("【{emp_name_for_msg} · 回复】{floor_body}"),
                            );
                            let conn = match xu_db.lock() {
                                Ok(c) => c,
                                Err(e) => e.into_inner(),
                            };
                            crate::employee::deliverables::finish_deliverable_summary(
                                &app2,
                                &employee_for_task,
                            );
                            maybe_request_delivery_review(
                                &app2,
                                &employee_for_task,
                                &job_for_task,
                                &floor_body,
                            );
                            let _ =
                                desktop_db::set_employee_status(&conn, &employee_for_task, "idle");
                        } else {
                            append_office_floor_always(
                                &conn,
                                &employee_for_task,
                                &emp_name_for_msg,
                                "回复",
                                &body,
                            );
                            enter_meeting_confirm(
                                &conn,
                                &employee_for_task,
                                &emp_name_for_msg,
                                &job_for_task,
                                &session_for_task,
                                &need,
                                &body,
                            );
                        }
                    }
                    if !need.is_empty() {
                        notify_boss_need_confirm(
                            &app2,
                            &employee_for_task,
                            &emp_name_for_msg,
                            &need,
                            &body,
                        );
                        emit_emp(
                            &app2,
                            &employee_for_task,
                            "meeting",
                            "need_confirm",
                            "开会：等待老板确认",
                        );
                    } else {
                        emit_emp(&app2, &employee_for_task, "idle", "done", "已回复");
                    }
                    notify_office(&app2);
                }
                Err(err) => {
                    finish_dispatch_error(
                        &app2,
                        &FouDb(xu_db),
                        cancels.clone(),
                        &session_for_task,
                        &employee_for_task,
                        &job_for_task,
                        &emp_name_for_msg,
                        &err,
                    );
                }
            }
            {
                let mut map = match cancels.lock() {
                    Ok(m) => m,
                    Err(e) => e.into_inner(),
                };
                map.remove(&session_for_task);
            }
        });
        return Ok(EmpDispatchResult {
            job_id,
            session_id,
            queued_only: false,
            message: "已受理：员工将回复办公室对话".into(),
        });
    }

    if direct {
        emit_emp(
            &app,
            &employee_id,
            "working",
            "implementing",
            &format!("直接落地到工作区：{}", workspace_for_task),
        );
        let mut system = format!(
            "你是虚募阁的 AI 员工「{emp_name}」。\n\
             【可写工作区】{workspace_for_task}\n\
             【强制】所有新建/修改必须通过工具完成：优先 patch_file，其次 write_file / mkdir；可读 list_dir / read_file。\n\
             【格式】文本用 write_file（.md/.txt/.json…）；Word/Excel/PPT 必须用 office_write_docx / office_write_xlsx / office_write_pptx。\n\
             【示例】产品文档：office_write_docx path=\"PM_需求_v1.docx\" title=\"…\" body=\"段落…\"\n\
             【示例】表格：office_write_xlsx path=\"计划.xlsx\" rows=[[\"列1\",\"列2\"],[\"a\",\"b\"]]\n\
             【铁律】没有工具成功返回，就等于文件不存在——禁止编造路径。\n\
             文件必须落在 playbook/任务声明的子目录内，禁止在生成根目录散落文件。\n\
             {ide_hint}\n\
             先 list_dir + 遵循 XU_TASKS 路径，再落盘；汇报写「相对路径 + 用途」。{qa_guard}"
        , ide_hint = ide_open_system_hint(surface_opt.as_deref().unwrap_or("builtin")));
        if !memory_preamble.is_empty() {
            system.push_str("\n\n");
            system.push_str(&memory_preamble);
        }
        let mut messages: Vec<AgentMessage> = vec![AgentMessage {
            role: "system".into(),
            content: system,
            images: None,
        }];
        for m in history {
            if m.role == "user" || m.role == "assistant" {
                messages.push(AgentMessage {
                    role: m.role,
                    content: m.content,
                    images: None,
                });
            }
        }
        messages.push(AgentMessage {
            role: "user".into(),
            content: format!(
                "【Boss 开工 · 直接实现】\n{user_text}\n\n请马上在工作区写入实际文件，禁止只回复计划不落盘。"
            ),
            images: None,
        });
        let impl_opts = AgentRunOpts {
            workspace_root: Some(PathBuf::from(&workspace_for_task)),
            read_extra_paths: read_paths,
            enable_tools: true,
            tool_mode: ToolMode::Full,
            employee_id: Some(employee_id.clone()),
            usage_source: "employee_kickoff".into(),
            require_approval: true,
            boss_granted_session: false,
            ide_cli: ide_cli_opt.clone(),
            code_editor_surface: surface_opt.clone(),
            apply_global_prefs: true,
            snapshot_batch: None,
            require_write: false,
            require_canvas_write: false,
            project_id: project_id.clone(),
            project_tool_policy: project_tool_policy.clone(),
            memory_scope: Some(if project_id.is_some() {
                "project".into()
            } else {
                "employee".into()
            }),
            memory_scope_id: project_id.clone().or_else(|| Some(employee_id.clone())),
            memory_task_hint: Some(user_text.chars().take(160).collect()),
            release_gate: false,
            im_inbound: is_im_inbound_text(&user_text),
            max_tokens: None,
            disable_thinking: false,
        };
        let app2 = app.clone();
        let session_for_task = session_id.clone();
        let employee_for_task = employee_id.clone();
        let job_for_task = job_id.clone();
        let emp_name_for_msg = emp_name.clone();
        tauri::async_runtime::spawn(async move {
            emit_emp(
                &app2,
                &employee_for_task,
                "idle",
                "queued",
                "排队中：等待执行槽…",
            );
            let project_id_for_slot = project_id_for_slot.clone();
            let runtime_for_slots = runtime_for_slots.clone();
            let _permit = match runtime_for_slots
                .acquire_employee_permit(
                    project_id_for_slot.as_deref(),
                    is_local_llm(&agent_endpoint.base_url),
                )
                .await
            {
                Ok(p) => p,
                Err(e) => {
                    emit_emp(&app2, &employee_for_task, "blocked", "queue_full", &e);
                    return;
                }
            };
            emit_emp(
                &app2,
                &employee_for_task,
                "working",
                "write_file",
                "正在向项目文件夹写入…",
            );
            let result = run_agent_loop(
                &app2,
                &session_for_task,
                &agent_endpoint,
                &messages,
                impl_opts,
                cancel,
            )
            .await;
            let xu_db = app2.state::<FouDb>().0.clone();
            let cancels = app2.state::<AgentRuntime>().cancels.clone();
            match result {
                Ok(text) => {
                    let body = if text.trim().is_empty() {
                        "（已执行，无文本汇报）".to_string()
                    } else {
                        text
                    };
                    {
                        let conn = match xu_db.lock() {
                            Ok(c) => c,
                            Err(e) => e.into_inner(),
                        };
                        let _ = desktop_db::append_chat_message(
                            &conn,
                            &session_for_task,
                            "assistant",
                            &body,
                        );
                        crate::employee::deliverables::flush_deliverable_summary(
                            &app2,
                            &employee_for_task,
                            true,
                        );
                        let floor_body =
                            crate::employee::deliverables::enrich_body_with_deliverables(
                                &employee_for_task,
                                &body,
                            );
                        append_office_floor_always(
                            &conn,
                            &employee_for_task,
                            &emp_name_for_msg,
                            "落地",
                            &floor_body,
                        );
                        crate::employee::deliverables::finish_deliverable_summary(
                            &app2,
                            &employee_for_task,
                        );
                        maybe_request_delivery_review(
                            &app2,
                            &employee_for_task,
                            &job_for_task,
                            &floor_body,
                        );
                        let _ = desktop_db::set_employee_status(&conn, &employee_for_task, "idle");
                        let payload = serde_json::json!({
                            "jobId": job_for_task,
                            "employeeId": employee_for_task,
                            "sessionId": session_for_task,
                            "state": "done",
                            "at": now_ms(),
                        });
                        let _ = conn.execute(
                            "INSERT INTO settings(key, value) VALUES(?1, ?2)
                             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                            rusqlite::params![
                                format!("xu.dispatch.last.{employee_for_task}"),
                                payload.to_string()
                            ],
                        );
                    }
                    mirror_office_assistant_to_feishu(
                        &app2,
                        &format!("【{emp_name_for_msg} · 落地】{body}"),
                    );
                    emit_status(
                        &app2,
                        &session_for_task,
                        "status",
                        &format!("employee:{employee_for_task}:idle"),
                    );
                    emit_emp(
                        &app2,
                        &employee_for_task,
                        "idle",
                        "done",
                        "已写入工作区并汇报",
                    );
                    notify_office(&app2);
                }
                Err(err) => {
                    finish_dispatch_error(
                        &app2,
                        &FouDb(xu_db),
                        cancels.clone(),
                        &session_for_task,
                        &employee_for_task,
                        &job_for_task,
                        &emp_name_for_msg,
                        &err,
                    );
                }
            }
            {
                let mut map = match cancels.lock() {
                    Ok(m) => m,
                    Err(e) => e.into_inner(),
                };
                map.remove(&session_for_task);
            }
        });
        return Ok(EmpDispatchResult {
            job_id,
            session_id,
            queued_only: false,
            message: format!("已开工：直接在「{workspace_for_task}」落文件"),
        });
    }

    emit_emp(
        &app,
        &employee_id,
        "working",
        "analyzing",
        &format!(
            "开始分析任务：{}",
            task.chars().take(80).collect::<String>()
        ),
    );

    let mut system = format!(
        "你是虚募阁的 AI 员工「{emp_name}」。\n\
         工作区：{workspace_root}\n\n\
         【强制工作法 · 先规划目录再写业务文件】\n\
         必须按顺序完成并在回复中体现：\n\
         1) read_file 必读 playbook（若任务中已给出路径）\n\
         2) list_dir 生成根目录，核实目录地图\n\
         3) mkdir 创建本岗位需要的子目录（分析阶段仅允许 mkdir，禁止 write_file/office_write_*）\n\
         4) 任务拆解：XU_TASKS: 编号清单，每项写明「交付物 + 相对路径」（禁止堆在根目录）\n\
         5) 无法确认：XU_NEED_CONFIRM: 逐条列出\n\
         6) 跨模块/跨端接口：先输出 XU_CROSS_MODULE: 模块 / 调用方 / 被调方 / 待对齐点，并 XU_NEED_CONFIRM，禁止先写实现\n\
         7) 无待确认项时输出 XU_PHASE: IMPLEMENT\n\
         当前阶段为「分析」：禁止写业务文件，禁止声称已创建文件。\n\
         用简洁中文。"
    );
    if !memory_preamble.is_empty() {
        system.push_str("\n\n");
        system.push_str(&memory_preamble);
    }
    system.push_str(&user_addr_suffix);
    system.push_str(qa_guard);

    let mut messages: Vec<AgentMessage> = vec![AgentMessage {
        role: "system".into(),
        content: system,
        images: None,
    }];
    for m in history {
        if m.role == "user" || m.role == "assistant" {
            messages.push(AgentMessage {
                role: m.role,
                content: m.content,
                images: None,
            });
        }
    }
    messages.push(AgentMessage {
        role: "user".into(),
        content: format!("【派活 · 请先分析再拆任务，不要写代码】\n{user_text}"),
        images: None,
    });

    let app2 = app.clone();
    let session_for_task = session_id.clone();
    let employee_for_task = employee_id.clone();
    let job_for_task = job_id.clone();
    let emp_name_for_msg = emp_name.clone();
    let project_for_mem = project_id.clone();
    let analyze_opts = AgentRunOpts {
        workspace_root: Some(PathBuf::from(&workspace_for_task)),
        read_extra_paths: read_paths,
        enable_tools: true,
        tool_mode: ToolMode::ReadOnly,
        employee_id: Some(employee_id.clone()),
        usage_source: "employee_analyze".into(),
        require_approval: false,
        ide_cli: ide_cli_opt.clone(),
        code_editor_surface: surface_opt.clone(),
        boss_granted_session: false,
        apply_global_prefs: true,
        snapshot_batch: None,
        require_write: false,
        require_canvas_write: false,
        project_id: project_id.clone(),
        project_tool_policy: project_tool_policy.clone(),
        memory_scope: Some(if project_id.is_some() {
            "project".into()
        } else {
            "employee".into()
        }),
        memory_scope_id: project_id.clone().or_else(|| Some(employee_id.clone())),
        memory_task_hint: Some(user_text.chars().take(160).collect()),
        release_gate: false,
        im_inbound: is_im_inbound_text(&user_text),
        max_tokens: None,
        disable_thinking: false,
    };

    tauri::async_runtime::spawn(async move {
        emit_emp(
            &app2,
            &employee_for_task,
            "idle",
            "queued",
            "排队中：等待执行槽…",
        );
        let project_id_for_slot = project_id_for_slot.clone();
        let runtime_for_slots = runtime_for_slots.clone();
        let _permit = match runtime_for_slots
            .acquire_employee_permit(
                project_id_for_slot.as_deref(),
                is_local_llm(&agent_endpoint.base_url),
            )
            .await
        {
            Ok(p) => p,
            Err(e) => {
                emit_emp(&app2, &employee_for_task, "blocked", "queue_full", &e);
                return;
            }
        };
        emit_emp(
            &app2,
            &employee_for_task,
            "working",
            "analyzing",
            "已获得执行槽，开始分析",
        );
        let analyze = run_agent_loop(
            &app2,
            &session_for_task,
            &agent_endpoint,
            &messages,
            analyze_opts.clone(),
            cancel.clone(),
        )
        .await;

        let xu_db = app2.state::<FouDb>().0.clone();
        let cancels = app2.state::<AgentRuntime>().cancels.clone();

        let assistant_text = match analyze {
            Ok(t) => t,
            Err(err) => {
                finish_dispatch_error(
                    &app2,
                    &FouDb(xu_db.clone()),
                    cancels.clone(),
                    &session_for_task,
                    &employee_for_task,
                    &job_for_task,
                    &emp_name_for_msg,
                    &err,
                );
                return;
            }
        };

        let need_confirm = extract_need_confirm(&assistant_text);

        {
            let conn = match xu_db.lock() {
                Ok(c) => c,
                Err(e) => e.into_inner(),
            };
            let _ = desktop_db::append_chat_message(
                &conn,
                &session_for_task,
                "assistant",
                &assistant_text,
            );
            // 方案/分析正文始终进办公室对话框；开会条另写待确认摘要
            append_office_floor_always(
                &conn,
                &employee_for_task,
                &emp_name_for_msg,
                "分析",
                &assistant_text,
            );
            if assistant_text.contains("XU_TASKS") {
                if let Some(root) = analyze_opts.workspace_root.clone() {
                    let plan_dir = root.join(".xu");
                    let _ = std::fs::create_dir_all(&plan_dir);
                    let plan_file = plan_dir.join(format!("PLAN_{employee_for_task}.md"));
                    let body = format!("# 规划 · {emp_name_for_msg}\n\n{assistant_text}");
                    let _ = std::fs::write(plan_file, body);
                }
            }
        }
        notify_office(&app2);
        if !need_confirm.is_empty() || office_floor_worthy(&assistant_text) {
            mirror_office_assistant_to_feishu(
                &app2,
                &format!("【{emp_name_for_msg} · 分析】{assistant_text}"),
            );
        }
        {
            let conn = match xu_db.lock() {
                Ok(c) => c,
                Err(e) => e.into_inner(),
            };
            let now = now_ms();
            let mem = MemoryRow {
                id: format!("mem_plan_{employee_for_task}_{now}"),
                scope: if project_for_mem.is_some() {
                    "project".into()
                } else {
                    "employee".into()
                },
                scope_id: project_for_mem
                    .clone()
                    .or_else(|| Some(employee_for_task.clone())),
                title: format!("{emp_name_for_msg} · 任务分析"),
                body: assistant_text.clone(),
                tags: "[\"auto_plan\",\"employee\"]".into(),
                source: "auto_summary".into(),
                version: 1,
                confidence: 0.8,
                expires_at: None,
                conflict_key: Some(format!("employee_plan:{employee_for_task}")),
                citation: format!("employee-session:{employee_for_task}"),
                reason: "员工完成任务分析后自动保存".into(),
                pinned: true,
                created_at: now,
                updated_at: now,
            };
            let _ = desktop_db::upsert_memory(&conn, &mem);
            let mut mem_msgs = messages.clone();
            mem_msgs.push(AgentMessage {
                role: "assistant".into(),
                content: assistant_text.clone(),
                images: None,
            });
            maybe_extract_memory(
                &conn,
                &mem_msgs,
                if project_for_mem.is_some() {
                    "project"
                } else {
                    "employee"
                },
                project_for_mem
                    .as_deref()
                    .or(Some(employee_for_task.as_str())),
                &user_text,
            );
        }

        if !need_confirm.is_empty() {
            notify_boss_need_confirm(
                &app2,
                &employee_for_task,
                &emp_name_for_msg,
                &need_confirm,
                &assistant_text,
            );

            {
                let conn = match xu_db.lock() {
                    Ok(c) => c,
                    Err(e) => e.into_inner(),
                };
                enter_meeting_confirm(
                    &conn,
                    &employee_for_task,
                    &emp_name_for_msg,
                    &job_for_task,
                    &session_for_task,
                    &need_confirm,
                    &assistant_text,
                );
            }
            {
                let mut map = match cancels.lock() {
                    Ok(m) => m,
                    Err(e) => e.into_inner(),
                };
                map.remove(&session_for_task);
            }
            emit_status(
                &app2,
                &session_for_task,
                "status",
                &format!("employee:{employee_for_task}:meeting:need_confirm"),
            );
            emit_emp(
                &app2,
                &employee_for_task,
                "meeting",
                "need_confirm",
                "开会：等待老板确认后再继续实现",
            );
            notify_office(&app2);
            return;
        }

        // No pending questions → implement phase
        {
            let conn = match xu_db.lock() {
                Ok(c) => c,
                Err(e) => e.into_inner(),
            };
            touch_dispatch_state(&conn, &employee_for_task, "implementing");
        }
        emit_emp(
            &app2,
            &employee_for_task,
            "working",
            "implementing",
            "进入实现阶段",
        );
        let mut impl_messages = messages.clone();
        impl_messages.push(AgentMessage {
            role: "assistant".into(),
            content: assistant_text.clone(),
            images: None,
        });
        impl_messages.push(AgentMessage {
            role: "user".into(),
            content: "分析阶段无待确认项。请进入实现：输出 XU_PHASE: IMPLEMENT，然后必须按 XU_TASKS 中的相对路径调用工具落盘（禁止写在根目录）。文本用 write_file；Word 用 office_write_docx；Excel 用 office_write_xlsx。".into(),
            images: None,
        });
        let mut impl_opts = analyze_opts;
        impl_opts.tool_mode = ToolMode::Full;
        impl_opts.usage_source = "employee_implement".into();
        impl_opts.require_approval = true;

        let implement = run_agent_loop(
            &app2,
            &session_for_task,
            &agent_endpoint,
            &impl_messages,
            impl_opts,
            cancel,
        )
        .await;

        match implement {
            Ok(impl_text) => {
                let text = if impl_text.trim().is_empty() {
                    "（实现阶段无额外输出）".to_string()
                } else {
                    impl_text
                };
                let mid_confirm = extract_need_confirm(&text);
                if !mid_confirm.is_empty() {
                    {
                        let conn = match xu_db.lock() {
                            Ok(c) => c,
                            Err(e) => e.into_inner(),
                        };
                        let _ = desktop_db::append_chat_message(
                            &conn,
                            &session_for_task,
                            "assistant",
                            &text,
                        );
                        append_office_floor_always(
                            &conn,
                            &employee_for_task,
                            &emp_name_for_msg,
                            "实现",
                            &text,
                        );
                        enter_meeting_confirm(
                            &conn,
                            &employee_for_task,
                            &emp_name_for_msg,
                            &job_for_task,
                            &session_for_task,
                            &mid_confirm,
                            &text,
                        );
                    }
                    notify_boss_need_confirm(
                        &app2,
                        &employee_for_task,
                        &emp_name_for_msg,
                        &mid_confirm,
                        &text,
                    );
                    emit_emp(
                        &app2,
                        &employee_for_task,
                        "meeting",
                        "need_confirm",
                        "实现中遇阻，开会等待确认",
                    );
                    notify_office(&app2);
                } else {
                    {
                        let conn = match xu_db.lock() {
                            Ok(c) => c,
                            Err(e) => e.into_inner(),
                        };
                        let _ = desktop_db::append_chat_message(
                            &conn,
                            &session_for_task,
                            "assistant",
                            &text,
                        );
                        crate::employee::deliverables::flush_deliverable_summary(
                            &app2,
                            &employee_for_task,
                            true,
                        );
                        let floor_body =
                            crate::employee::deliverables::enrich_body_with_deliverables(
                                &employee_for_task,
                                &text,
                            );
                        append_office_floor_always(
                            &conn,
                            &employee_for_task,
                            &emp_name_for_msg,
                            "实现",
                            &floor_body,
                        );
                        crate::employee::deliverables::finish_deliverable_summary(
                            &app2,
                            &employee_for_task,
                        );
                        maybe_request_delivery_review(
                            &app2,
                            &employee_for_task,
                            &job_for_task,
                            &floor_body,
                        );
                        let mirror_body = format!("【{emp_name_for_msg} · 实现】{text}");
                        let _ = desktop_db::set_employee_status(&conn, &employee_for_task, "idle");
                        let payload = serde_json::json!({
                            "jobId": job_for_task,
                            "employeeId": employee_for_task,
                            "sessionId": session_for_task,
                            "state": "done",
                            "at": now_ms(),
                        });
                        let _ = conn.execute(
                            "INSERT INTO settings(key, value) VALUES(?1, ?2)
                             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                            rusqlite::params![
                                format!("xu.dispatch.last.{employee_for_task}"),
                                payload.to_string()
                            ],
                        );
                        drop(conn);
                        mirror_office_assistant_to_feishu(&app2, &mirror_body);
                    }
                    emit_status(
                        &app2,
                        &session_for_task,
                        "status",
                        &format!("employee:{employee_for_task}:idle"),
                    );
                    emit_emp(
                        &app2,
                        &employee_for_task,
                        "idle",
                        "done",
                        "任务完成，已回灌办公室大厅",
                    );
                    notify_office(&app2);
                }
            }
            Err(err) => {
                finish_dispatch_error(
                    &app2,
                    &FouDb(xu_db.clone()),
                    cancels.clone(),
                    &session_for_task,
                    &employee_for_task,
                    &job_for_task,
                    &emp_name_for_msg,
                    &err,
                );
            }
        }

        {
            {
                let mut map = match cancels.lock() {
                    Ok(m) => m,
                    Err(e) => e.into_inner(),
                };
                map.remove(&session_for_task);
            }
        }
    });

    Ok(EmpDispatchResult {
        job_id,
        session_id,
        queued_only: false,
        message: "已受理：先分析拆任务；待确认项会 IM 通知，确认前不写代码".into(),
    })
}

fn extract_need_confirm(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let markers = [
        "XU_NEED_CONFIRM:",
        "XU_NEED_CONFIRM：",
        "XU_CROSS_MODULE:",
        "XU_CROSS_MODULE：",
    ];
    let mut start = None;
    for m in markers {
        if let Some(idx) = text.find(m) {
            start = Some(idx + m.len());
            break;
        }
    }
    if let Some(idx) = start {
        let rest = &text[idx..];
        for line in rest.lines().take(30) {
            let t = line.trim();
            if t.is_empty() {
                if !out.is_empty() {
                    break;
                }
                continue;
            }
            if t.starts_with("XU_PHASE") || t.starts_with("XU_TASKS") {
                break;
            }
            let cleaned = t
                .trim_start_matches(|c: char| {
                    c.is_ascii_digit() || matches!(c, '.' | ')' | '、' | '-' | '•' | '*')
                })
                .trim();
            if !cleaned.is_empty() {
                out.push(cleaned.to_string());
            }
            if out.len() >= 20 {
                break;
            }
        }
    }
    out
}

fn format_meeting_decision_brief(emp_name: &str, questions: &[String], analysis: &str) -> String {
    let problem = questions
        .first()
        .map(|q| q.chars().take(120).collect::<String>())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            let t = analysis.trim();
            if t.is_empty() {
                "待确认事项".into()
            } else {
                t.chars().take(120).collect()
            }
        });

    let joined = questions.join("\n");
    let mut opt_a: Option<String> = None;
    let mut opt_b: Option<String> = None;
    for q in questions {
        let t = q.trim();
        let upper = t.to_ascii_uppercase();
        if opt_a.is_none()
            && (upper.starts_with("A)")
                || upper.starts_with("A.")
                || upper.starts_with("A：")
                || upper.starts_with("A:"))
        {
            opt_a = Some(
                t.trim_start_matches(|c: char| {
                    c.is_ascii_alphabetic() || matches!(c, ')' | '.' | ':' | '：' | ' ')
                })
                .trim()
                .to_string(),
            );
        } else if opt_b.is_none()
            && (upper.starts_with("B)")
                || upper.starts_with("B.")
                || upper.starts_with("B：")
                || upper.starts_with("B:"))
        {
            opt_b = Some(
                t.trim_start_matches(|c: char| {
                    c.is_ascii_alphabetic() || matches!(c, ')' | '.' | ':' | '：' | ' ')
                })
                .trim()
                .to_string(),
            );
        }
    }
    if opt_a.is_none() {
        if let Some(idx) = joined.find("A)") {
            let rest = &joined[idx + 2..];
            let end = rest.find("B)").unwrap_or(rest.len().min(80));
            opt_a = Some(rest[..end].trim().chars().take(80).collect());
        }
    }
    if opt_b.is_none() {
        if let Some(idx) = joined.find("B)") {
            let rest = &joined[idx + 2..];
            opt_b = Some(rest.trim().chars().take(80).collect());
        }
    }
    let opt_a = opt_a.unwrap_or_else(|| "采纳员工方案".into());
    let opt_b = opt_b.unwrap_or_else(|| "暂缓/改方案".into());
    let suggestion = {
        let t = analysis.trim();
        if t.is_empty() {
            "请 Boss 在 A/B 中明确拍板".into()
        } else {
            t.chars().take(200).collect::<String>()
        }
    };
    let details = questions
        .iter()
        .enumerate()
        .map(|(i, q)| format!("{}. {q}", i + 1))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "【开会决策】\n问题：{problem}\n选项：\nA) {opt_a}\nB) {opt_b}\n员工建议：{suggestion}\n需要 Boss 拍板：是非或二选一明确问题\n明细：\n{details}\n（员工：{emp_name}）"
    )
}

fn enter_meeting_confirm(
    conn: &rusqlite::Connection,
    employee_id: &str,
    emp_name: &str,
    job_id: &str,
    session_id: &str,
    questions: &[String],
    analysis_body: &str,
) {
    let floor = format_meeting_decision_brief(emp_name, questions, analysis_body);
    append_office_floor_always(conn, employee_id, emp_name, "开会", &floor);
    let _ = desktop_db::set_employee_status(conn, employee_id, "meeting");
    let payload = serde_json::json!({
        "jobId": job_id,
        "employeeId": employee_id,
        "sessionId": session_id,
        "state": "awaiting_confirm",
        "questions": questions,
        "analysis": analysis_body.chars().take(4000).collect::<String>(),
        "at": now_ms(),
    });
    let _ = conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![
            format!("xu.dispatch.last.{employee_id}"),
            payload.to_string()
        ],
    );
}

fn notify_boss_need_confirm(
    app: &AppHandle,
    employee_id: &str,
    emp_name: &str,
    questions: &[String],
    analysis: &str,
) {
    let brief = format_meeting_decision_brief(emp_name, questions, analysis);
    let now = now_ms();
    let mut merged_body = brief.clone();
    let mut title = format!("虚募阁 · {emp_name} 开会待确认");

    if let Some(db) = app.try_state::<FouDb>() {
        if let Ok(conn) = db.0.lock() {
            let mut pending: Vec<serde_json::Value> =
                match desktop_db::setting_get(&conn, "xu.meetings.pending") {
                    Ok(Some(raw)) => serde_json::from_str(&raw).unwrap_or_default(),
                    _ => Vec::new(),
                };
            pending.retain(|p| {
                p.get("at")
                    .and_then(|v| v.as_i64())
                    .map(|at| now.saturating_sub(at) <= 10 * 60 * 1000)
                    .unwrap_or(false)
            });
            pending.push(serde_json::json!({
                "employeeId": employee_id,
                "empName": emp_name,
                "questions": questions,
                "at": now,
            }));
            let _ = desktop_db::setting_set(
                &conn,
                "xu.meetings.pending",
                &serde_json::to_string(&pending).unwrap_or_else(|_| "[]".into()),
            );
            if pending.len() > 1 {
                title = format!("虚募阁 · 合并开会待确认（{} 人）", pending.len());
                let mut lines = vec!["【开会决策 · 合并】近 10 分钟内多位员工待拍板：".to_string()];
                for p in &pending {
                    let name = p.get("empName").and_then(|v| v.as_str()).unwrap_or("员工");
                    let qs = p
                        .get("questions")
                        .and_then(|v| v.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|x| x.as_str())
                                .collect::<Vec<_>>()
                                .join("；")
                        })
                        .unwrap_or_default();
                    lines.push(format!(
                        "- {name}：{}",
                        qs.chars().take(160).collect::<String>()
                    ));
                }
                lines.push(String::new());
                lines.push(brief);
                merged_body = lines.join("\n");
            }
        }
    }

    let app_n = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::commands::channels::xu_notify_boss(
            app_n.clone(),
            app_n.state::<FouDb>(),
            "need_confirm".into(),
            title,
            merged_body,
            None,
            Some(true),
        )
        .await;
    });
}

fn finish_dispatch_error(
    app: &AppHandle,
    xu_db: &FouDb,
    cancels: Arc<std::sync::Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>>,
    session_id: &str,
    employee_id: &str,
    job_id: &str,
    emp_name: &str,
    err: &str,
) {
    let mirror_body = format!("【{emp_name} · 失败】{err}");
    if let Ok(conn) = xu_db.0.lock() {
        append_office_floor_always(&conn, employee_id, emp_name, "失败", err);
        let _ = desktop_db::set_employee_status(&conn, employee_id, "blocked");
        let payload = serde_json::json!({
            "jobId": job_id,
            "employeeId": employee_id,
            "sessionId": session_id,
            "state": "error",
            "error": err,
            "at": now_ms(),
        });
        let _ = conn.execute(
            "INSERT INTO settings(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![
                format!("xu.dispatch.last.{employee_id}"),
                payload.to_string()
            ],
        );
    }
    mirror_office_assistant_to_feishu(app, &mirror_body);
    {
        let mut map = match cancels.lock() {
            Ok(m) => m,
            Err(e) => e.into_inner(),
        };
        map.remove(session_id);
    }
    emit_status(app, session_id, "error", err);
    emit_status(
        app,
        session_id,
        "status",
        &format!("employee:{employee_id}:blocked"),
    );
    emit_emp(app, employee_id, "blocked", "error", err);
    notify_office(app);
    if err.contains("Token 套餐") || err.contains("单模型额度") {
        let app_n = app.clone();
        let body = err.to_string();
        let title = if body.contains("单模型额度") {
            "单模型额度已触顶"
        } else {
            "Token 套餐已用尽"
        };
        let kind = if body.contains("单模型额度") {
            "writing_quota"
        } else {
            "token_quota"
        };
        tauri::async_runtime::spawn(async move {
            let _ = crate::commands::channels::xu_notify_boss(
                app_n.clone(),
                app_n.state::<FouDb>(),
                kind.into(),
                title.into(),
                body,
                None,
                Some(true),
            )
            .await;
        });
    }
}

/// Boss answers meeting questions → continue implement phase.
#[tauri::command]
pub fn xu_emp_resume_after_confirm(
    app: AppHandle,
    db: State<'_, FouDb>,
    runtime: State<'_, AgentRuntime>,
    employee_id: String,
    boss_reply: String,
    endpoint: EmpEndpoint,
    workspace_root: String,
) -> Result<EmpDispatchResult, String> {
    let reply = boss_reply.trim().to_string();
    if reply.is_empty() {
        return Err("请填写对开会问题的答复".into());
    }
    if workspace_root.trim().is_empty() {
        return Err("请先为该员工设置可写工作区路径".into());
    }

    let (session_id, emp_name, job_id, analysis, read_extra, memory_preamble) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let acl = desktop_db::get_employee_acl(&conn, &employee_id)?
            .ok_or_else(|| "员工不存在".to_string())?;
        let key = format!("xu.dispatch.last.{employee_id}");
        let raw: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                rusqlite::params![key],
                |r| r.get(0),
            )
            .map_err(|_| "没有待确认的开会记录，请先派活".to_string())?;
        let v: serde_json::Value =
            serde_json::from_str(&raw).map_err(|e| format!("dispatch 状态损坏: {e}"))?;
        let state = v.get("state").and_then(|x| x.as_str()).unwrap_or("");
        if state != "awaiting_confirm" {
            return Err(format!("当前状态不是 awaiting_confirm（{state}）"));
        }
        let session_id = v
            .get("sessionId")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        if session_id.is_empty() {
            return Err("缺少 sessionId".into());
        }
        let job_id = v
            .get("jobId")
            .and_then(|x| x.as_str())
            .unwrap_or("resume")
            .to_string();
        let analysis = v
            .get("analysis")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let memory_preamble = desktop_db::build_memory_preamble(
            &conn,
            Some(&employee_id),
            Some(&acl.name),
            None,
            Some(&reply),
        )
        .unwrap_or_default();
        append_office_floor_always(
            &conn,
            &employee_id,
            &acl.name,
            "已受理",
            &format!(
                "老板开会答复：{}",
                reply.chars().take(400).collect::<String>()
            ),
        );
        let _ = desktop_db::append_chat_message(
            &conn,
            &session_id,
            "user",
            &format!("【老板开会答复】\n{reply}"),
        );
        let _ = desktop_db::set_employee_status(&conn, &employee_id, "working");
        (
            session_id,
            acl.name,
            job_id,
            analysis,
            acl.read_extra_paths,
            memory_preamble,
        )
    };
    notify_office(&app);

    let agent_endpoint = AgentEndpoint {
        provider: endpoint.provider.clone(),
        model: endpoint.model.clone(),
        base_url: endpoint.base_url.clone(),
        api_key_env: endpoint.api_key_env.clone(),
        api_format: "openai".into(),
        preset_id: String::new(),
    };
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut map = runtime.cancels.lock().map_err(|e| e.to_string())?;
        map.insert(session_id.clone(), cancel.clone());
    }
    let runtime_for_slots = AgentRuntime::clone(&runtime);
    let project_id_for_slot: Option<String> = None;
    let workspace_for_task = workspace_root.trim().to_string();
    let read_paths: Vec<PathBuf> = read_extra.into_iter().map(PathBuf::from).collect();

    let mut system = format!(
        "你是虚募阁的 AI 员工「{emp_name}」。\n\
         【可写工作区】{workspace_for_task}\n\
         老板已在开会中答复待确认项。请按分析/XU_TASKS 中的相对路径用工具落盘（禁止堆在根目录）。\n\
         用中文汇报「相对路径 + 用途」。"
    );
    if !memory_preamble.is_empty() {
        system.push_str("\n\n");
        system.push_str(&memory_preamble);
    }
    let mut messages = vec![AgentMessage {
        role: "system".into(),
        content: system,
        images: None,
    }];
    if !analysis.is_empty() {
        messages.push(AgentMessage {
            role: "assistant".into(),
            content: analysis,
            images: None,
        });
    }
    messages.push(AgentMessage {
        role: "user".into(),
        content: format!(
            "【老板开会答复 · 请继续实现】\n{reply}\n\n输出 XU_PHASE: IMPLEMENT 并用工具落盘。"
        ),
        images: None,
    });

    let impl_opts = AgentRunOpts {
        workspace_root: Some(PathBuf::from(&workspace_for_task)),
        read_extra_paths: read_paths,
        enable_tools: true,
        tool_mode: ToolMode::Full,
        employee_id: Some(employee_id.clone()),
        usage_source: "employee_resume_implement".into(),
        require_approval: true,
        ide_cli: None,
        code_editor_surface: None,
        boss_granted_session: false,
        apply_global_prefs: true,
        snapshot_batch: None,
        require_write: false,
        require_canvas_write: false,
        project_id: None,
        project_tool_policy: None,
        memory_scope: Some("employee".into()),
        memory_scope_id: Some(employee_id.clone()),
        memory_task_hint: Some(reply.chars().take(160).collect()),
        release_gate: false,
        im_inbound: false,
        max_tokens: None,
        disable_thinking: false,
    };
    let app2 = app.clone();
    let session_for_task = session_id.clone();
    let employee_for_task = employee_id.clone();
    let job_for_task = job_id.clone();
    let emp_name_for_msg = emp_name.clone();

    tauri::async_runtime::spawn(async move {
        let project_id_for_slot = project_id_for_slot.clone();
        let runtime_for_slots = runtime_for_slots.clone();
        let _permit = match runtime_for_slots
            .acquire_employee_permit(
                project_id_for_slot.as_deref(),
                is_local_llm(&agent_endpoint.base_url),
            )
            .await
        {
            Ok(p) => p,
            Err(e) => {
                emit_emp(&app2, &employee_for_task, "blocked", "queue_full", &e);
                return;
            }
        };
        emit_emp(
            &app2,
            &employee_for_task,
            "working",
            "implementing",
            "开会后继续实现…",
        );
        let result = run_agent_loop(
            &app2,
            &session_for_task,
            &agent_endpoint,
            &messages,
            impl_opts,
            cancel,
        )
        .await;
        let xu_db = app2.state::<FouDb>().0.clone();
        let cancels = app2.state::<AgentRuntime>().cancels.clone();
        match result {
            Ok(text) => {
                let body = if text.trim().is_empty() {
                    "（已实现，无文本汇报）".into()
                } else {
                    text
                };
                {
                    let conn = match xu_db.lock() {
                        Ok(c) => c,
                        Err(e) => e.into_inner(),
                    };
                    let _ = desktop_db::append_chat_message(
                        &conn,
                        &session_for_task,
                        "assistant",
                        &body,
                    );
                    crate::employee::deliverables::flush_deliverable_summary(
                        &app2,
                        &employee_for_task,
                        true,
                    );
                    let floor_body = crate::employee::deliverables::enrich_body_with_deliverables(
                        &employee_for_task,
                        &body,
                    );
                    append_office_floor_always(
                        &conn,
                        &employee_for_task,
                        &emp_name_for_msg,
                        "实现",
                        &floor_body,
                    );
                    crate::employee::deliverables::finish_deliverable_summary(
                        &app2,
                        &employee_for_task,
                    );
                    maybe_request_delivery_review(
                        &app2,
                        &employee_for_task,
                        &job_for_task,
                        &floor_body,
                    );
                    let _ = desktop_db::set_employee_status(&conn, &employee_for_task, "idle");
                    let payload = serde_json::json!({
                        "jobId": job_for_task,
                        "employeeId": employee_for_task,
                        "sessionId": session_for_task,
                        "state": "done",
                        "at": now_ms(),
                    });
                    let _ = conn.execute(
                        "INSERT INTO settings(key, value) VALUES(?1, ?2)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        rusqlite::params![
                            format!("xu.dispatch.last.{employee_for_task}"),
                            payload.to_string()
                        ],
                    );
                    drop(conn);
                    mirror_office_assistant_to_feishu(
                        &app2,
                        &format!("【{emp_name_for_msg} · 实现】{floor_body}"),
                    );
                }
                emit_emp(&app2, &employee_for_task, "idle", "done", "开会后已实现");
                notify_office(&app2);
            }
            Err(err) => {
                finish_dispatch_error(
                    &app2,
                    &FouDb(xu_db),
                    cancels.clone(),
                    &session_for_task,
                    &employee_for_task,
                    &job_for_task,
                    &emp_name_for_msg,
                    &err,
                );
            }
        }
        {
            let mut map = match cancels.lock() {
                Ok(m) => m,
                Err(e) => e.into_inner(),
            };
            map.remove(&session_for_task);
        }
    });

    Ok(EmpDispatchResult {
        job_id,
        session_id,
        queued_only: false,
        message: "已根据开会答复继续实现".into(),
    })
}

#[tauri::command]
pub fn xu_emp_dispatch_status(
    db: State<'_, FouDb>,
    employee_id: String,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let key = format!("xu.dispatch.last.{employee_id}");
    Ok(conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![key],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "{}".into()))
}

fn touch_dispatch_state(conn: &rusqlite::Connection, employee_id: &str, state: &str) {
    let key = format!("xu.dispatch.last.{employee_id}");
    if let Ok(Some(raw)) = desktop_db::setting_get(conn, &key) {
        if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(obj) = v.as_object_mut() {
                obj.insert("state".into(), serde_json::json!(state));
                obj.insert("at".into(), serde_json::json!(now_ms()));
                let _ = desktop_db::setting_set(conn, &key, &v.to_string());
            }
        }
    }
}

fn endpoint_from_checkpoint(v: &serde_json::Value) -> AgentEndpoint {
    AgentEndpoint {
        provider: v
            .get("provider")
            .and_then(|x| x.as_str())
            .unwrap_or("custom")
            .into(),
        model: v.get("model").and_then(|x| x.as_str()).unwrap_or("").into(),
        base_url: v
            .get("baseUrl")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .into(),
        api_key_env: v
            .get("apiKeyEnv")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .into(),
        api_format: v
            .get("apiFormat")
            .and_then(|x| x.as_str())
            .unwrap_or("openai")
            .into(),
        preset_id: v
            .get("presetId")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .into(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeDispatchSummary {
    pub scanned: u32,
    pub resumed: u32,
    pub meeting: u32,
    pub skipped: u32,
    pub errors: Vec<String>,
}

/// Cold start: resume interrupted employee dispatches from `xu.dispatch.last.*` checkpoints.
#[tauri::command]
pub fn xu_resume_interrupted_dispatches(
    app: AppHandle,
    db: State<'_, FouDb>,
    runtime: State<'_, AgentRuntime>,
    max_resume: Option<u32>,
) -> Result<ResumeDispatchSummary, String> {
    let cap = max_resume.unwrap_or(u32::MAX);
    let rows = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        desktop_db::list_settings_prefixed(&conn, "xu.dispatch.last.")?
    };
    let mut summary = ResumeDispatchSummary {
        scanned: 0,
        resumed: 0,
        meeting: 0,
        skipped: 0,
        errors: Vec::new(),
    };
    for (key, raw) in rows {
        let employee_id = key
            .strip_prefix("xu.dispatch.last.")
            .unwrap_or("")
            .to_string();
        if employee_id.is_empty() {
            continue;
        }
        summary.scanned += 1;
        let v: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                summary.errors.push(format!("{employee_id}: 状态损坏 {e}"));
                continue;
            }
        };
        let state = v
            .get("state")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        match state.as_str() {
            "done" | "error" => {
                summary.skipped += 1;
            }
            "awaiting_confirm" => {
                if let Ok(conn) = db.0.lock() {
                    let emp_name = desktop_db::get_employee_name(&conn, &employee_id)
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| employee_id.clone());
                    let _ = desktop_db::set_employee_status(&conn, &employee_id, "meeting");
                    append_office_floor_always(
                        &conn,
                        &employee_id,
                        &emp_name,
                        "断点恢复",
                        "进程中断前正在开会待确认；请 Boss 在对话框答复后继续。",
                    );
                }
                summary.meeting += 1;
            }
            "analyzing" | "implementing" => {
                if summary.resumed >= cap {
                    summary.skipped += 1;
                    if let Ok(conn) = db.0.lock() {
                        let emp_name = desktop_db::get_employee_name(&conn, &employee_id)
                            .ok()
                            .flatten()
                            .unwrap_or_else(|| employee_id.clone());
                        append_office_floor_always(
                            &conn,
                            &employee_id,
                            &emp_name,
                            "断点待续",
                            &format!(
                                "检查点保留中；本轮冷启动已恢复 {} 人，请稍后在「工作监控」分批继续。",
                                cap
                            ),
                        );
                    }
                    continue;
                }
                match spawn_resume_dispatch(
                    app.clone(),
                    AgentRuntime::clone(&runtime),
                    FouDb(db.0.clone()),
                    employee_id.clone(),
                    v,
                ) {
                    Ok(()) => summary.resumed += 1,
                    Err(e) => summary.errors.push(format!("{employee_id}: {e}")),
                }
            }
            _ => summary.skipped += 1,
        }
    }
    if summary.resumed > 0 || summary.meeting > 0 || (cap < u32::MAX && summary.skipped > 0) {
        let msg = format!(
            "🔄 断点续跑：已恢复 {} 人继续工作，{} 人仍待开会确认{}{}",
            summary.resumed,
            summary.meeting,
            if cap < u32::MAX && summary.skipped > 0 {
                format!(
                    "；另有 {} 人检查点保留（防整机过载，请分批续跑）",
                    summary.skipped
                )
            } else {
                String::new()
            },
            if summary.errors.is_empty() {
                String::new()
            } else {
                format!("（{} 条失败）", summary.errors.len())
            }
        );
        if let Ok(conn) = db.0.lock() {
            let _ = desktop_db::append_message(
                &conn,
                &MessageRow {
                    id: format!("om_resume_{}", now_ms()),
                    session_tag: "office-floor".into(),
                    employee_id: None,
                    role: "system".into(),
                    content: msg,
                    image_path: None,
                    created_at: now_ms(),
                },
            );
        }
        notify_office(&app);
    }
    Ok(summary)
}

fn spawn_resume_dispatch(
    app: AppHandle,
    runtime: AgentRuntime,
    db: FouDb,
    employee_id: String,
    cp: serde_json::Value,
) -> Result<(), String> {
    let session_id = cp
        .get("sessionId")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let workspace = cp
        .get("workspaceRoot")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let task = cp
        .get("task")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let job_id = cp
        .get("jobId")
        .and_then(|x| x.as_str())
        .unwrap_or("resume")
        .to_string();
    let state = cp
        .get("state")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let direct = cp
        .get("directImplement")
        .and_then(|x| x.as_bool())
        .unwrap_or(false);
    let project_id = cp
        .get("projectId")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    if session_id.is_empty() || workspace.is_empty() {
        return Err("checkpoint 缺少 sessionId 或 workspaceRoot".into());
    }
    let agent_endpoint = endpoint_from_checkpoint(&cp);
    if agent_endpoint.model.trim().is_empty() || agent_endpoint.base_url.trim().is_empty() {
        return Err("checkpoint 缺少模型配置".into());
    }

    let (emp_name, read_extra, history) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let acl = desktop_db::get_employee_acl(&conn, &employee_id)?
            .ok_or_else(|| "员工不存在".to_string())?;
        let history = desktop_db::list_chat_messages(&conn, &session_id, 48)?;
        let _ = desktop_db::set_employee_status(&conn, &employee_id, "working");
        append_office_floor_always(
            &conn,
            &employee_id,
            &acl.name,
            "断点续跑",
            "检测到进程中断，从上次派活检查点继续…",
        );
        (acl.name, acl.read_extra_paths, history)
    };

    let read_paths: Vec<PathBuf> = read_extra.into_iter().map(PathBuf::from).collect();
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut map = runtime.cancels.lock().map_err(|e| e.to_string())?;
        map.insert(session_id.clone(), cancel.clone());
    }

    emit_emp(
        &app,
        &employee_id,
        "working",
        "resume",
        "断点续跑：继续上次任务…",
    );

    let app2 = app.clone();
    let session_for_task = session_id.clone();
    let employee_for_task = employee_id.clone();
    let job_for_task = job_id.clone();
    let emp_name_for_msg = emp_name.clone();
    let project_id_for_slot = project_id.clone();
    let runtime_for_slots = AgentRuntime::clone(&runtime);
    let user_text = task.clone();

    tauri::async_runtime::spawn(async move {
        let _permit = match runtime_for_slots
            .acquire_employee_permit(
                project_id_for_slot.as_deref(),
                is_local_llm(&agent_endpoint.base_url),
            )
            .await
        {
            Ok(p) => p,
            Err(e) => {
                emit_emp(&app2, &employee_for_task, "blocked", "queue_full", &e);
                return;
            }
        };

        let memory_preamble = {
            let conn = match db.0.lock() {
                Ok(c) => c,
                Err(e) => e.into_inner(),
            };
            desktop_db::build_memory_preamble(
                &conn,
                Some(&employee_for_task),
                Some(&emp_name_for_msg),
                project_id_for_slot.as_deref(),
                Some(&user_text),
            )
            .unwrap_or_default()
        };

        let last_assistant = history
            .iter()
            .rev()
            .find(|m| m.role == "assistant")
            .map(|m| m.content.clone());

        let go_implement = direct
            || state == "implementing"
            || last_assistant
                .as_ref()
                .map(|t| extract_need_confirm(t).is_empty() && !t.trim().is_empty())
                .unwrap_or(false);

        if go_implement {
            let mut system = format!(
                "你是虚募阁的 AI 员工「{emp_name_for_msg}」。\n\
                 【可写工作区】{workspace}\n\
                 【断点续跑】进程曾中断，请从当前会话上下文继续，把未完成的文件落盘。\n\
                 【强制】所有新建/修改必须通过工具完成；文本用 write_file；Word/Excel/PPT 用 office_write_*。\n\
                 禁止空口声称已创建文件。"
            );
            if !memory_preamble.is_empty() {
                system.push_str("\n\n");
                system.push_str(&memory_preamble);
            }
            let mut messages: Vec<AgentMessage> = vec![AgentMessage {
                role: "system".into(),
                content: system,
                images: None,
            }];
            for m in &history {
                if m.role == "user" || m.role == "assistant" {
                    messages.push(AgentMessage {
                        role: m.role.clone(),
                        content: m.content.clone(),
                        images: None,
                    });
                }
            }
            if messages.iter().all(|m| m.role != "user") {
                messages.push(AgentMessage {
                    role: "user".into(),
                    content: format!("【断点续跑 · 继续实现】\n{user_text}"),
                    images: None,
                });
            } else {
                messages.push(AgentMessage {
                    role: "user".into(),
                    content: "【断点续跑】请继续上次未完成的实现，必须调用工具落盘。".into(),
                    images: None,
                });
            }
            let impl_opts = AgentRunOpts {
                workspace_root: Some(PathBuf::from(&workspace)),
                read_extra_paths: read_paths.clone(),
                enable_tools: true,
                tool_mode: ToolMode::Full,
                employee_id: Some(employee_for_task.clone()),
                usage_source: "employee_resume_implement".into(),
                require_approval: true,
                boss_granted_session: false,
                ide_cli: None,
                code_editor_surface: None,
                apply_global_prefs: true,
                snapshot_batch: None,
                require_write: false,
                require_canvas_write: false,
                project_id: None,
                project_tool_policy: None,
                memory_scope: Some("employee".into()),
                memory_scope_id: Some(employee_for_task.clone()),
                memory_task_hint: Some("断点续跑".into()),
                release_gate: false,
                im_inbound: false,
                max_tokens: None,
                disable_thinking: false,
            };
            emit_emp(
                &app2,
                &employee_for_task,
                "working",
                "implementing",
                "断点续跑：继续实现…",
            );
            let xu_db = db.0.clone();
            let cancels = app2.state::<AgentRuntime>().cancels.clone();
            let result = run_agent_loop(
                &app2,
                &session_for_task,
                &agent_endpoint,
                &messages,
                impl_opts,
                cancel,
            )
            .await;
            match result {
                Ok(body) => {
                    let conn = match xu_db.lock() {
                        Ok(c) => c,
                        Err(e) => e.into_inner(),
                    };
                    let _ = desktop_db::append_chat_message(
                        &conn,
                        &session_for_task,
                        "assistant",
                        &body,
                    );
                    let floor_body = crate::employee::deliverables::enrich_body_with_deliverables(
                        &employee_for_task,
                        &body,
                    );
                    append_office_floor_always(
                        &conn,
                        &employee_for_task,
                        &emp_name_for_msg,
                        "落地",
                        &floor_body,
                    );
                    let _ = desktop_db::set_employee_status(&conn, &employee_for_task, "idle");
                    touch_dispatch_state(&conn, &employee_for_task, "done");
                    emit_emp(&app2, &employee_for_task, "idle", "done", "断点续跑完成");
                    notify_office(&app2);
                }
                Err(err) => {
                    finish_dispatch_error(
                        &app2,
                        &FouDb(xu_db),
                        cancels,
                        &session_for_task,
                        &employee_for_task,
                        &job_for_task,
                        &emp_name_for_msg,
                        &err,
                    );
                }
            }
            return;
        }

        // Resume analyze phase
        let mut system = format!(
            "你是虚募阁的 AI 员工「{emp_name_for_msg}」。\n\
             工作区：{workspace}\n\
             【断点续跑】请继续分析阶段（只读工具），输出 XU_TASKS / XU_NEED_CONFIRM / XU_PHASE。"
        );
        if !memory_preamble.is_empty() {
            system.push_str("\n\n");
            system.push_str(&memory_preamble);
        }
        let mut messages: Vec<AgentMessage> = vec![AgentMessage {
            role: "system".into(),
            content: system,
            images: None,
        }];
        for m in &history {
            if m.role == "user" || m.role == "assistant" {
                messages.push(AgentMessage {
                    role: m.role.clone(),
                    content: m.content.clone(),
                    images: None,
                });
            }
        }
        if messages.iter().all(|m| m.role != "user") {
            messages.push(AgentMessage {
                role: "user".into(),
                content: format!("【派活 · 请先分析】\n{user_text}"),
                images: None,
            });
        }
        let analyze_opts = AgentRunOpts {
            workspace_root: Some(PathBuf::from(&workspace)),
            read_extra_paths: read_paths,
            enable_tools: true,
            tool_mode: ToolMode::ReadOnly,
            employee_id: Some(employee_for_task.clone()),
            usage_source: "employee_resume_analyze".into(),
            require_approval: false,
            boss_granted_session: false,
            ide_cli: None,
            code_editor_surface: None,
            apply_global_prefs: true,
            snapshot_batch: None,
            require_write: false,
            require_canvas_write: false,
            project_id: project_id.clone(),
            project_tool_policy: None,
            memory_scope: Some(if project_id.is_some() {
                "project".into()
            } else {
                "employee".into()
            }),
            memory_scope_id: project_id
                .clone()
                .or_else(|| Some(employee_for_task.clone())),
            memory_task_hint: Some(user_text.chars().take(160).collect()),
            release_gate: false,
            im_inbound: is_im_inbound_text(&user_text),
            max_tokens: None,
            disable_thinking: false,
        };
        emit_emp(
            &app2,
            &employee_for_task,
            "working",
            "analyzing",
            "断点续跑：继续分析…",
        );
        let xu_db = db.0.clone();
        let cancels = app2.state::<AgentRuntime>().cancels.clone();
        match run_agent_loop(
            &app2,
            &session_for_task,
            &agent_endpoint,
            &messages,
            analyze_opts,
            cancel,
        )
        .await
        {
            Ok(text) => {
                let need = extract_need_confirm(&text);
                let conn = match xu_db.lock() {
                    Ok(c) => c,
                    Err(e) => e.into_inner(),
                };
                let _ =
                    desktop_db::append_chat_message(&conn, &session_for_task, "assistant", &text);
                append_office_floor_always(
                    &conn,
                    &employee_for_task,
                    &emp_name_for_msg,
                    "分析",
                    &text,
                );
                if !need.is_empty() {
                    enter_meeting_confirm(
                        &conn,
                        &employee_for_task,
                        &emp_name_for_msg,
                        &job_for_task,
                        &session_for_task,
                        &need,
                        &text,
                    );
                    emit_emp(
                        &app2,
                        &employee_for_task,
                        "meeting",
                        "need_confirm",
                        "断点续跑：待开会确认",
                    );
                } else {
                    touch_dispatch_state(&conn, &employee_for_task, "implementing");
                    let _ = desktop_db::set_employee_status(&conn, &employee_for_task, "working");
                    drop(conn);
                    // Chain into implement with analysis result
                    let mut cp2 = cp.clone();
                    if let Some(obj) = cp2.as_object_mut() {
                        obj.insert("state".into(), serde_json::json!("implementing"));
                    }
                    let _ = spawn_resume_dispatch(
                        app2.clone(),
                        runtime_for_slots,
                        FouDb(xu_db),
                        employee_for_task,
                        cp2,
                    );
                }
                notify_office(&app2);
            }
            Err(err) => {
                finish_dispatch_error(
                    &app2,
                    &FouDb(xu_db),
                    cancels,
                    &session_for_task,
                    &employee_for_task,
                    &job_for_task,
                    &emp_name_for_msg,
                    &err,
                );
            }
        }
    });

    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopDispatchesResult {
    pub cancelled_sessions: u32,
    pub approvals_denied: u32,
    pub employees_reset: u32,
    pub checkpoints_cleared: u32,
}

fn cancel_session(runtime: &AgentRuntime, session_id: &str) -> bool {
    let map = match runtime.cancels.lock() {
        Ok(m) => m,
        Err(e) => e.into_inner(),
    };
    if let Some(flag) = map.get(session_id) {
        flag.store(true, Ordering::Relaxed);
        true
    } else {
        false
    }
}

fn deny_pending_approvals(runtime: &AgentRuntime) -> u32 {
    let mut map = match runtime.approvals.lock() {
        Ok(m) => m,
        Err(e) => e.into_inner(),
    };
    let n = map.len() as u32;
    for (_, tx) in map.drain() {
        let _ = tx.send(false);
    }
    n
}

fn dispatch_session_id(conn: &rusqlite::Connection, employee_id: &str) -> Option<String> {
    let key = format!("xu.dispatch.last.{employee_id}");
    let raw = desktop_db::setting_get(conn, &key).ok().flatten()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("sessionId")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Boss 广播「停止工作」：取消所有在跑 Agent、拒绝待审批、清检查点、员工改 idle。
#[tauri::command]
pub fn xu_stop_all_employee_dispatches(
    app: AppHandle,
    db: State<'_, FouDb>,
    runtime: State<'_, AgentRuntime>,
) -> Result<StopDispatchesResult, String> {
    let busy_ids: Vec<String> = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id FROM employees WHERE status IN ('working', 'meeting')")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let cancelled_sessions: u32;
    {
        let map = runtime.cancels.lock().map_err(|e| e.to_string())?;
        cancelled_sessions = map.len() as u32;
        for flag in map.values() {
            flag.store(true, Ordering::Relaxed);
        }
    }

    let approvals_denied = deny_pending_approvals(&runtime);

    let (employees_reset, checkpoints_cleared, checkpoint_employee_ids) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let keys = desktop_db::list_settings_prefixed(&conn, "xu.dispatch.last.")?;
        let checkpoint_employee_ids: Vec<String> = keys
            .iter()
            .filter_map(|(k, _)| k.strip_prefix("xu.dispatch.last.").map(String::from))
            .collect();
        let checkpoints_cleared = keys.len() as u32;
        for (key, _) in &keys {
            let _ = conn.execute(
                "DELETE FROM settings WHERE key = ?1",
                rusqlite::params![key],
            );
        }
        let employees_reset = desktop_db::reset_busy_employees(&conn)?;
        (
            employees_reset,
            checkpoints_cleared,
            checkpoint_employee_ids,
        )
    };

    let mut notified: std::collections::HashSet<String> = std::collections::HashSet::new();
    for eid in busy_ids.iter().chain(checkpoint_employee_ids.iter()) {
        if notified.insert(eid.clone()) {
            crate::employee::events::emit_employee_event(
                &app,
                eid,
                "idle",
                "stopped",
                "Boss 已下令停止工作",
            );
        }
    }

    Ok(StopDispatchesResult {
        cancelled_sessions,
        approvals_denied,
        employees_reset,
        checkpoints_cleared,
    })
}

/// 停止单个员工的派活（@某人 停止工作）。
#[tauri::command]
pub fn xu_stop_employee_dispatch(
    app: AppHandle,
    db: State<'_, FouDb>,
    runtime: State<'_, AgentRuntime>,
    employee_id: String,
) -> Result<bool, String> {
    let eid = employee_id.trim();
    if eid.is_empty() {
        return Err("employeeId 为空".into());
    }

    let session_id = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        dispatch_session_id(&conn, eid)
    };

    let cancelled = session_id
        .as_deref()
        .map(|sid| cancel_session(&runtime, sid))
        .unwrap_or(false);

    deny_pending_approvals(&runtime);

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let _ = conn.execute(
            "DELETE FROM settings WHERE key = ?1",
            rusqlite::params![format!("xu.dispatch.last.{eid}")],
        );
        let _ = desktop_db::set_employee_status(&conn, eid, "idle");
    }

    crate::employee::events::emit_employee_event(
        &app,
        eid,
        "idle",
        "stopped",
        "Boss 已下令停止工作",
    );

    Ok(cancelled)
}
