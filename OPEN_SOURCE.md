# Open Source Model · 开源模式

Virmoor / 虚募阁 · bilingual · 中英对照  
**License: AGPL-3.0** · QQ: **1102740387**

---

## 中文

### 1. 双轨

| 轨道 | 开放程度 | 内容 |
|------|----------|------|
| **软件 / Runtime** | AGPL-3.0 | 桌面壳、Native Agent 脚手架、示例配置（白名单导出） |
| **演示岗位** | AGPL-3.0 | `role-packs-src/zh-virmoon` **约 461** 岗（`originSource !== market`） |
| **商业岗位与发证** | **闭源** | `zh-CN-virmoor`、market 岗、商业 `.xupack`、许可证库、生产密钥 |
| **官网与后端** | **不开源** | `xu-web-front`、`xu-web-server`、`server/` |

一句话：**开源的是「能跑起来的软件 + 约 461 演示岗位」；不卖、不公开的是「商业正式岗包与生产钥匙」。**

### 2. 为什么是 461 而不是全量

- 私有源 `zh-kimi` 磁盘上约 1222（开源目录名为 `zh-virmoon`） 岗（含 market ≈761）。  
- 公开仓 **只收录非 market 子集（kept=461）**。  
- 不收录 `zh-CN` / `zh-CN-virmoor` 全量商业树。

### 3. 社区

- QQ 群：**1102740387**  
- 开发说明：[DEVELOPING.md](./DEVELOPING.md)  
- 使用 / 打包：[USAGE.md](./USAGE.md)

### 4. AGPL-3.0

对本树已公开文件的修改与再分发须遵守 AGPL-3.0。若以网络服务形式提供修改后的程序，须向远程用户提供对应源码（见 [NOTICE](./NOTICE)）。

商标「虚募阁 / Virmoor」见 NOTICE；许可证不授予商标权。

### 5. 与私有主仓

| 主仓（私有） | 本 `opensource/` 树 |
|--------------|---------------------|
| 完整产品与运维 | 剥离桌面源码 + 461 demo 岗 |
| 未授权不得 push 陌生公开远程 | 本树可先在主仓提交，公开远程另授权 |

---

## English

### Dual track

Software + ~461 non-market `zh-virmoon` demo roles: **AGPL-3.0**. Commercial `zh-CN-virmoor`, market roles, secrets, website/backends: **closed**.

QQ group: **1102740387**. See DEVELOPING.md / USAGE.md.
