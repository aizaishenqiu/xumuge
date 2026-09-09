/**
 * @file 按 Brief 规模/身份档位生成架构说明段落
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category Parse
 * @algo scale-tier-arch-recommendation
 */
import type { IdentityModel, RequirementBrief, UsageScaleTier } from "./briefTypes";
import {
  formatIdentityModelLabel,
  formatUsageScaleLabel,
  isIdentityModelSpecified,
  isUsageScaleSpecified,
} from "./briefTypes";

export type ArchitectureRecommendation = {
  planA: string;
  planB: string;
  whyNotOverEngineer: string;
  authTenantNotes: string;
};

function effectiveScale(brief: RequirementBrief): UsageScaleTier {
  if (isUsageScaleSpecified(brief.usageScaleTier)) return brief.usageScaleTier!;
  if (/saas|多租户|几千|上万/i.test(`${brief.audience} ${brief.architectureNotes}`)) return "saas";
  if (/几百|单组织|园区/i.test(`${brief.audience} ${brief.architectureNotes}`)) return "org";
  if (/小团队|部门/i.test(brief.audience || "")) return "team";
  return "team";
}

function effectiveIdentity(brief: RequirementBrief): IdentityModel {
  if (isIdentityModelSpecified(brief.identityModel)) return brief.identityModel!;
  if (/多租户|saas|tenant/i.test(brief.architectureNotes || "")) return "multi_tenant";
  if (/会员|c端/i.test(`${brief.audience} ${brief.architectureNotes}`)) return "member_portal";
  if (/无登录|单机/i.test(brief.architectureNotes || "")) return "none";
  return "simple_account";
}

/** 按规模与身份模型输出可落地架构建议（启发式，非绑定具体框架）。 */
export function recommendArchitecture(brief: RequirementBrief): ArchitectureRecommendation {
  const scale = effectiveScale(brief);
  const identity = effectiveIdentity(brief);
  const scaleLabel = formatUsageScaleLabel(scale);
  const identityLabel = formatIdentityModelLabel(identity);

  if (scale === "personal" || scale === "team") {
    return {
      planA: `**方案 A（推荐）**：前后端分离**单体**；单库（SQLite/单实例 PG）；${identity === "none" ? "无登录或简单本地会话" : "Session/JWT 简单鉴权"}；静态资源 CDN 可选。规模：${scaleLabel}。`,
      planB: "**方案 B（备选）**：仅当 Brief 明确多端同步且 >200 并发时再考虑读写分离或缓存层。",
      whyNotOverEngineer:
        "当前规模不建议微服务、消息队列或多租户中间件；优先交付速度与可测性。",
      authTenantNotes: `身份模型：${identityLabel}。${identity === "multi_tenant" || identity === "hybrid" ? "若确需 SaaS，请在 TECH_DESIGN 明确 tenant_id 策略后再开发。" : "单组织 RBAC 即可。"}`,
    };
  }

  if (scale === "org") {
    return {
      planA: `**方案 A（推荐）**：模块化单体 + 连接池；RBAC 权限；基础缓存（热点读）；按 scopeIn 划分模块目录。规模：${scaleLabel}。`,
      planB: "**方案 B（备选）**：读写分离或独立任务队列——仅当 performance_sla 明确高并发再启用。",
      whyNotOverEngineer: "单组织场景默认不上微服务拆分；先保证事务一致与可观测。",
      authTenantNotes: `身份模型：${identityLabel}。建议统一账号体系 + 审计日志；跨组织数据须 Boss 确认。`,
    };
  }

  const tenantStrategy =
    identity === "multi_tenant" || identity === "hybrid"
      ? "租户 ID 贯穿 API/数据层；隔离策略三选一：独立 schema / 行级 tenant_id / 列级标记（默认推荐行级 tenant_id + 索引）"
      : "若仅 B 端 SaaS：每客户一租户；C 端会员与租户关系须在 Brief Won't 中写清本期是否做";

  return {
    planA: `**方案 A（推荐）**：多租户 SaaS 单体或少量服务；${tenantStrategy}；注册/onboarding、租户管理员、计费占位（若 Won't 则不做）。`,
    planB: "**方案 B（备选）**：核心服务 + BFF——仅当多团队并行且模块边界已冻结时考虑。",
    whyNotOverEngineer: "未确认计费/会员范围前不得预埋复杂订阅引擎；先打通租户隔离与核心流程。",
    authTenantNotes: `身份模型：${identityLabel}。必须定义：租户注册、管理员、成员邀请、数据导出/删除（合规）。`,
  };
}

export function formatArchitectureRecommendationBlock(brief: RequirementBrief): string {
  const rec = recommendArchitecture(brief);
  const scale = effectiveScale(brief);
  const identity = effectiveIdentity(brief);
  return [
    "### 规模与身份（Brief）",
    `- 规模档位：${formatUsageScaleLabel(scale)}`,
    `- 身份/租户：${formatIdentityModelLabel(identity)}`,
    brief.audience?.trim() ? `- 用户画像：${brief.audience.trim()}` : "",
    "",
    "### 推荐方案 A",
    rec.planA,
    "",
    "### 方案 B（条件启用）",
    rec.planB,
    "",
    "### 为何不默认微服务/多租户",
    rec.whyNotOverEngineer,
    "",
    "### 身份与租户",
    rec.authTenantNotes,
  ]
    .filter(Boolean)
    .join("\n");
}
