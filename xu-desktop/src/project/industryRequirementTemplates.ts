/**
 * @file 各行业需求富文本模板
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-05
 * @version 1.1.0
 * @category Config
 * @algo none
 */
import type { IndustryId } from "./industryProfiles";

function section(title: string, hint: string): string {
  return `<h2>${title}</h2><p>${hint}</p><p><br></p>`;
}

const TEMPLATES: Record<IndustryId, string> = {
  software: [
    section("项目背景", "简述业务场景、要解决什么问题。"),
    section("目标用户", "谁会用？使用场景与核心诉求。"),
    section("功能模块", "按模块列出功能点；可分级标题。"),
    section("非功能需求", "性能、安全、兼容、部署环境等。"),
    section("验收标准", "可验证的交付与验收条件。"),
  ].join(""),

  engineering: [
    section("工程背景", "设备、工艺或系统要解决的问题。"),
    section("技术约束", "标准、环境、接口与安全要求。"),
    section("交付物", "图纸、样机、文档与验收指标。"),
    section("验收标准", "可验证的性能与合规条件。"),
  ].join(""),

  product: [
    section("产品目标", "要解决的用户问题与成功标准。"),
    section("用户与场景", "谁在什么情境下使用。"),
    section("功能范围", "本期做 / 不做。"),
    section("验收标准", "可验证的发布条件。"),
  ].join(""),

  education: [
    section("教学对象", "学员画像、人数与先修条件。"),
    section("教学目标", "掌握什么、如何考核。"),
    section("内容与课时", "大纲、材料与节奏。"),
    section("验收", "结业标准与交付物。"),
  ].join(""),

  healthcare: [
    section("场景与对象", "科室/人群、使用场景。"),
    section("合规约束", "隐私、资质与流程红线。"),
    section("功能或服务范围", "本期覆盖与不覆盖。"),
    section("验收", "安全、可用性与交付标准。"),
  ].join(""),

  finance: [
    section("报表周期", "财年 / 季度 / 月度；截止日与刷新频率。"),
    section("数据源", "账套、系统导出路径、只读目录说明。"),
    section("合规与敏感级别", "公开 / 内部 / 机密；脱敏与权限要求。"),
    section("产出格式", "xlsx / pdf / csv 等及模板样例。"),
    section("交付节点", "里程碑、审核人与最终归档位置。"),
  ].join(""),

  events: [
    section("活动概述", "活动名称、目标受众、核心目标。"),
    section("时间地点", "起止日期、场地或线上平台。"),
    section("预算", "总预算、分项预算与审批要求。"),
    section("交付清单", "方案、物料、执行表、复盘报告等。"),
    section("风险与预案", "关键风险与备选方案。"),
  ].join(""),

  marketing: [
    section("Campaign 目标", "拉新 / 转化 / 品牌；量化 KPI。"),
    section("渠道", "公众号、短视频、投放、私域等。"),
    section("内容计划", "主题、频次、负责人、素材来源。"),
    section("KPI 与复盘", "核心指标、监测方式、复盘周期。"),
  ].join(""),

  design: [
    section("品牌信息", "品牌名、调性、现有规范链接。"),
    section("交付物", "Logo / VI / 海报 / 界面稿等清单。"),
    section("资产规范", "尺寸、格式、命名与存放目录。"),
    section("参考与禁忌", "参考案例、必须避免的元素。"),
  ].join(""),

  consulting: [
    section("项目范围", "In Scope / Out of Scope。"),
    section("里程碑", "阶段划分、交付物与时间点。"),
    section("交付标准", "文档格式、评审方式、验收人。"),
  ].join(""),

  operations: [
    section("范围", "本周期要完成的运营事项。"),
    section("目标", "可量化的运营目标。"),
    section("约束", "预算、人力、合规限制。"),
    section("验收", "完成定义与汇报方式。"),
  ].join(""),

  general: [
    section("范围", "项目边界与不在范围内的事项。"),
    section("目标", "希望达成的结果。"),
    section("约束", "时间、资源、合规等限制。"),
    section("验收", "如何判定项目完成。"),
  ].join(""),
};

export const REQUIREMENT_PLACEHOLDERS: Record<IndustryId, string> = {
  software: "按章节填写软件项目需求；可用标题区分模块。",
  engineering: "填写工程背景、技术约束与验收指标。",
  product: "填写产品目标、范围与验收条件。",
  education: "填写教学对象、目标与课时安排。",
  healthcare: "填写场景、合规约束与验收标准。",
  finance: "填写报表周期、数据源、合规与产出要求。",
  events: "填写活动要素、预算与交付清单。",
  marketing: "填写 campaign 目标、渠道与内容计划。",
  design: "填写品牌、交付物与资产规范。",
  consulting: "填写范围、里程碑与交付标准。",
  operations: "填写运营范围、目标与验收方式。",
  general: "按模板章节填写项目需求。",
};

export function getRequirementTemplate(industryId: IndustryId): string {
  return TEMPLATES[industryId] ?? TEMPLATES.general;
}

export function getRequirementPlaceholder(industryId: IndustryId): string {
  return REQUIREMENT_PLACEHOLDERS[industryId] ?? REQUIREMENT_PLACEHOLDERS.general;
}

/** True when HTML is empty or still the untouched industry template. */
export function isRequirementTemplateOnly(html: string, industryId: IndustryId): boolean {
  const stripped = html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  if (!stripped) return true;
  const tplStripped = getRequirementTemplate(industryId)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
  return stripped === tplStripped;
}
