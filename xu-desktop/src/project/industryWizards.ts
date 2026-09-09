/**
 * @file 各行业项目创建向导配置
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-05
 * @version 1.1.0
 * @category Config
 * @algo none
 */
import type { IndustryId } from "./industryProfiles";

import type { ProjectType } from "../utils/projects";



export type WizardStepId =

  | "basics"

  | "stack"

  | "requirements"

  | "tool_policy"

  | "confirm";



export type IndustryWizardConfig = {

  industryId: IndustryId;

  projectType: ProjectType;

  recommendedPackId: string;

  steps: { id: WizardStepId; title: string }[];

};



const COMMON_TAIL: IndustryWizardConfig["steps"] = [

  { id: "requirements", title: "需求" },

  { id: "tool_policy", title: "Agent 工具权限" },

  { id: "confirm", title: "确认" },

];



const WIZARDS: Record<IndustryId, IndustryWizardConfig> = {

  software: {

    industryId: "software",

    projectType: "software",

    recommendedPackId: "software-company",

    steps: [

      { id: "basics", title: "基本信息" },

      { id: "stack", title: "端与目录" },

      ...COMMON_TAIL,

    ],

  },

  engineering: {

    industryId: "engineering",

    projectType: "software",

    recommendedPackId: "software-company",

    steps: [

      { id: "basics", title: "基本信息" },

      { id: "stack", title: "端与目录" },

      ...COMMON_TAIL,

    ],

  },

  product: {

    industryId: "product",

    projectType: "software",

    recommendedPackId: "software-company",

    steps: [

      { id: "basics", title: "基本信息" },

      { id: "stack", title: "端与目录" },

      ...COMMON_TAIL,

    ],

  },

  education: {

    industryId: "education",

    projectType: "consulting",

    recommendedPackId: "general_sme",

    steps: [{ id: "basics", title: "基本信息" }, ...COMMON_TAIL],

  },

  healthcare: {

    industryId: "healthcare",

    projectType: "consulting",

    recommendedPackId: "general_sme",

    steps: [{ id: "basics", title: "基本信息" }, ...COMMON_TAIL],

  },

  finance: {

    industryId: "finance",

    projectType: "consulting",

    recommendedPackId: "sales_finance",

    steps: [{ id: "basics", title: "基本信息" }, ...COMMON_TAIL],

  },

  events: {

    industryId: "events",

    projectType: "delivery",

    recommendedPackId: "general_sme",

    steps: [{ id: "basics", title: "基本信息" }, ...COMMON_TAIL],

  },

  marketing: {

    industryId: "marketing",

    projectType: "internal",

    recommendedPackId: "china-growth",

    steps: [{ id: "basics", title: "基本信息" }, ...COMMON_TAIL],

  },

  design: {

    industryId: "design",

    projectType: "delivery",

    recommendedPackId: "software-company",

    steps: [{ id: "basics", title: "基本信息" }, ...COMMON_TAIL],

  },

  consulting: {

    industryId: "consulting",

    projectType: "consulting",

    recommendedPackId: "general_sme",

    steps: [{ id: "basics", title: "基本信息" }, ...COMMON_TAIL],

  },

  operations: {

    industryId: "operations",

    projectType: "internal",

    recommendedPackId: "general_sme",

    steps: [{ id: "basics", title: "基本信息" }, ...COMMON_TAIL],

  },

  general: {

    industryId: "general",

    projectType: "other",

    recommendedPackId: "general_sme",

    steps: [{ id: "basics", title: "基本信息" }, ...COMMON_TAIL],

  },

};



export function getWizardForIndustry(id: IndustryId): IndustryWizardConfig {

  return WIZARDS[id] ?? WIZARDS.general;

}



export function industryToProjectType(id: IndustryId): ProjectType {

  return getWizardForIndustry(id).projectType;

}



export function projectTypeToIndustry(type: ProjectType): IndustryId {

  switch (type) {

    case "software":

      return "software";

    case "delivery":

      return "events";

    case "consulting":

      return "consulting";

    case "internal":

      return "operations";

    default:

      return "general";

  }

}



export function inferIndustryId(

  industryId: unknown,

  type: ProjectType | undefined,

): IndustryId {

  const ids = Object.keys(WIZARDS) as IndustryId[];

  if (typeof industryId === "string" && ids.includes(industryId as IndustryId)) {

    return industryId as IndustryId;

  }

  return projectTypeToIndustry(type ?? "other");

}

