---
name: 文案交付
description: >
  公众号/飞书公告/产品更新/外联草稿等中文成稿。先读项目风格记忆，再选模板填空；
  禁止空口长文无落盘；对外发送永远须老板确认（L4），禁止挂机个人微信/千牛自动发信。
id: copywriting-delivery
version: 1.1.0
---

# 文案交付 Skill

> 成稿落在项目文件夹；发送是另一回事。先读风格，再套模板，最后请老板确认再发。

## 何时使用

- 写公众号、飞书/企微公告、产品更新说明、销售外联、短新闻稿、活动预告
- 用户说「写一篇文案」「改一改话术」「按模板出稿」「记住文案风格」

## 开工顺序

0. **读风格**：`read_file` `.xu/copy-style.md`（气质 / 禁用词 / 称呼 / CTA）。用户说「记住文案风格：…」→ `write_file` 更新该文件（可同时建议 `/记住`）
1. **体裁**：只选一类（见 `templates/copy/`）
2. **读模板**：`read_file` 对应 `templates/copy/*.md`
3. **填变量**：替换 `{{占位符}}`，并按风格文件改语气；未知处先提问或写「待老板确认」
4. **落盘**：`write_file` 到 `deliverables/copy/`（或用户指定路径）；需要 Word 时再 `office_write_docx` / `office_apply_template`
5. **发送**：仅起草；飞书/企微等须用户确认后再发（**L4**）

## 硬禁令

- 禁止假装已发到公众号 / 个人微信 / 千牛 / 未授权渠道
- 禁止整篇英文交差（用户明确要求除外）；专有名词可中英并用
- 禁止空洞套话堆砌（赋能、闭环、抓手、打造一站式…）无具体事实
- 禁止编造数据、客户名、发布时间、下载量
- 成稿不得违反 `.xu/copy-style.md` 中的禁用词与气质
- 广告法敏感：极限词、医疗功效、稳赚承诺——标红或改写并提示老板

## 语气

默认按下表；**若风格文件有更具体说明，以风格文件为准**。

| 场景 | 默认语气 |
|------|----------|
| 飞书/企微对内 | 结论先行；短句；待办可勾选 |
| 公众号/内容 | 开头 3 行抓人；小标题；结尾 CTA 一个 |
| 产品更新 | 用户收益优先，少技术黑话 |
| 外联 | 礼貌、短、可回复；勿群发腔 |

## 模板目录

项目确认需求后会写入：

- `.xu/copy-style.md` — **项目文案风格记忆**
- `templates/copy/wechat-official.md` — 公众号图文
- `templates/copy/feishu-announcement.md` — 飞书/企微公告
- `templates/copy/product-update.md` — 产品更新说明
- `templates/copy/sales-outreach.md` — 销售外联短信
- `templates/copy/press-release-short.md` — 短新闻稿

必读：`.xu/skills/copywriting-delivery/SKILL.md`、`.xu/copy-style.md`

## 交活自检

- [ ] 已对照 `.xu/copy-style.md`
- [ ] 已落盘，路径可点开
- [ ] 占位符无残留 `{{…}}`（待确认项已标明）
- [ ] 未声称已对外发送
- [ ] 事实可核对或已标注假设
