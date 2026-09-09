/**
 * Company-type staffing presets for batch hire.
 * Each preset lists agency role ids + default rooms.
 */

import type { StaffedRoomKind } from "./defaultLayout";

export type CompanyStaffingPresetId =
  | "software_full"
  | "software_startup"
  | "software_outsource"
  | "sales_finance"
  | "general_sme";

export type CompanyStaffingPreset = {
  id: CompanyStaffingPresetId;
  name: string;
  description: string;
  icon: string;
  roleIds: string[];
  rooms: StaffedRoomKind[];
};

export const COMPANY_STAFFING_PRESETS: CompanyStaffingPreset[] = [
  {
    id: "software_full",
    name: "软件公司（完整编制）",
    description: "产品/设计/前后端/测试/运维/安全/项目/支持 — 做软件产品所需核心岗",
    icon: "code-box-line",
    roleIds: [
      "16037910679390394722",
      "25675230290599090710",
      "35671419686152705612",
      "6125214614612481268",
      "6125214614612481268",
      "15116902864854847567",
      "15116902864854847567",
      "7084477204507270632",
      "1336157153429428281",
      "32413536923064341397",
      "8006305619126655581",
      "6498566562038029790",
      "23434772301045963504",
      "888801383585814754",
      "34574977754453906317",
      "22149760307607770316",
      "26786141295500991319",
      "32558903181967495702",
      "19730613301965626145",
      "7857282669250483458",
    ],
    rooms: ["room_tech", "room_code", "room_sales", "room_finance"],
  },
  {
    id: "software_startup",
    name: "软件创业团队",
    description: "小而全：产品 + 开发 + 设计 + 测试 + 运维",
    icon: "rocket-line",
    roleIds: [
      "16037910679390394722",
      "6125214614612481268",
      "15116902864854847567",
      "25675230290599090710",
      "23434772301045963504",
      "32413536923064341397",
    ],
    rooms: ["room_tech", "room_code"],
  },
  {
    id: "software_outsource",
    name: "软件外包交付队",
    description: "项目经理 + 开发 + 测试 + 客服，偏交付",
    icon: "building-2-line",
    roleIds: [
      "26786141295500991319",
      "6125214614612481268",
      "6125214614612481268",
      "15116902864854847567",
      "23434772301045963504",
      "888801383585814754",
      "19730613301965626145",
      "6498566562038029790",
    ],
    rooms: ["room_tech", "room_code", "room_sales"],
  },
  {
    id: "sales_finance",
    name: "销售财务型公司",
    description: "销售 + 财务 + 客服 + 技术支持",
    icon: "funds-line",
    roleIds: [
      "33160270509703830027",
      "16692753904332578715",
      "18941673244828243430",
      "5461359939022886736",
      "19730613301965626145",
      "10102428310014400397",
    ],
    rooms: ["room_sales", "room_finance"],
  },
  {
    id: "general_sme",
    name: "综合中小企业",
    description: "战略 + 市场 + 销售 + 财务 + 项目",
    icon: "community-line",
    roleIds: [
      "24067813975284391124",
      "1632130055654219146",
      "33160270509703830027",
      "18941673244828243430",
      "19730613301965626145",
      "32558903181967495702",
    ],
    rooms: ["room_sales", "room_finance", "room_tech"],
  },
];

export function getCompanyStaffingPreset(id: string): CompanyStaffingPreset | undefined {
  return COMPANY_STAFFING_PRESETS.find((p) => p.id === id);
}
