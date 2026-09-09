//! Windows UI Automation 实验 provider：元素枚举、点击与窗口聚焦。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-09-02
//! @version 1.0.0
//! @category ToolPolicy
//! @algo uia-com-fallback

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometry {
    pub client_rect: RectI32,
    pub screen_origin: PointI32,
    pub dpi_scale: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RectI32 {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PointI32 {
    pub x: i32,
    pub y: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiaElementSummary {
    pub name: String,
    pub control_type: String,
    pub automation_id: String,
    pub bounding_rect: RectI32,
    pub is_enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiaSelector {
    pub automation_id: Option<String>,
    pub name: Option<String>,
    pub control_type: Option<String>,
}

pub fn parse_hwnd(window_id: &str) -> Result<isize, String> {
    window_id
        .trim()
        .parse::<isize>()
        .map_err(|_| "windowId 无效".into())
}

#[cfg(windows)]
pub fn window_geometry(hwnd_raw: isize) -> Result<WindowGeometry, String> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, GetWindowRect};

    unsafe {
        let hwnd = HWND(hwnd_raw as *mut _);
        if hwnd.0.is_null() {
            return Err("无效窗口句柄".into());
        }
        let mut client = RECT::default();
        GetClientRect(hwnd, &mut client)
            .map_err(|e| format!("GetClientRect 失败: {e}"))?;
        let mut outer = RECT::default();
        GetWindowRect(hwnd, &mut outer)
            .map_err(|e| format!("GetWindowRect 失败: {e}"))?;
        let dpi = GetDpiForWindow(hwnd);
        let scale = if dpi == 0 {
            1.0
        } else {
            dpi as f64 / 96.0
        };
        Ok(WindowGeometry {
            client_rect: RectI32 {
                left: 0,
                top: 0,
                width: client.right - client.left,
                height: client.bottom - client.top,
            },
            screen_origin: PointI32 {
                x: outer.left,
                y: outer.top,
            },
            dpi_scale: scale,
        })
    }
}

#[cfg(not(windows))]
pub fn window_geometry(_hwnd_raw: isize) -> Result<WindowGeometry, String> {
    Err("UIA provider 当前仅有 Windows experimental".into())
}

#[cfg(windows)]
pub fn focus_window(title_fragment: &str, allowlist: &[String]) -> Result<String, String> {
    use std::ffi::c_void;

    type Hwnd = *mut c_void;
    let needle = title_fragment.trim().to_string();
    if needle.is_empty() {
        return Err("titleFragment 不能为空".into());
    }
    let allowed: Vec<String> = allowlist
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if allowed.is_empty() {
        return Err("GUI 白名单为空".into());
    }

    struct Ctx {
        needle: String,
        allowed: Vec<String>,
        found: Option<(Hwnd, String)>,
    }
    unsafe extern "system" fn enum_cb(hwnd: Hwnd, lparam: isize) -> i32 {
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;
        #[link(name = "user32")]
        extern "system" {
            fn GetWindowTextLengthW(hwnd: Hwnd) -> i32;
            fn GetWindowTextW(hwnd: Hwnd, text: *mut u16, max_count: i32) -> i32;
            fn IsWindowVisible(hwnd: Hwnd) -> i32;
        }
        let ctx = &mut *(lparam as *mut Ctx);
        unsafe {
            if IsWindowVisible(hwnd) == 0 {
                return 1;
            }
            let len = GetWindowTextLengthW(hwnd).max(0) as usize;
            if len == 0 {
                return 1;
            }
            let mut buffer = vec![0u16; len + 1];
            let read = GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32).max(0) as usize;
            let title = OsString::from_wide(&buffer[..read])
                .to_string_lossy()
                .into_owned();
            if !title.contains(&ctx.needle) {
                return 1;
            }
            if !ctx
                .allowed
                .iter()
                .any(|a| !a.is_empty() && title.contains(a))
            {
                return 1;
            }
            ctx.found = Some((hwnd, title));
            0
        }
    }

    let mut ctx = Ctx {
        needle,
        allowed,
        found: None,
    };
    unsafe {
        #[link(name = "user32")]
        extern "system" {
            fn EnumWindows(
                lp_enum_func: unsafe extern "system" fn(Hwnd, isize) -> i32,
                lparam: isize,
            ) -> i32;
            fn SetForegroundWindow(hwnd: Hwnd) -> i32;
        }
        EnumWindows(enum_cb, &mut ctx as *mut Ctx as isize);
        let Some((hwnd, title)) = ctx.found else {
            return Err("未找到标题含片段且位于白名单的窗口".into());
        };
        if SetForegroundWindow(hwnd) == 0 {
            return Err("SetForegroundWindow 失败".into());
        }
        Ok(title)
    }
}

#[cfg(not(windows))]
pub fn focus_window(_title_fragment: &str, _allowlist: &[String]) -> Result<String, String> {
    Err("UIA provider 当前仅有 Windows experimental".into())
}

#[cfg(windows)]
fn run_uia_powershell(script: &str) -> Result<String, String> {
    use std::process::Command;
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("UIA PowerShell 启动失败: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !out.status.success() {
        return Err(if stderr.is_empty() {
            stdout
        } else {
            stderr
        }
        .chars()
        .take(500)
        .collect());
    }
    Ok(stdout)
}

#[cfg(windows)]
pub fn list_elements(hwnd_raw: isize, max_depth: u32, name_filter: Option<&str>) -> Result<Vec<UiaElementSummary>, String> {
    let filter = name_filter.unwrap_or("").replace('\'', "''");
    let script = format!(
        r#"
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]{hwnd_raw})
if (-not $root) {{ throw '无法获取 UIA 根元素' }}
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::IsControlElementProperty, $true)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$out = New-Object System.Collections.Generic.List[object]
function Walk($el, $depth) {{
  if ($depth -gt {max_depth}) {{ return }}
  try {{
    $rect = $el.Current.BoundingRectangle
    $name = [string]$el.Current.Name
    $aid = [string]$el.Current.AutomationId
    $ctype = [string]$el.Current.ControlType.ProgrammaticName
    $enabled = [bool]$el.Current.IsEnabled
    if ($name -or $aid) {{
      if ('{filter}' -eq '' -or $name -like '*{filter}*' -or $aid -like '*{filter}*') {{
        $out.Add([ordered]@{{
          name = $name
          automationId = $aid
          controlType = ($ctype -replace 'ControlType\.','')
          boundingRect = @{{ left=[int]$rect.Left; top=[int]$rect.Top; width=[int]$rect.Width; height=[int]$rect.Height }}
          isEnabled = $enabled
        }}) | Out-Null
      }}
    }}
    $child = $walker.GetFirstChild($el)
    while ($child) {{
      Walk $child ($depth + 1)
      $child = $walker.GetNextSibling($child)
    }}
  }} catch {{ }}
}}
Walk $root 0
if ($out.Count -gt 80) {{ $out = $out[0..79] }}
$out | ConvertTo-Json -Compress -Depth 6
"#
    );
    let raw = run_uia_powershell(&script)?;
    if raw.is_empty() || raw == "null" {
        return Ok(vec![]);
    }
    let parsed: Value = serde_json::from_str(&raw).map_err(|e| format!("UIA JSON 解析失败: {e}"))?;
    let items = if parsed.is_array() {
        parsed
    } else {
        json!([parsed])
    };
    let mut out = Vec::new();
    if let Some(arr) = items.as_array() {
        for item in arr {
            if let Ok(el) = serde_json::from_value::<UiaElementSummary>(item.clone()) {
                out.push(el);
            }
        }
    }
    Ok(out)
}

#[cfg(not(windows))]
pub fn list_elements(
    _hwnd_raw: isize,
    _max_depth: u32,
    _name_filter: Option<&str>,
) -> Result<Vec<UiaElementSummary>, String> {
    Err("UIA provider 当前仅有 Windows experimental".into())
}

#[cfg(windows)]
pub fn click_element(hwnd_raw: isize, selector: &UiaSelector) -> Result<String, String> {
    let aid = selector
        .automation_id
        .as_deref()
        .unwrap_or("")
        .replace('\'', "''");
    let name = selector.name.as_deref().unwrap_or("").replace('\'', "''");
    let ctype = selector
        .control_type
        .as_deref()
        .unwrap_or("")
        .replace('\'', "''");
    if aid.is_empty() && name.is_empty() {
        return Err("selector 需要 automationId 或 name".into());
    }
    let script = format!(
        r#"
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]{hwnd_raw})
if (-not $root) {{ throw '无法获取 UIA 根元素' }}
$conds = @()
if ('{aid}' -ne '') {{
  $conds += New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, '{aid}')
}}
if ('{name}' -ne '') {{
  $conds += New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty, '{name}')
}}
if ('{ctype}' -ne '') {{
  $ct = [System.Windows.Automation.ControlType]::Parse([System.Windows.Automation.ControlType], '{ctype}')
  $conds += New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ct)
}}
$and = if ($conds.Count -eq 1) {{ $conds[0] }} else {{
  New-Object System.Windows.Automation.AndCondition(,$conds)
}}
$el = $root.FindFirst([System.Windows.Automation.TreeScope]::Subtree, $and)
if (-not $el) {{ throw '未找到匹配元素' }}
$pattern = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
if ($pattern) {{
  $pattern.Invoke()
  'clicked:invoke'
}} else {{
  $rect = $el.Current.BoundingRectangle
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public class UiaClick {{
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e);
}}
'@
  $x = [int]($rect.X + $rect.Width / 2)
  $y = [int]($rect.Y + $rect.Height / 2)
  [UiaClick]::SetCursorPos($x, $y)
  [UiaClick]::mouse_event(0x0002,0,0,0,0)
  [UiaClick]::mouse_event(0x0004,0,0,0,0)
  "clicked:coord:$x,$y"
}}
"#
    );
    run_uia_powershell(&script)
}

#[cfg(not(windows))]
pub fn click_element(_hwnd_raw: isize, _selector: &UiaSelector) -> Result<String, String> {
    Err("UIA provider 当前仅有 Windows experimental".into())
}

#[cfg(windows)]
pub fn send_mouse_click_screen(x: i32, y: i32) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
        MOUSEINPUT,
    };
    use windows::Win32::UI::WindowsAndMessaging::SetCursorPos;

    unsafe {
        SetCursorPos(x, y).map_err(|e| format!("SetCursorPos 失败: {e}"))?;
        let down = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dwFlags: MOUSEEVENTF_LEFTDOWN,
                    ..Default::default()
                },
            },
        };
        let up = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dwFlags: MOUSEEVENTF_LEFTUP,
                    ..Default::default()
                },
            },
        };
        SendInput(&[down], std::mem::size_of::<INPUT>() as i32);
        SendInput(&[up], std::mem::size_of::<INPUT>() as i32);
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn send_mouse_click_screen(_x: i32, _y: i32) -> Result<(), String> {
    Err("SendInput 当前仅有 Windows".into())
}

pub fn client_to_screen(origin: &PointI32, x: i32, y: i32) -> (i32, i32) {
    (origin.x + x, origin.y + y)
}

pub fn selector_from_value(v: &Value) -> Result<UiaSelector, String> {
    Ok(UiaSelector {
        automation_id: v
            .get("automationId")
            .and_then(|x| x.as_str())
            .map(str::to_string),
        name: v.get("name").and_then(|x| x.as_str()).map(str::to_string),
        control_type: v
            .get("controlType")
            .and_then(|x| x.as_str())
            .map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_to_screen_adds_origin() {
        let origin = PointI32 { x: 100, y: 200 };
        assert_eq!(client_to_screen(&origin, 10, 20), (110, 220));
    }
}
