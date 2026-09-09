//! Xu Native Agent 模块注册（无 Hermes CLI）。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @version 1.0.0
//! @category AgentLoop
//! @algo none

pub mod events;
pub mod gui_record;
pub mod gui_safety;
pub mod gui_tools;
pub mod gui_uia;
pub mod host_capacity;
pub mod ide_release;
pub mod memory_extract;
pub mod memory_recall;
pub mod office_tools;
pub mod playbook;
pub mod prefs;
pub mod process_control;
pub mod qa_tools;
pub mod rg_util;
pub mod sanitize;
pub mod snapshots;
pub mod stream;
pub mod tool_policy;
pub mod tools;

pub use stream::{
    xu_agent_cancel, xu_agent_stream, run_agent_loop, run_chat_completion, AgentEndpoint,
    AgentMessage, AgentRunOpts, AgentRunRequest,
};
