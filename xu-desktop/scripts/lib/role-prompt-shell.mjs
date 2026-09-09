/**
 * Runtime prompt shell (Chinese context block). Body markdown is stored separately in role packs.
 */

export const CHINA_BLOCK = `
## 🇨🇳 中国工作语境（强制）
- **语言**：默认简体中文思考与交付；专有名词可中英并用，正文勿整段英文。
- **法规优先**：个人信息保护法、网络安全法、数据安全法、劳动法/劳动合同法、广告法、电子商务法、未成年人网络保护；外标（GDPR/HIPAA/SOX/FedRAMP）仅作对照，落地须映射国内要求。
- **协作默认**：飞书 / 企业微信 / 钉钉；代码托管 Gitee 或 GitHub；云优先阿里云 / 腾讯云 / 华为云（项目另有约定除外）。
- **身份与支付**：实名、短信验证码、微信/支付宝；勿默认 SSN、401(k)、Stripe-only。
- **增长与内容**：国内优先抖音、小红书、视频号、公众号、百度、知乎、B站、快手、微博；海外渠道须标明「出海」场景。
- **组织习惯**：汇报用结论先行；交付含假设、步骤与验收标准；涉政/敏感内容先请示老板。
`.trim();

export const BODY_MARKER = "—— 完整岗位说明 ——";

/**
 * @param {{ nameZh: string; divisionZh?: string; division: string }} role
 */
export function buildPromptShell(role) {
  const name = role.nameZh || "岗位";
  const dept = role.divisionZh || role.division || "通用";
  return [
    `你是「${name}」。`,
    `所属部门：${dept}。`,
    "请严格按下列完整岗位说明工作；默认用中文回复（除非用户要求其他语言）。",
    "",
    CHINA_BLOCK,
    "",
    "交付时说明假设、步骤与验收标准；不确定处先提问再动手。",
    BODY_MARKER,
  ].join("\n");
}

/**
 * @param {{ nameZh: string; divisionZh?: string; division: string; bodyMd: string }} role
 */
export function buildFullPrompt(role) {
  const shell = buildPromptShell(role);
  const body = (role.bodyMd || "").trim();
  return body ? `${shell}\n${body}` : shell;
}

/**
 * Extract markdown body from a legacy full prompt.
 * @param {string} prompt
 */
export function extractBodyFromPrompt(prompt) {
  if (!prompt) return "";
  const i = prompt.indexOf(BODY_MARKER);
  if (i < 0) return prompt.trim();
  return prompt.slice(i + BODY_MARKER.length).replace(/^\s*\n/, "").trim();
}
