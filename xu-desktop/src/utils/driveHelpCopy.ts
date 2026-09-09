/** Copy for the Settings “编码驾驶” help dialog. */

export const DRIVE_HELP_TITLE = "什么是编码驾驶？";

export const DRIVE_HELP_SECTIONS: Array<{ title: string; body: string }> = [
  {
    title: "总览",
    body:
      "编码驾驶让 AI 员工去操作 Cursor / IDE 写代码、点确认，而不是只在聊天里回复文字。办公室里的「代点确认」「键鼠控 IDE」都依赖这里的开关。",
  },
  {
    title: "启用编码驾驶",
    body: "总开关。关闭后，办公室与员工无法发起驾驶或代确认。",
  },
  {
    title: "Cursor SDK",
    body: "走 Cursor 官方 SDK 能力路径（适合已接入 SDK 的场景）。",
  },
  {
    title: "键鼠驾驶",
    body:
      "向白名单窗口模拟键盘鼠标输入。必须先勾选下方风险同意；注入仅针对标题匹配白名单的窗口。驾驶中若你本人操作键鼠，注入会立即停止。",
  },
  {
    title: "截图投 Cursor",
    body: "代确认时截取 Cursor 窗口画面并附到对话，方便审核员对照界面。",
  },
  {
    title: "默认审核员 / 白名单",
    body:
      "代点确认时优先派给指定审核员；窗口白名单用标题关键字过滤，避免误操作其他软件。",
  },
];

export const DRIVE_RISK_TITLE = "键鼠驾驶风险警示";

export const DRIVE_RISK_SECTIONS: Array<{ title: string; body: string }> = [
  {
    title: "会做什么",
    body:
      "启用并同意后，虚募阁可向白名单窗口（默认标题含 Cursor）模拟键盘与鼠标输入，用于代点确认、在 IDE 内执行约定操作。注入范围受窗口白名单约束，但仍属对桌面的自动控制。",
  },
  {
    title: "主要风险",
    body:
      "可能点错按钮、误改文件、误提交或触发不可逆操作；若白名单过宽，也可能作用到其它同名窗口。驾驶过程中请勿同时手动操作目标窗口，以免冲突。",
  },
  {
    title: "你可随时停止",
    body:
      "驾驶中若你本人操作键鼠，注入会立即停止且不会自动恢复。也可随时取消本同意、关闭「键鼠驾驶」或关闭「启用编码驾驶」总开关。",
  },
  {
    title: "当前能力说明",
    body:
      "完整系统级 SendInput 仍在完善中；同意表示你知晓风险并允许在能力可用时使用键鼠路径。截图投 Cursor、审核员派活可单独开关，不必然等于已开启键鼠注入。",
  },
];
