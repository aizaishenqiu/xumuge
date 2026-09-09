//! Native Agent 项目级工具权限硬门禁。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @version 1.1.0
//! @category ToolPolicy
//! @algo deny-before-approval

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectToolPolicy {
    #[serde(default = "default_true")]
    pub read_files: bool,
    #[serde(default)]
    pub write_files: bool,
    #[serde(default)]
    pub shell: bool,
    #[serde(default)]
    pub browser: bool,
    #[serde(default)]
    pub gui_input: bool,
    #[serde(default)]
    pub ide: bool,
    #[serde(default)]
    pub mcp: bool,
    /// Role MCP allowlist: None = no extra filter; Some([]) deny all MCP names; Some(["*"]) all; else server.tool keys.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_tools_allowlist: Option<Vec<String>>,
}

fn default_true() -> bool {
    true
}

impl ProjectToolPolicy {
    pub fn conservative() -> Self {
        Self {
            read_files: true,
            write_files: false,
            shell: false,
            browser: false,
            gui_input: false,
            ide: false,
            mcp: false,
            mcp_tools_allowlist: None,
        }
    }
}

fn mcp_allow_key(tool_name: &str) -> Option<String> {
    let rest = tool_name.strip_prefix("mcp__")?;
    let (srv, tool) = rest.split_once("__")?;
    Some(format!("{srv}.{tool}"))
}

fn mcp_tools_allowed(policy: &ProjectToolPolicy, tool_name: &str) -> bool {
    let Some(list) = policy.mcp_tools_allowlist.as_ref() else {
        return true;
    };
    if list.iter().any(|x| x == "*") {
        return true;
    }
    if list.is_empty() {
        return false;
    }
    if list.iter().any(|x| x == tool_name) {
        return true;
    }
    if let Some(key) = mcp_allow_key(tool_name) {
        return list.iter().any(|x| x == &key);
    }
    false
}

/// Duty: 内置画板工具（与项目「写文件」权限解耦）。
pub fn is_canvas_tool(tool_name: &str) -> bool {
    matches!(
        tool_name.trim(),
        "canvas_list"
            | "canvas_read"
            | "canvas_write_mermaid"
            | "canvas_write_flow"
            | "canvas_clear_flow"
            | "canvas_write_sketch"
            | "canvas_clear_sketch"
            | "canvas_add_strokes"
            | "canvas_update_stroke"
            | "canvas_delete_strokes"
            | "canvas_export"
    )
}

/// Duty: 会改草图 board 的工具（计入 require_canvas_write）。
pub fn is_canvas_sketch_mutate_tool(tool_name: &str) -> bool {
    matches!(
        tool_name.trim(),
        "canvas_write_sketch"
            | "canvas_clear_sketch"
            | "canvas_add_strokes"
            | "canvas_update_stroke"
            | "canvas_delete_strokes"
    )
}

fn is_basic_read_tool(tool_name: &str) -> bool {
    matches!(
        tool_name.trim(),
        "list_dir"
            | "read_file"
            | "glob_file_search"
            | "grep_search"
            | "view_image"
            | "office_read_xlsx"
            | "office_read_xlsx_range"
            | "office_read_docx"
            | "clipboard_get"
            | "update_plan"
            | "delivery_review_status"
            | "defect_assign_fix"
            | "voice_route_probe"
            | "voice_set_tone"
            | "voice_set_cosy_instruct"
            | "voice_clear_override"
    )
}

pub fn project_policy_allows(policy: &Option<ProjectToolPolicy>, tool_name: &str) -> bool {
    let name = tool_name.trim();
    if name.is_empty() {
        return false;
    }
    // 无项目策略（Canvas 默认目录 / 未绑定项目）：允许只读 + 内置画板，禁止任意写盘/shell
    let Some(p) = policy else {
        return is_canvas_tool(name) || is_basic_read_tool(name);
    };
    if name.starts_with("mcp__") {
        return p.mcp && mcp_tools_allowed(p, name);
    }
    if is_canvas_tool(name) {
        return p.read_files;
    }
    match name {
        "list_dir"
        | "read_file"
        | "glob_file_search"
        | "grep_search"
        | "view_image"
        | "office_read_xlsx"
        | "office_read_xlsx_range"
        | "office_read_docx"
        | "clipboard_get"
        | "update_plan"
        | "delivery_review_status"
        | "defect_assign_fix"
        | "voice_route_probe"
        | "voice_set_tone"
        | "voice_set_cosy_instruct"
        | "voice_clear_override" => p.read_files,
        "write_file"
        | "mkdir"
        | "preview_patch"
        | "patch_file"
        | "apply_patch"
        | "delete_file"
        | "undo_last_changes"
        | "office_write_docx"
        | "office_write_xlsx"
        | "office_write_pptx"
        | "office_docx_replace"
        | "office_edit_xlsx_cells"
        | "office_apply_template"
        | "clipboard_set"
        | "defect_write"
        | "dispatch_defect_fix"
        | "escalate_delivery_to_boss" => p.write_files,
        "shell_exec" | "git" | "open_program" | "office_open" => p.shell,
        "browser_open" | "browser_goto" | "browser_click" | "browser_type" | "browser_assert"
        | "browser_screenshot" | "run_ui_acceptance" => p.browser,
        "app_launch" | "screenshot_window" | "gui_bind_target" | "input_click" | "input_type"
        | "ui_focus_window" | "ui_list_elements" | "ui_click_element"
        | "gui_record_start" | "gui_record_stop" | "gui_replay" => p.gui_input,
        "ide_open" | "vscode_open" | "vscode_save" | "vscode_reload_window" | "cursor_sdk_prompt" => {
            p.ide
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_BUILTIN_TOOLS: &[&str] = &[
        "list_dir",
        "read_file",
        "glob_file_search",
        "grep_search",
        "undo_last_changes",
        "clipboard_get",
        "update_plan",
        "view_image",
        "canvas_list",
        "canvas_read",
        "git",
        "office_read_xlsx",
        "office_read_xlsx_range",
        "office_read_docx",
        "write_file",
        "canvas_write_mermaid",
        "canvas_write_flow",
        "canvas_clear_flow",
        "canvas_write_sketch",
        "canvas_clear_sketch",
        "canvas_add_strokes",
        "canvas_update_stroke",
        "canvas_delete_strokes",
        "canvas_export",
        "mkdir",
        "preview_patch",
        "patch_file",
        "apply_patch",
        "delete_file",
        "office_write_docx",
        "office_write_xlsx",
        "office_edit_xlsx_cells",
        "office_write_pptx",
        "office_docx_replace",
        "office_apply_template",
        "office_open",
        "shell_exec",
        "clipboard_set",
        "open_program",
        "ide_open",
        "vscode_open",
        "vscode_save",
        "vscode_reload_window",
        "delivery_review_status",
        "escalate_delivery_to_boss",
        "voice_route_probe",
        "voice_set_tone",
        "voice_set_cosy_instruct",
        "voice_clear_override",
        "browser_open",
        "browser_goto",
        "browser_click",
        "browser_type",
        "browser_assert",
        "browser_screenshot",
        "defect_write",
        "defect_assign_fix",
        "run_ui_acceptance",
        "dispatch_defect_fix",
        "app_launch",
        "screenshot_window",
        "gui_bind_target",
        "input_click",
        "input_type",
        "ui_focus_window",
        "ui_list_elements",
        "ui_click_element",
        "gui_record_start",
        "gui_record_stop",
        "gui_replay",
    ];

    fn only(field: &str) -> Option<ProjectToolPolicy> {
        let mut policy = ProjectToolPolicy::conservative();
        match field {
            "read" => policy.read_files = true,
            "write" => policy.write_files = true,
            "shell" => policy.shell = true,
            "browser" => policy.browser = true,
            "gui" => policy.gui_input = true,
            "ide" => policy.ide = true,
            "mcp" => policy.mcp = true,
            _ => unreachable!(),
        }
        Some(policy)
    }

    #[test]
    fn missing_empty_and_unknown_tools_fail_closed() {
        assert!(!project_policy_allows(&only("read"), ""));
        assert!(!project_policy_allows(&only("read"), "future_unknown_tool"));
        assert!(!project_policy_allows(&None, "write_file"));
        assert!(!project_policy_allows(&None, "shell_exec"));
    }

    #[test]
    fn none_policy_allows_read_and_canvas() {
        assert!(project_policy_allows(&None, "read_file"));
        assert!(project_policy_allows(&None, "list_dir"));
        assert!(project_policy_allows(&None, "canvas_write_sketch"));
        assert!(project_policy_allows(&None, "canvas_add_strokes"));
        assert!(project_policy_allows(&None, "canvas_list"));
        assert!(project_policy_allows(&None, "canvas_export"));
    }

    #[test]
    fn canvas_tools_follow_read_files_not_write_files() {
        for name in [
            "canvas_list",
            "canvas_read",
            "canvas_write_mermaid",
            "canvas_write_flow",
            "canvas_clear_flow",
            "canvas_write_sketch",
            "canvas_clear_sketch",
            "canvas_add_strokes",
            "canvas_update_stroke",
            "canvas_delete_strokes",
            "canvas_export",
        ] {
            assert!(project_policy_allows(&only("read"), name), "{name}");
            let no_read = Some(ProjectToolPolicy {
                read_files: false,
                write_files: true,
                ..ProjectToolPolicy::conservative()
            });
            assert!(!project_policy_allows(&no_read, name), "{name}");
        }
        assert!(!project_policy_allows(&only("read"), "write_file"));
        assert!(project_policy_allows(&only("write"), "write_file"));
    }

    #[test]
    fn maps_sensitive_tool_families_to_explicit_permissions() {
        for name in [
            "office_write_docx",
            "office_write_xlsx",
            "office_write_pptx",
            "office_docx_replace",
            "office_edit_xlsx_cells",
            "office_apply_template",
        ] {
            assert!(project_policy_allows(&only("write"), name), "{name}");
            assert!(!project_policy_allows(&only("read"), name), "{name}");
        }
        assert!(project_policy_allows(&only("shell"), "open_program"));
        assert!(!project_policy_allows(&only("write"), "open_program"));
        assert!(project_policy_allows(&only("gui"), "input_click"));
        assert!(!project_policy_allows(&only("shell"), "input_click"));
    }

    #[test]
    fn every_published_builtin_tool_has_an_explicit_mapping() {
        let all = Some(ProjectToolPolicy {
            read_files: true,
            write_files: true,
            shell: true,
            browser: true,
            gui_input: true,
            ide: true,
            mcp: true,
            mcp_tools_allowlist: None,
        });
        for name in ALL_BUILTIN_TOOLS {
            assert!(project_policy_allows(&all, name), "unmapped tool: {name}");
        }
    }

    #[test]
    fn mcp_allowlist_empty_denies_even_when_mcp_on() {
        let p = Some(ProjectToolPolicy {
            read_files: true,
            write_files: false,
            shell: false,
            browser: false,
            gui_input: false,
            ide: false,
            mcp: true,
            mcp_tools_allowlist: Some(vec![]),
        });
        assert!(!project_policy_allows(&p, "mcp__fs__read"));
    }

    #[test]
    fn mcp_allowlist_star_and_key() {
        let star = Some(ProjectToolPolicy {
            mcp: true,
            mcp_tools_allowlist: Some(vec!["*".into()]),
            ..ProjectToolPolicy::conservative()
        });
        assert!(project_policy_allows(&star, "mcp__fs__read"));
        let keyed = Some(ProjectToolPolicy {
            mcp: true,
            mcp_tools_allowlist: Some(vec!["fs.read".into()]),
            ..ProjectToolPolicy::conservative()
        });
        assert!(project_policy_allows(&keyed, "mcp__fs__read"));
        assert!(!project_policy_allows(&keyed, "mcp__fs__write"));
    }
}
