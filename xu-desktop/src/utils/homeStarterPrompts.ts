/**
 * @file 空对话可点示例话术（财务 / 招投标 / 获客）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-05
 * @version 1.0.0
 * @category UI
 * @algo empty-chat-starter-chips
 */

export type HomeStarterPrompt = {
  id: string;
  icon: string;
  label: string;
  text: string;
};

export const HOME_STARTER_PROMPTS: HomeStarterPrompt[] = [
  {
    id: "cashier",
    icon: "wallet-3-line",
    label: "出纳日清",
    text: "帮我做出纳日清：列银行日记账、库存现金与未达账核对要点，并给出当日可勾选清单。",
  },
  {
    id: "bid",
    icon: "file-search-line",
    label: "招投标审阅",
    text: "帮我审阅招投标材料：先列资格与废标风险检查清单，再指出正文里需要补的条款。",
  },
  {
    id: "leads",
    icon: "mail-send-line",
    label: "获客草稿",
    text: "帮我获客：先写理想客户画像和一封个性化企微或邮件草稿。发出前必须等我确认，禁止群发。",
  },
];
