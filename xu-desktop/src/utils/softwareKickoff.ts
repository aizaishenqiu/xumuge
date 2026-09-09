/** Software / general project kickoff checklist templates + allocation. */

import type { Employee } from "./employees";
import type { ProjectAssignment } from "./projectTheme";
import type { XuProject, KickoffPlan, KickoffStep, ProjectToolchain } from "./projects";
import { IDE_OPTIONS as IDE_REGISTRY } from "./ideCli";

export const KICKOFF_PLAN_VERSION = 1;

/** Icon-only shape for kickoff / project UI pickers. */
export const IDE_OPTIONS = IDE_REGISTRY.map((o) => ({
  id: o.id,
  label: o.label,
  icon: o.icon,
}));

const SOFTWARE_STEPS: KickoffStep[] = [
  {
    id: "align",
    title: "立项对齐",
    detail: "阅读文档区 README/需求/原型，确认生成路径可写，对齐范围与验收口径。",
    reads: ["docPath/README", "需求说明", "原型/设计"],
    outputs: ["范围确认纪要", "验收口径草稿"],
    ownerRole: "产品/老板",
    doneWhen: "团队对范围与路径无异议",
  },
  {
    id: "env",
    title: "环境与工具",
    detail: "按所选 IDE 与语言/包管理器初始化本地环境，保证可安装依赖与启动。",
    reads: ["toolchain", "现有脚本"],
    outputs: ["环境说明", "可运行命令清单"],
    ownerRole: "工程",
    doneWhen: "新人按文档可在 30 分钟内跑通",
  },
  {
    id: "skeleton",
    title: "仓库骨架",
    detail: "目录约定、CI 占位、.editorconfig / lint 基线落地。",
    reads: ["generatePath"],
    outputs: ["目录树", "CI 占位", ".editorconfig"],
    ownerRole: "工程",
    doneWhen: "空仓可 lint / 占位流水线绿",
  },
  {
    id: "arch",
    title: "架构切片",
    detail: "划定模块边界、接口草案与数据模型，避免后续返工。",
    reads: ["需求", "约束"],
    outputs: ["模块图", "接口草案", "数据模型"],
    ownerRole: "架构/高级工程",
    doneWhen: "接口与边界评审通过",
  },
  {
    id: "slice1",
    title: "垂直切片 1",
    detail: "打通最小可运行路径（冒烟）：一条主流程可演示。",
    reads: ["架构切片"],
    outputs: ["可演示路径", "冒烟记录"],
    ownerRole: "工程",
    doneWhen: "主路径冒烟通过",
  },
  {
    id: "quality",
    title: "质量门",
    detail: "lint / test / review 角色分工，卡住合并标准。",
    reads: ["垂直切片"],
    outputs: ["测试清单", "评审意见模板"],
    ownerRole: "审核员",
    doneWhen: "质量门可执行且有人负责",
  },
  {
    id: "deliver",
    title: "联调与交付",
    detail: "文档回写 generatePath，整理验收清单并完成联调。",
    reads: ["全部交付物"],
    outputs: ["交付说明", "验收清单"],
    ownerRole: "全员",
    doneWhen: "验收清单勾选完成",
  },
];

const GENERIC_STEPS: KickoffStep[] = [
  {
    id: "align",
    title: "立项对齐",
    detail: "确认目标、文档与产出路径。",
    reads: ["docPath"],
    outputs: ["目标确认"],
    doneWhen: "目标清晰",
  },
  {
    id: "plan",
    title: "任务拆分",
    detail: "按角色拆出可执行清单。",
    reads: ["目标"],
    outputs: ["任务清单"],
    doneWhen: "每人有明确职责",
  },
  {
    id: "execute",
    title: "执行与汇报",
    detail: "推进交付并回写进度到协作条。",
    reads: ["任务清单"],
    outputs: ["进度汇报"],
    doneWhen: "阶段目标完成",
  },
];

export function defaultToolchain(): ProjectToolchain {
  return {
    ide: "cursor",
    languages: ["TypeScript"],
    packageManager: "pnpm",
    repoStyle: "monorepo-or-app",
  };
}

export function buildDefaultKickoffPlan(type: XuProject["type"]): KickoffPlan {
  const steps = type === "software" ? SOFTWARE_STEPS : GENERIC_STEPS;
  return {
    version: KICKOFF_PLAN_VERSION,
    steps: steps.map((s) => ({ ...s, reads: [...s.reads], outputs: [...s.outputs] })),
    customRequirements: [],
    updatedAt: Date.now(),
  };
}

export function ensureKickoffPlan(project: XuProject): KickoffPlan {
  if (project.kickoffPlan?.steps?.length) {
    return {
      ...project.kickoffPlan,
      customRequirements: [...(project.kickoffPlan.customRequirements || [])],
      steps: project.kickoffPlan.steps.map((s) => ({
        ...s,
        reads: [...(s.reads || [])],
        outputs: [...(s.outputs || [])],
      })),
    };
  }
  return buildDefaultKickoffPlan(project.type);
}

function toolchainBrief(tc?: ProjectToolchain | null): string {
  if (!tc) return "（未选工具链）";
  const ide = IDE_OPTIONS.find((o) => o.id === tc.ide)?.label || tc.ide;
  const langs = (tc.languages || []).join(", ") || "—";
  return `IDE=${ide}${tc.ideNote ? `(${tc.ideNote})` : ""}；语言=${langs}；包管理=${tc.packageManager || "—"}；仓库=${tc.repoStyle || "—"}`;
}

/** Map kickoff steps (+ custom requirements) onto employee assignments. */
export function allocateSoftwareKickoff(
  project: XuProject,
  employees: Employee[],
): ProjectAssignment[] {
  const plan = ensureKickoffPlan(project);
  const custom = plan.customRequirements.filter((s) => s.trim());
  const workers = employees.filter((e) => project.employeeIds.includes(e.id) && e.roleKind !== "boss");
  const reviewers = workers.filter((e) => e.roleKind === "reviewer");
  const builders = workers.filter((e) => e.roleKind !== "reviewer");
  const pool = builders.length ? builders : workers;

  const stepBuckets = new Map<string, KickoffStep[]>();
  plan.steps.forEach((step, i) => {
    let owner: Employee | undefined;
    if (/审核|质量/.test(step.title) || step.ownerRole?.includes("审核")) {
      owner = reviewers[i % Math.max(1, reviewers.length)] || pool[i % Math.max(1, pool.length)];
    } else if (/产品|老板|对齐/.test(step.title + (step.ownerRole || ""))) {
      owner = pool[0] || workers[0];
    } else {
      owner = pool[i % Math.max(1, pool.length)] || workers[0];
    }
    if (!owner) return;
    const list = stepBuckets.get(owner.id) || [];
    list.push(step);
    stepBuckets.set(owner.id, list);
  });

  const tcLine = toolchainBrief(project.toolchain);
  const pathLine = `文档：${project.docPath || "—"}；生成：${project.generatePath || "—"}`;
  const playbookLine = project.requirements?.playbookPath
    ? `【必读 playbook】${project.requirements.playbookPath}`
    : "";
  const stackLines: string[] = [];
  const stack = project.stackProfile;
  if (stack) {
    const ends = [
      ["前端", stack.enabled?.frontend, stack.frontendDir, stack.frontendLang],
      ["后端", stack.enabled?.backend, stack.backendDir, stack.backendLang],
      ["UI", stack.enabled?.ui, stack.uiDir, stack.uiLang],
      ["桌面", stack.enabled?.desktop, stack.desktopDir, stack.desktopLang],
      ["App", stack.enabled?.app, stack.appDir, stack.appLang],
    ] as const;
    for (const [label, on, dir, lang] of ends) {
      if (on && dir) stackLines.push(`${label}=${dir}（${lang || "?"}）`);
    }
  }

  return workers.map((emp) => {
    const steps = stepBuckets.get(emp.id) || [];
    const checklist = [
      ...steps.map((s) => `${s.title}：${s.detail}`),
      ...custom.map((c) => `自定义需求：${c}`),
    ];
    if (checklist.length === 0) {
      checklist.push("阅读开工清单并认领相关步骤", "完成后更新协作条进度");
    }
    const duty =
      steps.length > 0
        ? `软件开工：负责「${steps.map((s) => s.title).join("、")}」`
        : `推进「${project.name}」开工清单中与「${emp.role}」相关的交付`;
    const prefix = [
      `【工具链】${tcLine}`,
      `【路径】${pathLine}`,
      playbookLine,
      stackLines.length ? `【目录地图】${stackLines.join("；")}` : "",
      "禁止猜测目录；落盘必须在声明路径内。",
    ].filter(Boolean);
    return {
      employeeId: emp.id,
      employeeName: emp.name,
      role: emp.role,
      duty,
      checklist: [...prefix, ...checklist],
      progress: 0,
      status: "pending" as const,
    };
  });
}

export function formatKickoffBrief(project: XuProject): string {
  const plan = ensureKickoffPlan(project);
  const lines = [
    `【开工清单 v${plan.version}】`,
    `工具链：${toolchainBrief(project.toolchain)}`,
  ];
  if (project.requirements?.playbookPath) {
    lines.push(`员工操作说明：${project.requirements.playbookPath}`);
  }
  if (project.stackProfile) {
    lines.push("目录地图（禁止猜测）：");
    const s = project.stackProfile;
    if (s.enabled?.frontend && s.frontendDir)
      lines.push(`- 前端：${s.frontendDir} · ${s.frontendLang || "?"}`);
    if (s.enabled?.backend && s.backendDir)
      lines.push(`- 后端：${s.backendDir} · ${s.backendLang || "?"}`);
    if (s.enabled?.ui && s.uiDir) lines.push(`- UI：${s.uiDir} · ${s.uiLang || "?"}`);
    if (s.enabled?.desktop && s.desktopDir)
      lines.push(`- 桌面：${s.desktopDir} · ${s.desktopLang || "?"}`);
    if (s.enabled?.app && s.appDir) lines.push(`- App：${s.appDir} · ${s.appLang || "?"}`);
  }
  lines.push(
    ...plan.steps.map(
      (s, i) =>
        `${i + 1}. ${s.title} — ${s.detail}${s.doneWhen ? `（完成：${s.doneWhen}）` : ""}`,
    ),
  );
  if (plan.customRequirements.length) {
    lines.push("【用户独立需求】");
    plan.customRequirements.forEach((c, i) => lines.push(`C${i + 1}. ${c}`));
  }
  return lines.join("\n");
}
