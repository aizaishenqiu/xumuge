//! 实验性桌面 GUI provider 与安全包装；当前仅提供 Windows 坐标/SendKeys fallback。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @version 1.1.0
//! @category ToolPolicy
//! @algo target-bound-step-verification

use std::fs;
use std::io::Write;
use std::process::Command;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use super::gui_record;
use super::gui_safety;
use super::gui_uia;
use super::process_control::configure_background;
use super::tools::PathSandbox;

fn audit(sandbox: &PathSandbox, line: &str) {
    let dir = sandbox.workspace.join("qa");
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("gui-audit.log");
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let _ = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| writeln!(f, "{ts}\t{line}"));
}

fn require_consent(sandbox: &PathSandbox) -> Option<String> {
    if sandbox.gui_consent && sandbox.gui_experimental {
        None
    } else if !sandbox.gui_experimental {
        Some("GUI 自动化实验灰度未开启；当前 provider 不属于正式可用能力".into())
    } else {
        Some(
            "GUI 工具未授权：请在工作区创建 `.xu/gui-consent`（内容 1）或设置 XU_GUI_CONSENT=1"
                .into(),
        )
    }
}

fn validate_bound_step(
    sandbox: &PathSandbox,
    args: &Value,
) -> Result<gui_safety::GuiProviderKind, String> {
    if !gui_record::real_input_monitor_healthy() {
        return Err("真实输入 monitor 未 armed/healthy，禁止 GUI 注入".into());
    }
    let epoch = args
        .get("inputEpoch")
        .and_then(Value::as_u64)
        .ok_or("GUI 动作缺少捕获时的 inputEpoch")?;
    let (_, provider) =
        gui_safety::validate_action(args, &sandbox.gui_window_allowlist, epoch)?;
    match provider {
        gui_safety::GuiProviderKind::CoordinateExperimental
        | gui_safety::GuiProviderKind::WindowsUiaExperimental => Ok(provider),
    }
}

/// Immediately latches GUI emergency stop. No injected input is performed.
#[tauri::command]
pub fn xu_gui_emergency_stop() {
    gui_safety::emergency_stop();
}

/// Manually resets the GUI stop latch after the user has checked the target window.
#[tauri::command]
pub fn xu_gui_reset_emergency_stop() {
    gui_safety::reset_emergency_stop();
}

/// Returns the physical-input epoch to bind into a future approved GUI step.
#[tauri::command]
pub fn xu_gui_input_epoch() -> u64 {
    gui_safety::real_input_epoch()
}

/// Arms the physical-input monitor; Windows hook failure is returned for fouAlert.
#[tauri::command]
pub fn xu_gui_arm_input_monitor() -> Result<(), String> {
    gui_record::start_real_input_monitor()
}

fn tool_def(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required
            }
        }
    })
}

/// Launches an approved desktop app under experimental GUI consent.
pub fn tool_app_launch(sandbox: &PathSandbox, args: &Value) -> String {
    if let Some(e) = require_consent(sandbox) {
        return e;
    }
    if !gui_record::real_input_monitor_healthy() {
        return "真实输入 monitor 未 armed/healthy，禁止启动 GUI 应用".into();
    }
    let program = args.get("program").and_then(|v| v.as_str()).unwrap_or("");
    if program.is_empty() {
        return "app_launch 需要 program".into();
    }
    let arg_list: Vec<String> = args
        .get("args")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    audit(
        sandbox,
        &format!("app_launch program={program} args={arg_list:?}"),
    );
    let mut command = Command::new(program);
    command.args(&arg_list);
    configure_background(&mut command);
    match command.spawn() {
        Ok(child) => format!("已启动 {program} pid={}", child.id()),
        Err(e) => format!("启动失败: {e}"),
    }
}

/// Captures the primary screen into a sandboxed workspace path.
pub fn tool_screenshot_window(sandbox: &PathSandbox, args: &Value) -> String {
    screenshot_window_result(sandbox, args).unwrap_or_else(|error| error)
}

fn screenshot_window_result(sandbox: &PathSandbox, args: &Value) -> Result<String, String> {
    if let Some(e) = require_consent(sandbox) {
        return Err(e);
    }
    let out_name = args
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("qa/gui-shot.png");
    let out = match sandbox.resolve_write(out_name) {
        Ok(p) => p,
        Err(e) => return Err(e),
    };
    if let Some(parent) = out.parent() {
        let _ = fs::create_dir_all(parent);
    }
    audit(sandbox, &format!("screenshot_window -> {}", out.display()));

    let window_id = args
        .get("target")
        .and_then(|t| t.get("windowId"))
        .or_else(|| args.get("windowId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());

    if let Some(wid) = window_id {
        let ps = format!(
            r#"Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinCap {{
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, int nFlags);
}}
'@
$hwnd = [IntPtr]{wid}
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width,$b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size)
if ([WinCap]::PrintWindow($hwnd, $g.GetHdc(), 2)) {{
  $g.ReleaseHdc()
}} else {{
  $g.Dispose(); $bmp.Dispose()
  $bmp = New-Object System.Drawing.Bitmap $b.Width,$b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size)
}}
$bmp.Save('{out}')
$g.Dispose(); $bmp.Dispose()"#,
            wid = wid,
            out = out.display().to_string().replace('\'', "''"),
        );
        let mut command = Command::new("powershell");
        command.args(["-NoProfile", "-NonInteractive", "-Command", &ps]);
        configure_background(&mut command);
        match command.output() {
            Ok(o) if o.status.success() => {
                return Ok(format!("窗口截图已保存 {}", out.display()));
            }
            Ok(o) => {
                return Err(format!(
                    "窗口截图失败: {}",
                    String::from_utf8_lossy(&o.stderr)
                        .chars()
                        .take(400)
                        .collect::<String>()
                ));
            }
            Err(e) => return Err(format!("窗口截图进程失败: {e}")),
        }
    }

    let ps = format!(
        r#"Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('{}'); $g.Dispose(); $bmp.Dispose()"#,
        out.display().to_string().replace('\'', "''")
    );
    let mut command = Command::new("powershell");
    command.args(["-NoProfile", "-NonInteractive", "-Command", &ps]);
    configure_background(&mut command);
    match command.output() {
        Ok(o) if o.status.success() => Ok(format!("截图已保存 {}", out.display())),
        Ok(o) => Err(format!(
            "截图失败: {}",
            String::from_utf8_lossy(&o.stderr)
                .chars()
                .take(400)
                .collect::<String>()
        )),
        Err(e) => Err(format!("截图进程失败: {e}")),
    }
}

/// Captures and verifies the foreground target binding without injecting input.
pub fn tool_gui_bind_target(sandbox: &PathSandbox, _args: &Value) -> String {
    if let Some(error) = require_consent(sandbox) {
        return error;
    }
    let target = match gui_safety::capture_target() {
        Ok(target) => target,
        Err(error) => return error,
    };
    if !sandbox
        .gui_window_allowlist
        .iter()
        .any(|allowed| target.title.contains(allowed))
    {
        return format!("前台窗口不在 GUI 白名单：{}", target.title);
    }
    let shot = tool_screenshot_window(
        sandbox,
        &json!({ "path": "qa/gui-target-binding.png", "target": target }),
    );
    if !shot.contains("截图已保存") && !shot.contains("窗口截图已保存") {
        return format!("目标绑定截图失败：{shot}");
    }
    json!({
        "status": "experimental",
        "provider": "windows_uia_experimental",
        "target": target,
        "inputEpoch": gui_safety::real_input_epoch(),
        "screenshot": "qa/gui-target-binding.png"
    })
    .to_string()
}

/// Executes one target-bound approved experimental click with before/after evidence.
pub fn tool_input_click(sandbox: &PathSandbox, args: &Value) -> String {
    input_click_result(sandbox, args).unwrap_or_else(|error| error)
}

fn click_coordinates(args: &Value) -> Result<(i32, i32), String> {
    let x = args
        .get("x")
        .and_then(Value::as_i64)
        .ok_or("input_click 需要整数 x")?;
    let y = args
        .get("y")
        .and_then(Value::as_i64)
        .ok_or("input_click 需要整数 y")?;
    Ok((
        i32::try_from(x).map_err(|_| "input_click x 超出 Windows 坐标范围")?,
        i32::try_from(y).map_err(|_| "input_click y 超出 Windows 坐标范围")?,
    ))
}

fn resolve_click_coords(args: &Value, target: &gui_safety::GuiTargetBinding) -> Result<(i32, i32), String> {
    let (x, y) = click_coordinates(args)?;
    let space = args
        .get("coordSpace")
        .and_then(Value::as_str)
        .unwrap_or("client")
        .to_ascii_lowercase();
    if space == "screen" {
        return Ok((x, y));
    }
    let origin = target
        .screen_origin
        .as_ref()
        .ok_or("client 坐标需要绑定时的 screenOrigin")?;
    Ok(gui_uia::client_to_screen(origin, x, y))
}

fn input_click_result(sandbox: &PathSandbox, args: &Value) -> Result<String, String> {
    if let Some(e) = require_consent(sandbox) {
        return Err(e);
    }
    validate_bound_step(sandbox, args)?;
    let (target, _provider) = {
        let epoch = args.get("inputEpoch").and_then(Value::as_u64).unwrap_or(0);
        gui_safety::validate_action(args, &sandbox.gui_window_allowlist, epoch)?
    };
    let (x, y) = resolve_click_coords(args, &target)?;
    screenshot_window_result(
        sandbox,
        &json!({ "path": "qa/gui-before-click.png", "target": target }),
    )
    .map_err(|error| format!("动作前状态验证失败：{error}"))?;
    validate_bound_step(sandbox, args)?;
    audit(sandbox, &format!("input_click x={x} y={y}"));
    #[cfg(windows)]
    {
        if let Err(error) = gui_uia::send_mouse_click_screen(x, y) {
            return Err(error);
        }
    }
    #[cfg(not(windows))]
    {
        let ps = format!(
            r#"Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class W{{[DllImport(\"user32.dll\")]public static extern bool SetCursorPos(int X,int Y);[DllImport(\"user32.dll\")]public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);}}'; [W]::SetCursorPos({x},{y}); [W]::mouse_event(0x0002,0,0,0,0); [W]::mouse_event(0x0004,0,0,0,0)"#
        );
        let mut command = Command::new("powershell");
        command.args(["-NoProfile", "-NonInteractive", "-Command", &ps]);
        configure_background(&mut command);
        match command.output() {
            Ok(o) if !o.status.success() => {
                return Err(format!(
                    "点击失败: {}",
                    String::from_utf8_lossy(&o.stderr)
                        .chars()
                        .take(300)
                        .collect::<String>()
                ));
            }
            Err(e) => return Err(format!("点击进程失败: {e}")),
            _ => {}
        }
    }
    match screenshot_window_result(
        sandbox,
        &json!({ "path": "qa/gui-after-click.png", "target": target }),
    ) {
        Ok(_) => Ok(format!(
            "已点击 ({x},{y})；动作前后截图已保存（experimental）"
        )),
        Err(error) => {
            gui_safety::emergency_stop();
            Err(format!("点击后状态验证失败，已急停：{error}"))
        }
    }
}

/// Executes one target-bound approved experimental text input with before/after evidence.
pub fn tool_input_type(sandbox: &PathSandbox, args: &Value) -> String {
    input_type_result(sandbox, args).unwrap_or_else(|error| error)
}

fn input_type_result(sandbox: &PathSandbox, args: &Value) -> Result<String, String> {
    if let Some(e) = require_consent(sandbox) {
        return Err(e);
    }
    validate_bound_step(sandbox, args)?;
    screenshot_window_result(sandbox, &json!({ "path": "qa/gui-before-type.png" }))
        .map_err(|error| format!("动作前状态验证失败：{error}"))?;
    validate_bound_step(sandbox, args)?;
    let text = args
        .get("text")
        .and_then(Value::as_str)
        .ok_or("input_type 需要 text")?;
    audit(sandbox, &format!("input_type len={}", text.chars().count()));
    let escaped = text
        .replace('{', "{{}")
        .replace('}', "{}}")
        .replace('+', "{+}")
        .replace('^', "{^}")
        .replace('%', "{%}")
        .replace('~', "{~}")
        .replace('(', "{(}")
        .replace(')', "{)}")
        .replace('[', "{[}")
        .replace(']', "{]}");
    let ps = format!(
        r#"Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{}')"#,
        escaped.replace('\'', "''")
    );
    let mut command = Command::new("powershell");
    command.args(["-NoProfile", "-NonInteractive", "-Command", &ps]);
    configure_background(&mut command);
    match command.output() {
        Ok(o) if o.status.success() => {
            match screenshot_window_result(sandbox, &json!({ "path": "qa/gui-after-type.png" })) {
                Ok(_) => Ok("已键盘输入；动作前后截图已保存（experimental）".into()),
                Err(error) => {
                    gui_safety::emergency_stop();
                    Err(format!("输入后状态验证失败，已急停：{error}"))
                }
            }
        }
        Ok(o) => Err(format!(
            "键盘输入失败: {}",
            String::from_utf8_lossy(&o.stderr)
                .chars()
                .take(300)
                .collect::<String>()
        )),
        Err(e) => Err(format!("键盘输入进程失败: {e}")),
    }
}

/// Starts or seeds Windows GUI recording; unsupported platforms fail explicitly.
pub fn tool_gui_record_start(sandbox: &PathSandbox, args: &Value) -> String {
    if let Some(e) = require_consent(sandbox) {
        return e;
    }
    let seq_path = sandbox.workspace.join("qa").join("gui-sequence.json");
    let _ = fs::create_dir_all(sandbox.workspace.join("qa"));
    if gui_record::is_recording() {
        match gui_record::stop_recording_and_save(&seq_path) {
            Ok((n, p)) => {
                audit(sandbox, &format!("gui_record_stop actions={n}"));
                return format!("已停止录制，{n} 步 → {p}（可用 gui_replay 回放）");
            }
            Err(e) => return format!("停止录制失败: {e}"),
        }
    }
    if let Some(seed) = args.get("seed").and_then(|v| v.as_array()) {
        if !seed.is_empty() {
            let doc = json!({
                "version": 1,
                "status": "seeded",
                "actions": seed,
            });
            if fs::write(
                &seq_path,
                serde_json::to_string_pretty(&doc).unwrap_or_default(),
            )
            .is_ok()
            {
                return format!("已写入种子序列 {}（{} 步）", seq_path.display(), seed.len());
            }
        }
    }
    match gui_record::start_recording() {
        Ok(()) => {
            audit(sandbox, "gui_record_start hook");
            "已开始 Windows 低级 Hook 录制（左键点击 + 键盘输入）。再次调用 gui_record_start 或 gui_record_stop 结束并保存到 qa/gui-sequence.json".into()
        }
        Err(e) => format!("启动录制失败: {e}"),
    }
}

/// Stops GUI recording and writes the sandboxed sequence.
pub fn tool_gui_record_stop(sandbox: &PathSandbox, _args: &Value) -> String {
    if let Some(e) = require_consent(sandbox) {
        return e;
    }
    let seq_path = sandbox.workspace.join("qa").join("gui-sequence.json");
    match gui_record::stop_recording_and_save(&seq_path) {
        Ok((n, p)) => {
            audit(sandbox, &format!("gui_record_stop actions={n}"));
            format!("录制已保存 {n} 步 → {p}")
        }
        Err(e) => format!("停止录制失败: {e}"),
    }
}

fn input_key_result(sandbox: &PathSandbox, args: &Value) -> Result<String, String> {
    validate_bound_step(sandbox, args)?;
    screenshot_window_result(sandbox, &json!({ "path": "qa/gui-before-key.png" }))
        .map_err(|error| format!("动作前状态验证失败：{error}"))?;
    validate_bound_step(sandbox, args)?;
    let vk = args
        .get("vk")
        .and_then(Value::as_u64)
        .ok_or("key 需要 vk")?;
    let spec = match vk {
        8 => "{BACKSPACE}",
        9 => "{TAB}",
        13 => "{ENTER}",
        27 => "{ESC}",
        _ => return Err(format!("不支持的虚拟键码: {vk}")),
    };
    audit(sandbox, &format!("input_key vk={vk}"));
    let ps = format!(
        r#"Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{}')"#,
        spec
    );
    let mut command = Command::new("powershell");
    command.args(["-NoProfile", "-NonInteractive", "-Command", &ps]);
    configure_background(&mut command);
    match command.output() {
        Ok(o) if o.status.success() => Ok(format!("已按键 vk={vk}")),
        Ok(o) => Err(format!(
            "按键失败: {}",
            String::from_utf8_lossy(&o.stderr)
                .chars()
                .take(300)
                .collect::<String>()
        )),
        Err(e) => Err(format!("按键进程失败: {e}")),
    }
}

fn replay_one_action(sandbox: &PathSandbox, action: &Value, idx: usize) -> Result<String, String> {
    let kind = action
        .get("type")
        .or_else(|| action.get("action"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match kind.as_str() {
        "click" => {
            input_click_result(sandbox, action).map_err(|error| format!("#{idx} click: {error}"))
        }
        "ui_click" => {
            ui_click_element_result(sandbox, action).map_err(|error| format!("#{idx} ui_click: {error}"))
        }
        "type" | "input" | "text" => {
            let mut bound = action.clone();
            if bound.get("text").is_none() {
                if let Some(value) = action.get("value").cloned() {
                    bound["text"] = value;
                }
            }
            input_type_result(sandbox, &bound).map_err(|error| format!("#{idx} type: {error}"))
        }
        "key" => input_key_result(sandbox, action).map_err(|error| format!("#{idx} key: {error}")),
        "wait" | "sleep" | "delay" => {
            let ms = action
                .get("ms")
                .or_else(|| action.get("delay"))
                .and_then(|v| v.as_u64())
                .unwrap_or(300)
                .min(10_000);
            thread::sleep(Duration::from_millis(ms));
            Ok(format!("等待 {ms}ms"))
        }
        "screenshot" | "shot" => {
            let path = action
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("qa/gui-replay-shot.png");
            screenshot_window_result(sandbox, &json!({ "path": path }))
                .map_err(|error| format!("#{idx} screenshot: {error}"))
        }
        "" => Err(format!("#{idx} 缺少 type")),
        other => Err(format!("#{idx} 未知动作: {other}")),
    }
}

fn bind_replay_action(
    action: &Value,
    target: &Value,
    input_epoch: u64,
    provider: &Value,
) -> Result<Value, String> {
    let mut bound = action.as_object().cloned().ok_or("回放动作必须是对象")?;
    bound.insert("target".into(), target.clone());
    bound.insert("inputEpoch".into(), json!(input_epoch));
    bound.insert("provider".into(), provider.clone());
    Ok(Value::Object(bound))
}

/// Replays a consented sequence; each input action still passes binding checks.
pub fn tool_gui_replay(sandbox: &PathSandbox, args: &Value) -> String {
    if let Some(e) = require_consent(sandbox) {
        return e;
    }
    let path_raw = args
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("qa/gui-sequence.json");
    let path = match sandbox.resolve_read(path_raw) {
        Ok(path) => path,
        Err(error) => return error,
    };
    audit(sandbox, &format!("gui_replay {}", path.display()));
    if !path.is_file() {
        return format!("序列文件不存在: {}", path.display());
    }
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => return format!("读取序列失败: {e}"),
    };
    let doc: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => return format!("JSON 解析失败: {e}"),
    };
    let actions = doc
        .get("actions")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if actions.is_empty() {
        return "序列 actions 为空".into();
    }
    if actions.len() > 1_000 {
        return "序列 actions 超过 1000 步上限".into();
    }
    let target = match args.get("target").cloned() {
        Some(target) => target,
        None => return "gui_replay 缺少顶层 target".into(),
    };
    let input_epoch = match args.get("inputEpoch").and_then(Value::as_u64) {
        Some(epoch) => epoch,
        None => return "gui_replay 缺少顶层 inputEpoch".into(),
    };
    let provider = match args.get("provider").cloned() {
        Some(provider) => provider,
        None => return "gui_replay 缺少顶层 provider".into(),
    };
    let mut lines = Vec::new();
    let mut failed = 0usize;
    for (i, action) in actions.iter().enumerate() {
        let bound = match bind_replay_action(action, &target, input_epoch, &provider) {
            Ok(bound) => bound,
            Err(error) => {
                failed += 1;
                lines.push(format!("#{} FAIL: {error}", i + 1));
                continue;
            }
        };
        match replay_one_action(sandbox, &bound, i + 1) {
            Ok(msg) => lines.push(format!("#{} OK: {msg}", i + 1)),
            Err(e) => {
                failed += 1;
                lines.push(format!("#{} FAIL: {e}", i + 1));
            }
        }
    }
    if let Some(assertions) = doc.get("assertions").and_then(|v| v.as_array()) {
        for (i, assertion) in assertions.iter().enumerate() {
            match run_gui_assertion(sandbox, assertion) {
                Ok(msg) => lines.push(format!("断言#{} OK: {msg}", i + 1)),
                Err(e) => {
                    failed += 1;
                    lines.push(format!("断言#{} FAIL: {e}", i + 1));
                }
            }
        }
    }
    let assertion_count = doc
        .get("assertions")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    let total_steps = actions.len() + assertion_count;
    let ok_all = total_steps.saturating_sub(failed);
    lines.push(format!(
        "回放完成：{ok_all}/{total_steps} 步成功{}",
        if failed > 0 { "（有失败）" } else { "" }
    ));
    lines.join("\n")
}

fn run_gui_assertion(sandbox: &PathSandbox, assertion: &Value) -> Result<String, String> {
    let kind = assertion
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("file_exists")
        .to_ascii_lowercase();
    match kind.as_str() {
        "file_exists" => {
            let path = assertion
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("file_exists 需要 path")?;
            let abs = sandbox.resolve_read(path).map_err(|e| e.to_string())?;
            if abs.is_file() {
                Ok(format!("文件存在: {path}"))
            } else {
                Err(format!("文件不存在: {path}"))
            }
        }
        "file_contains" => {
            let path = assertion
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("file_contains 需要 path")?;
            let needle = assertion
                .get("text")
                .or_else(|| assertion.get("contains"))
                .and_then(|v| v.as_str())
                .ok_or("file_contains 需要 text")?;
            let abs = sandbox.resolve_read(path).map_err(|e| e.to_string())?;
            let raw = fs::read_to_string(&abs).map_err(|e| e.to_string())?;
            if raw.contains(needle) {
                Ok(format!("{path} 包含预期文本"))
            } else {
                Err(format!("{path} 未包含: {needle}"))
            }
        }
        other => Err(format!("未知断言类型: {other}")),
    }
}

/// Focuses a whitelisted window whose title contains the given fragment.
pub fn tool_ui_focus_window(sandbox: &PathSandbox, args: &Value) -> String {
    if let Some(error) = require_consent(sandbox) {
        return error;
    }
    let fragment = args
        .get("titleFragment")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if fragment.is_empty() {
        return "ui_focus_window 需要 titleFragment".into();
    }
    match gui_uia::focus_window(fragment, &sandbox.gui_window_allowlist) {
        Ok(title) => {
            audit(sandbox, &format!("ui_focus_window {fragment} -> {title}"));
            format!("已聚焦窗口：{title}")
        }
        Err(error) => error,
    }
}

fn ui_click_element_result(sandbox: &PathSandbox, args: &Value) -> Result<String, String> {
    if let Some(e) = require_consent(sandbox) {
        return Err(e);
    }
    validate_bound_step(sandbox, args)?;
    let (target, _) = {
        let epoch = args.get("inputEpoch").and_then(Value::as_u64).unwrap_or(0);
        gui_safety::validate_action(args, &sandbox.gui_window_allowlist, epoch)?
    };
    let selector = gui_uia::selector_from_value(
        args.get("selector").ok_or("ui_click_element 需要 selector")?,
    )?;
    screenshot_window_result(
        sandbox,
        &json!({ "path": "qa/gui-before-uia-click.png", "target": target }),
    )
    .map_err(|error| format!("动作前状态验证失败：{error}"))?;
    validate_bound_step(sandbox, args)?;
    let hwnd = gui_uia::parse_hwnd(&target.window_id)?;
    let click_msg = gui_uia::click_element(hwnd, &selector)?;
    audit(sandbox, &format!("ui_click_element {click_msg}"));
    match screenshot_window_result(
        sandbox,
        &json!({ "path": "qa/gui-after-uia-click.png", "target": target }),
    ) {
        Ok(_) => Ok(format!("UIA 点击完成：{click_msg}")),
        Err(error) => {
            gui_safety::emergency_stop();
            Err(format!("点击后状态验证失败，已急停：{error}"))
        }
    }
}

/// Clicks a UIA element inside the bound target window.
pub fn tool_ui_click_element(sandbox: &PathSandbox, args: &Value) -> String {
    ui_click_element_result(sandbox, args).unwrap_or_else(|error| error)
}

/// Lists UIA elements under the bound target window.
pub fn tool_ui_list_elements(sandbox: &PathSandbox, args: &Value) -> String {
    if let Some(error) = require_consent(sandbox) {
        return error;
    }
    if let Err(error) = validate_bound_step(sandbox, args) {
        return error.to_string();
    }
    let (target, _) = match args.get("inputEpoch").and_then(Value::as_u64) {
        Some(epoch) => match gui_safety::validate_action(args, &sandbox.gui_window_allowlist, epoch) {
            Ok(v) => v,
            Err(error) => return error,
        },
        None => return "ui_list_elements 缺少 inputEpoch".into(),
    };
    let max_depth = args
        .get("maxDepth")
        .and_then(Value::as_u64)
        .unwrap_or(4)
        .min(8) as u32;
    let filter = args.get("nameFilter").and_then(Value::as_str);
    let hwnd = match gui_uia::parse_hwnd(&target.window_id) {
        Ok(v) => v,
        Err(error) => return error,
    };
    match gui_uia::list_elements(hwnd, max_depth, filter) {
        Ok(list) => json!({ "count": list.len(), "elements": list }).to_string(),
        Err(error) => error,
    }
}

/// Publishes experimental GUI tool schemas to the Native Agent.
pub fn openai_gui_tool_defs() -> Vec<Value> {
    vec![
        tool_def(
            "app_launch",
            "启动桌面应用（需 GUI 同意）。需审批。",
            json!({
                "program": { "type": "string", "description": "程序路径或命令" },
                "args": { "type": "array", "items": { "type": "string" }, "description": "参数列表" }
            }),
            &["program"],
        ),
        tool_def(
            "screenshot_window",
            "截取屏幕或绑定窗口到工作区路径（需 GUI 同意）。",
            json!({
                "path": { "type": "string", "description": "输出图片路径" },
                "target": {
                    "type": "object",
                    "description": "可选；提供 windowId 时优先截该窗口",
                    "properties": {
                        "windowId": { "type": "string" },
                        "processId": { "type": "integer" },
                        "title": { "type": "string" }
                    }
                }
            }),
            &[],
        ),
        tool_def(
            "ui_focus_window",
            "EXPERIMENTAL：按标题片段聚焦白名单内窗口（不注入点击）。",
            json!({
                "titleFragment": { "type": "string", "description": "窗口标题片段，如 Cursor" }
            }),
            &["titleFragment"],
        ),
        tool_def(
            "gui_bind_target",
            "EXPERIMENTAL：绑定当前前台白名单窗口并截图；后续每个输入步骤必须携带返回绑定。",
            json!({}),
            &[],
        ),
        tool_def(
            "input_click",
            "EXPERIMENTAL：绑定目标窗口后坐标点击；每一步审批并保留动作前后截图。",
            json!({
                "x": { "type": "integer", "description": "横坐标" },
                "y": { "type": "integer", "description": "纵坐标" },
                "coordSpace": {
                    "type": "string",
                    "enum": ["client", "screen"],
                    "description": "默认 client（相对窗口客户区）"
                },
                "target": {
                    "type": "object",
                    "properties": {
                        "windowId": { "type": "string" },
                        "processId": { "type": "integer" },
                        "title": { "type": "string" }
                    },
                    "required": ["windowId", "processId", "title"]
                },
                "inputEpoch": { "type": "integer", "description": "绑定目标时的真实输入纪元" },
                "provider": {
                    "type": "string",
                    "enum": ["coordinate_experimental", "windows_uia_experimental"]
                }
            }),
            &["x", "y", "target", "inputEpoch", "provider"],
        ),
        tool_def(
            "ui_list_elements",
            "EXPERIMENTAL：枚举绑定窗口内 UIA 元素（最多 80 项）。",
            json!({
                "maxDepth": { "type": "integer", "description": "遍历深度，默认 4" },
                "nameFilter": { "type": "string", "description": "可选名称过滤" },
                "target": {
                    "type": "object",
                    "properties": {
                        "windowId": { "type": "string" },
                        "processId": { "type": "integer" },
                        "title": { "type": "string" }
                    },
                    "required": ["windowId", "processId", "title"]
                },
                "inputEpoch": { "type": "integer" },
                "provider": {
                    "type": "string",
                    "enum": ["windows_uia_experimental", "coordinate_experimental"]
                }
            }),
            &["target", "inputEpoch", "provider"],
        ),
        tool_def(
            "ui_click_element",
            "EXPERIMENTAL：在绑定窗口内按 UIA selector 点击；优先 Invoke，否则中心坐标。",
            json!({
                "selector": {
                    "type": "object",
                    "properties": {
                        "automationId": { "type": "string" },
                        "name": { "type": "string" },
                        "controlType": { "type": "string" }
                    }
                },
                "target": {
                    "type": "object",
                    "properties": {
                        "windowId": { "type": "string" },
                        "processId": { "type": "integer" },
                        "title": { "type": "string" }
                    },
                    "required": ["windowId", "processId", "title"]
                },
                "inputEpoch": { "type": "integer" },
                "provider": { "type": "string", "enum": ["windows_uia_experimental"] }
            }),
            &["selector", "target", "inputEpoch", "provider"],
        ),
        tool_def(
            "input_type",
            "EXPERIMENTAL：绑定目标窗口后用 SendKeys 输入；每一步审批并保留动作前后截图。",
            json!({
                "text": { "type": "string", "description": "输入文本" },
                "target": {
                    "type": "object",
                    "properties": {
                        "windowId": { "type": "string" },
                        "processId": { "type": "integer" },
                        "title": { "type": "string" }
                    },
                    "required": ["windowId", "processId", "title"]
                },
                "inputEpoch": { "type": "integer" },
                "provider": {
                    "type": "string",
                    "enum": ["coordinate_experimental", "windows_uia_experimental"]
                }
            }),
            &["text", "target", "inputEpoch", "provider"],
        ),
        tool_def(
            "gui_record_start",
            "开始 Windows 低级 Hook 录制（点击 + 键盘）；再次调用或 gui_record_stop 结束并保存。",
            json!({ "seed": { "type": "array", "description": "可选种子动作" } }),
            &[],
        ),
        tool_def(
            "gui_record_stop",
            "停止 GUI 录制并保存到 qa/gui-sequence.json。",
            json!({}),
            &[],
        ),
        tool_def(
            "gui_replay",
            "回放 JSON 动作序列（click/ui_click/type/key/wait/screenshot）；可选 assertions。",
            json!({
                "path": { "type": "string", "description": "工作区或额外只读范围内的序列文件路径" },
                "target": {
                    "type": "object",
                    "properties": {
                        "windowId": { "type": "string" },
                        "processId": { "type": "integer" },
                        "title": { "type": "string" }
                    },
                    "required": ["windowId", "processId", "title"]
                },
                "inputEpoch": { "type": "integer" },
                "provider": {
                    "type": "string",
                    "enum": ["coordinate_experimental", "windows_uia_experimental"]
                }
            }),
            &["target", "inputEpoch", "provider"],
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn sandbox() -> PathSandbox {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("xu-gui-tools-{suffix}"));
        let mut sandbox = PathSandbox::new(root, vec![]).unwrap();
        sandbox.gui_consent = true;
        sandbox.gui_experimental = true;
        sandbox
    }

    fn binding_args() -> Value {
        json!({
            "target": { "windowId": "42", "processId": 7, "title": "Cursor — demo" },
            "inputEpoch": gui_safety::real_input_epoch(),
            "provider": "coordinate_experimental"
        })
    }

    #[test]
    fn gui_actions_fail_closed_when_monitor_is_not_armed() {
        let sandbox = sandbox();
        let mut click = binding_args();
        click["x"] = json!(10);
        click["y"] = json!(20);
        assert!(tool_input_click(&sandbox, &click).contains("monitor 未 armed/healthy"));
        assert!(
            tool_app_launch(&sandbox, &json!({"program": "never-spawn"}))
                .contains("monitor 未 armed/healthy")
        );
    }

    #[test]
    fn replay_binding_overrides_per_step_values() {
        let target = binding_args()["target"].clone();
        let bound = bind_replay_action(
            &json!({"type":"click","x":1,"y":2,"inputEpoch":999,"provider":"bad"}),
            &target,
            12,
            &json!("coordinate_experimental"),
        )
        .unwrap();
        assert_eq!(bound["target"], target);
        assert_eq!(bound["inputEpoch"], 12);
        assert_eq!(bound["provider"], "coordinate_experimental");
    }

    #[test]
    fn replay_source_path_cannot_escape_read_sandbox() {
        let sandbox = sandbox();
        let result = tool_gui_replay(
            &sandbox,
            &json!({
                "path": "../outside.json",
                "target": binding_args()["target"].clone(),
                "inputEpoch": 0,
                "provider": "coordinate_experimental"
            }),
        );
        assert!(result.contains("可读范围"));
    }

    #[test]
    fn replay_rejects_out_of_range_click_before_injection() {
        let mut click = binding_args();
        click["x"] = json!(i64::MAX);
        click["y"] = json!(0);
        assert!(click_coordinates(&click).unwrap_err().contains("坐标范围"));
    }
}
