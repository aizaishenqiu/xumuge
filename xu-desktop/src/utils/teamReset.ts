import { appendFouMessage } from "../employee";
import { BRAND_NAME_ZH } from "./brandSettings";
import { isWorkWaitDefer, shouldKickoffAfterReset } from "./bossStopIntent";
import { notifyBoss } from "./channelConnections";
import { resetAndReplanTask } from "./projectDispatchHints";

export interface HaltTeamResult {
  cancelledSessions: number;
  employeesReset: number;
  checkpointsCleared: number;
}

export interface TeamResetDeps {
  sessionTag: string;
  playbookPath?: string;
  haltTeam: () => Promise<HaltTeamResult>;
  kickoffTeam: (bossText: string) => Promise<void>;
}

export async function executeTeamReset(
  text: string,
  deps: TeamResetDeps,
  options?: { skipBossBroadcast?: boolean },
): Promise<void> {
  const r = await deps.haltTeam();
  if (!options?.skipBossBroadcast) {
    await appendFouMessage({
      sessionTag: deps.sessionTag,
      role: "boss",
      content: `@所有人 ${text}`,
    });
  }
  if (isWorkWaitDefer(text)) {
    await appendFouMessage({
      sessionTag: deps.sessionTag,
      role: "system",
      content: [
        `🛑 已全员停工（${r.employeesReset} 人）`,
        r.cancelledSessions ? `· 已取消 ${r.cancelledSessions} 个在跑会话` : "",
        "⏸ 已记录待命：本条含「等我通知/先别开始」等，**未派活**。",
        "员工不会继续写文件。要开工请发「全体开工」或「开始干活」。",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return;
  }
  if (!shouldKickoffAfterReset(text)) return;

  await appendFouMessage({
    sessionTag: deps.sessionTag,
    role: "system",
    content: [
      `🛑 已停止 ${r.employeesReset} 人，开始清理重整…`,
      r.cancelledSessions ? `· 已取消 ${r.cancelledSessions} 个在跑会话` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });
  await deps.kickoffTeam(resetAndReplanTask(text, deps.playbookPath));
}

/** 全员停工重整派活任务（与 resetAndReplanTask 正文标记一致）。 */
export function isTeamResetKickoffTask(bossText: string): boolean {
  return bossText.includes("【全员停工重整");
}

/** 清理重规划全员 agent 结束后，通知飞书 / 多端连接已配置 IM。 */
export async function notifyResetReplanComplete(opts: {
  projectName?: string;
  generatePath: string;
  dispatched: number;
  completed: number;
  timedOut: boolean;
}): Promise<void> {
  const proj = opts.projectName?.trim() || "当前项目";
  const body = [
    `【清理重规划 · 已完成】${proj}`,
    `生成路径：${opts.generatePath}`,
    `本轮 ${opts.dispatched} 人已派活，${opts.completed} 人 agent 已结束。`,
    opts.timedOut ? "⚠️ 部分员工超时未结束，请进办公室查看明细。" : "",
    "",
    "详情见办公室协作条与生成目录。",
  ]
    .filter(Boolean)
    .join("\n");
  await notifyBoss({
    kind: "reset_replan_done",
    title: `${BRAND_NAME_ZH} · 清理重规划完成`,
    body,
    force: true,
  });
}
