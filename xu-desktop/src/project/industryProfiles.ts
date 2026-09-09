/**
 * @file 项目行业 id、中文名与默认档案
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-05
 * @version 1.1.0
 * @category Config
 * @algo none
 */
/** Per-industry project profile (discriminated union). Align ids with taxonomy-industries.json. */

export type IndustryId =
  | "software"
  | "engineering"
  | "finance"
  | "events"
  | "marketing"
  | "design"
  | "product"
  | "education"
  | "healthcare"
  | "consulting"
  | "operations"
  | "general";

export type FinanceSensitivity = "public" | "internal" | "confidential";

export type FinanceProfile = {
  kind: "finance";
  fiscalYear?: string;
  dataSources: string[];
  sensitivity: FinanceSensitivity;
  outputFormats: string[];
};

export type EventsProfile = {
  kind: "events";
  eventDateStart?: string;
  eventDateEnd?: string;
  venue?: string;
  budgetCap?: string;
  deliverableTypes: string[];
};

export type MarketingProfile = {
  kind: "marketing";
  channels: string[];
  campaignGoal?: string;
  contentCalendarPath?: string;
};

export type DesignProfile = {
  kind: "design";
  brandName?: string;
  deliverableFormats: string[];
  assetDir?: string;
};

export type ConsultingProfile = {
  kind: "consulting";
  engagementScope?: string;
  milestones?: string;
};

export type OperationsProfile = {
  kind: "operations";
  scopeNotes?: string;
};

export type GeneralProfile = {
  kind: "general";
  notes?: string;
};

export type SoftwareProfile = {
  kind: "software";
};

export type IndustryProfile =
  | SoftwareProfile
  | FinanceProfile
  | EventsProfile
  | MarketingProfile
  | DesignProfile
  | ConsultingProfile
  | OperationsProfile
  | GeneralProfile;

export const INDUSTRY_LABEL: Record<IndustryId, string> = {
  software: "软件研发",
  engineering: "工程研发",
  finance: "金融数据",
  events: "活动策划",
  marketing: "市场运营",
  design: "创意设计",
  product: "产品",
  education: "教育",
  healthcare: "医疗健康",
  consulting: "咨询",
  operations: "内部运营",
  general: "通用办公",
};

export const INDUSTRY_ICONS: Record<IndustryId, string> = {
  software: "code-box-line",
  engineering: "cpu-line",
  finance: "money-cny-circle-line",
  events: "calendar-event-line",
  marketing: "megaphone-line",
  design: "palette-line",
  product: "product-hunt-line",
  education: "book-open-line",
  healthcare: "heart-pulse-line",
  consulting: "briefcase-line",
  operations: "settings-3-line",
  general: "building-line",
};

export const FINANCE_SENSITIVITY_OPTIONS: { value: FinanceSensitivity; label: string }[] = [
  { value: "public", label: "公开" },
  { value: "internal", label: "内部" },
  { value: "confidential", label: "机密" },
];

export const OUTPUT_FORMAT_OPTIONS = ["xlsx", "pdf", "csv", "docx", "pptx"];

export const MARKETING_CHANNEL_OPTIONS = [
  "微信",
  "抖音",
  "小红书",
  "百度",
  "私域",
  "线下活动",
  "其他",
];

export const EVENT_DELIVERABLE_OPTIONS = ["方案", "物料清单", "执行表", "预算表", "复盘报告"];

export const DESIGN_FORMAT_OPTIONS = ["品牌手册", "UI 稿", "海报", "视频脚本", "PPT"];

export function defaultIndustryProfile(id: IndustryId): IndustryProfile {
  switch (id) {
    case "finance":
      return { kind: "finance", dataSources: [], sensitivity: "internal", outputFormats: ["xlsx"] };
    case "events":
      return { kind: "events", deliverableTypes: ["方案", "执行表"] };
    case "marketing":
      return { kind: "marketing", channels: [], campaignGoal: "" };
    case "design":
      return { kind: "design", deliverableFormats: ["品牌手册"], assetDir: "" };
    case "consulting":
      return { kind: "consulting", engagementScope: "", milestones: "" };
    case "operations":
      return { kind: "operations", scopeNotes: "" };
    case "software":
    case "engineering":
    case "product":
      return { kind: "software" };
    default:
      return { kind: "general", notes: "" };
  }
}

export function normalizeIndustryProfile(
  id: IndustryId,
  raw: unknown,
): IndustryProfile | null {
  if (!raw || typeof raw !== "object") return defaultIndustryProfile(id);
  const o = raw as Record<string, unknown>;
  const kind = String(o.kind || id);
  switch (id) {
    case "finance": {
      const sens = o.sensitivity;
      const sensitivity: FinanceSensitivity =
        sens === "public" || sens === "confidential" ? sens : "internal";
      return {
        kind: "finance",
        fiscalYear: o.fiscalYear ? String(o.fiscalYear) : undefined,
        dataSources: Array.isArray(o.dataSources) ? o.dataSources.map(String) : [],
        sensitivity,
        outputFormats: Array.isArray(o.outputFormats)
          ? o.outputFormats.map(String)
          : ["xlsx"],
      };
    }
    case "events":
      return {
        kind: "events",
        eventDateStart: o.eventDateStart ? String(o.eventDateStart) : undefined,
        eventDateEnd: o.eventDateEnd ? String(o.eventDateEnd) : undefined,
        venue: o.venue ? String(o.venue) : undefined,
        budgetCap: o.budgetCap ? String(o.budgetCap) : undefined,
        deliverableTypes: Array.isArray(o.deliverableTypes)
          ? o.deliverableTypes.map(String)
          : ["方案"],
      };
    case "marketing":
      return {
        kind: "marketing",
        channels: Array.isArray(o.channels) ? o.channels.map(String) : [],
        campaignGoal: o.campaignGoal ? String(o.campaignGoal) : undefined,
        contentCalendarPath: o.contentCalendarPath
          ? String(o.contentCalendarPath)
          : undefined,
      };
    case "design":
      return {
        kind: "design",
        brandName: o.brandName ? String(o.brandName) : undefined,
        deliverableFormats: Array.isArray(o.deliverableFormats)
          ? o.deliverableFormats.map(String)
          : [],
        assetDir: o.assetDir ? String(o.assetDir) : undefined,
      };
    case "consulting":
      return {
        kind: "consulting",
        engagementScope: o.engagementScope ? String(o.engagementScope) : undefined,
        milestones: o.milestones ? String(o.milestones) : undefined,
      };
    case "operations":
      return {
        kind: "operations",
        scopeNotes: o.scopeNotes ? String(o.scopeNotes) : undefined,
      };
    case "software":
    case "engineering":
    case "product":
      return { kind: "software" };
    default:
      if (kind !== "general") return defaultIndustryProfile("general");
      return { kind: "general", notes: o.notes ? String(o.notes) : undefined };
  }
}
