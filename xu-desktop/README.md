# 虚募阁（Virmoor）

面向普通用户的 AI 公司桌面客户端：零配置安装、办公室沉浸、岗位化派活。

- **代码许可**：[Apache License 2.0](LICENSE)
- **岗位数据**：**不开源** — 见 [DATA_LICENSE.md](DATA_LICENSE.md)（若仓库中提供）

## 重要说明：开源的是软件，不是岗位库

| 包含在本仓库 | 不包含（需单独购买） |
|--------------|----------------------|
| 客户端全部源码 | 全量中文人设数据 |
| 演示岗位包（约 5 岗） | 行业加速包 / 全量 `.xupack` |
| 数据包加载与激活逻辑 | `role-packs-src/` 商业源文件 |

完整岗位数据包为加密 **`.xupack`**，通过 [设置 → 岗位数据包](docs/help/settings/role-packs.md) 导入或联网激活。  
**本仓库 intentionally 不包含商业数据**，fork 代码无法获得完整岗位库。

## 快速开始

```bash
pnpm install
pnpm tauri:dev
# 或：pnpm tauri dev --features native-tts,devtools
```

正式包（无 DevTools）：

```bash
pnpm build:release
```

## 岗位数据包（开发者）

```bash
# 从本地源构建（role-packs-src/ 在 .gitignore，需自行准备）
pnpm export:role-md          # 一次性从旧 catalog 导出
pnpm build:role-pack:demo      # 重建演示包
node scripts/build-role-pack-skus.mjs   # 按 SKU 清单构建行业包/全量包
```

格式与构建说明：[docs/commerce/role-packs.md](docs/commerce/role-packs.md)

## 许可证 / 账号服

桌面云账号与下载走 `VITE_XU_ACCOUNT_URL`（默认生产 `https://xumuge.com/api/v1`）。自托管见仓根 `server/` 与 `docs/25-宝塔部署-OpenCloudOS.md`。

## 商业授权

- 个人/团队订阅：全量岗包 + 季度更新
- 企业：席位、离线密钥、定制岗位包

详见帮助文档 **设置 → 岗位数据包**。

## 仓库结构

```
src/                 Vue 前端（UI：npm foucui）
src-tauri/           Tauri / Rust（含 role_pack 解密）
resources/role-packs/  仅 demo.zh-CN.xupack
scripts/             构建与导出脚本
docs/help/           应用内帮助正文
```

品牌中文真源：**虚募阁**；英文：**Virmoor**。UI 组件库包名仍为 `foucui`（与产品名无关）。
