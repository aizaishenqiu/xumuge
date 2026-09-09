/**
 * @file virmoor-business-prefix.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-05
 * @version 1.0.0
 * @category role-pack
 * @algo 业务行业前缀推断（专项→招投标/跨境等）；供 apply / nameZh labeler 共用
 */

export const NAMEZH_SEP = " · ";

export const WEAK_PREFIXES = new Set(["专项", "支持", "通用", "专业", ""]);

/** 已认定的业务前缀（非 division 默认「专项」）——labeler 不得覆盖 */
export const BUSINESS_PREFIXES = new Set([
  "招投标",
  "政务公文",
  "建筑施工",
  "跨境电商",
  "付费广告",
  "短视频运营",
  "财务税务",
  "人力资源",
  "法务合规",
  "供应链",
  "客户成功",
  "汽车出行",
  "半导体",
  "能源双碳",
  "餐饮文旅",
  "医疗健康",
  "教育培训",
  "质量管理",
  "产品运营",
  "运营",
  "软件研发",
  "销售增长",
  "内容创作",
  "心理咨询",
  "求职发展",
  "办公效率",
  "数据分析",
  "品牌营销",
  "国际商务",
  "综合业务",
  "学术",
  "行政",
  "农业",
  "董办",
  "咨询",
  "设计",
  "教育",
  "能源",
  "财务",
  "金融服务",
  "游戏",
  "地理信息",
  "医疗",
  "知识产权",
  "法务",
  "制造",
  "市场营销",
  "传媒",
  "公益",
  "营养",
  "付费媒体",
  "党务工会",
  "采购",
  "产品",
  "项目管理",
  "房地产",
  "零售",
  "风控内审",
  "销售",
  "安全",
  "空间计算",
  "战略",
  "测试",
  "文旅",
]);

/**
 * 强规则：优先匹配 nameZh / tags / catalog（避免正文误伤）
 * 顺序即优先级。
 */
export const PREFIX_RULES = [
  { label: "招投标", test: /招标|投标|招投标|招采|标书|评标/ },
  { label: "政务公文", test: /公文|政务|党政|机关办文|党务|办文|内部沟通文书/ },
  { label: "建筑施工", test: /建筑|土木|施工|造价|监理|BIM|结构工程师/ },
  { label: "跨境电商", test: /亚马逊|Amazon|跨境电商|FBA|ASIN|ACOS|ABA|1688|独立站|Shopify|Listing|铺货|选品专家/i },
  { label: "付费广告", test: /腾讯广告|巨量|广告投放|PPC|SEM|付费社交|金手指|投放专家|投放端/ },
  { label: "短视频运营", test: /短视频|直播|抖音|快手|视频号|小红书|漫剧|Flova|口播|视频生成|视频复刻|KOC/ },
  { label: "财务税务", test: /税务|报税|增值税|应付|应收|总账|出纳|财税|财务顾问|破产/ },
  { label: "人力资源", test: /招聘|薪酬|绩效|HR|人事|劳务|培训|OKR|Moka|求职|Offer/ },
  { label: "法务合规", test: /法务|诉讼|仲裁|律师|合同|知识产权|专利|合规专家|法律文件|法学|IRAC|伦理法规/ },
  { label: "供应链", test: /供应链|库存|仓储|物流|采购|供应商|BCP|业务连续性/ },
  { label: "客户成功", test: /客户成功|外联|客服|售后|商机|获客|客户支持|客户360|ICP|CRM|L2C|销售数据/ },
  { label: "汽车出行", test: /汽车|整车|车联网|懂车帝/ },
  { label: "半导体", test: /芯片|半导体|晶圆|算子/ },
  { label: "能源双碳", test: /能源|电力|光伏|双碳|储能|电网/ },
  { label: "餐饮文旅", test: /餐饮|酒店|文旅|导游|门店/ },
  { label: "医疗健康", test: /医疗|临床|药政|护理|医院|患者|PERMA|幸福促进/ },
  { label: "教育培训", test: /教育|校园|教研|亲子|督导|CBT|个案|教案|分层教学|课题|KET|课件|教学动画|备考/ },
  { label: "质量管理", test: /质量|CAPA|8D|质检|持续改进/ },
  { label: "产品运营", test: /产品经理|产品顾问|增长|GEO|品牌感知|品牌/ },
  { label: "销售增长", test: /销售|爆品|选品|带货|转化|管道/ },
  { label: "内容创作", test: /内容|文案|PPT|PDF|动画|LinkedIn|Reddit|社区|创作|导演/ },
  { label: "心理咨询", test: /心理|咨询师|沟通陪练|幸福/ },
  { label: "求职发展", test: /求职|面试|职业|陪跑/ },
  { label: "办公效率", test: /PDF|PPT|办公|文档处理|身份图谱/ },
  { label: "数据分析", test: /数据|分析师|图谱|监控/ },
  { label: "品牌营销", test: /营销|ASO|应用商店|商业化|变现|GEO内容/ },
  { label: "国际商务", test: /沙特|新加坡|南非|巴西|海外|跨境法律|国际/ },
  { label: "软件研发", test: /工程师|开发|代码|前端|后端|考古学家|HTML|Remotion/ },
  { label: "运营", test: /运营专家|运营专员|运营/ },
];

/** catalogL3 / catalogL5 / roleAxis → 前缀 */
export const CATALOG_PREFIX = [
  { test: /招投标|招标/, label: "招投标" },
  { test: /法务|知产|知识产权|合规/, label: "法务合规" },
  { test: /财务|税务|金融/, label: "财务税务" },
  { test: /人力|招聘|HR/, label: "人力资源" },
  { test: /教育|教研|培训/, label: "教育培训" },
  { test: /医疗|健康|心理/, label: "医疗健康" },
  { test: /营销|市场|广告|投放/, label: "品牌营销" },
  { test: /销售|商务|获客/, label: "销售增长" },
  { test: /供应链|物流|采购/, label: "供应链" },
  { test: /运营|客服/, label: "运营" },
  { test: /研发|技术|工程/, label: "软件研发" },
  { test: /设计|创意|内容/, label: "内容创作" },
  { test: /战略|咨询/, label: "咨询" },
  { test: /政务|公文|行政/, label: "政务公文" },
  { test: /跨境|外贸|电商/, label: "跨境电商" },
];

export function splitDisplayNameZh(nameZh) {
  const n = String(nameZh || "").trim();
  const i = n.indexOf(NAMEZH_SEP);
  if (i < 0) return { prefix: "", title: n };
  return {
    prefix: n.slice(0, i).trim(),
    title: n.slice(i + NAMEZH_SEP.length).trim(),
  };
}

/**
 * @param {{ nameZh?: string, meta?: Record<string, string>, body?: string }} role
 * @returns {string|null}
 */
export function inferBusinessPrefix(role) {
  const meta = role.meta || {};
  const nameZh = String(role.nameZh || meta.nameZh || "").trim();
  const { title } = splitDisplayNameZh(nameZh);
  const catalogBlob = [
    nameZh,
    title,
    meta.industryTags,
    meta.tags,
    meta.description,
    meta.catalogL3,
    meta.catalogL4,
    meta.catalogL5,
    meta.roleAxis,
    meta.roleTitle,
    meta.positionZh,
  ]
    .filter(Boolean)
    .join("\n");

  for (const rule of PREFIX_RULES) {
    if (rule.test.test(catalogBlob)) return rule.label;
  }

  for (const rule of CATALOG_PREFIX) {
    if (rule.test.test(catalogBlob)) return rule.label;
  }

  // 正文头 600 字仅跑前 8 条强行业规则
  const body = String(role.body || "").slice(0, 600);
  if (body) {
    for (const rule of PREFIX_RULES.slice(0, 8)) {
      if (rule.test.test(body)) return rule.label;
    }
  }

  return null;
}

/**
 * 弱前缀岗位：推断业务前缀；仍无则「综合业务」（消灭裸「专项」展示）
 */
export function resolveDisplayPrefix(role, divisionFallback) {
  const nameZh = String(role.nameZh || "").trim();
  const { prefix } = splitDisplayNameZh(nameZh);
  if (prefix && !WEAK_PREFIXES.has(prefix)) return prefix;

  const business = inferBusinessPrefix(role);
  if (business) return business;

  if (divisionFallback && divisionFallback !== "专项") return divisionFallback;
  return "综合业务";
}

export function buildNameZhWithPrefix(prefix, titleOrNameZh) {
  const { title } = splitDisplayNameZh(titleOrNameZh);
  const t = (title || String(titleOrNameZh || "").trim()).replace(
    /^(专项|支持|通用|专业)\s*·\s*/,
    "",
  );
  return `${prefix}${NAMEZH_SEP}${t}`;
}
