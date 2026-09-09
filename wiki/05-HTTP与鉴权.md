# 05 · HTTP 与鉴权

QQ 群：`1102740387`

## 1. 客户端

文件：`xu-desktop/src/utils/request.ts`

- 基于 **fetch**（非 axios），对照官网拦截器语义。  
- 自动带 Bearer（`readCloudAccessToken`）。  
- 401/过期：排队刷新（`cloudRefresh`），失败则登出。  
- 业务码成功：`code === 0`。  
- 错误：默认 `fouAlert`（可用 `silent` 抑制）。  
- `noAuth`：跳过 Authorization（公开接口）。  

账号 / 登出 / Token 读写：`utils/auth.ts`。

## 2. 端点来源

`utils/appEnv.ts`：

- `VITE_XU_ACCOUNT_URL` / `VITE_XU_LICENSE_URL` → 账号与许可证 API（`…/api/v1`）  
- `VITE_XU_SHOWCASE_URL` → 官网展示站（注册）  
- `VITE_XU_STORE_URL` / `VITE_XU_DOWNLOAD_PAGE_URL` → 商店与下载引导  
- 语音包 catalog 等其它 `VITE_XU_*`  

开发时复制 `.env.example` → `.env.development`，把占位 `xxx.com` 改成你的服务。

## 3. 登录契约（摘要）

登录成功 JSON 应同时包含：

- `access_token`  
- `refresh_token`  

（字段名为下划线。）

## 4. 新增 API 调用模板

```ts
import { request } from "../utils/request"; // 以实际导出名为准

export async function fetchSomething(id: string) {
  return request<YourType>({
    url: `/your/path/${id}`,
    method: "GET",
  });
}
```

禁止在 `.vue` 里直接拼账号服 URL + 裸 fetch。
