# 缶萃许可证服务（私有部署）

**勿将 `data/licenses.json` 与生产密钥提交公开仓库。**

## 启动

```bash
cp .env.example .env
pnpm install   # 无依赖，仅 package.json
pnpm start
```

默认 `http://127.0.0.1:8787`

客户端：

```powershell
$env:XU_LICENSE_URL="http://127.0.0.1:8787/v1/activate"
```

## API

### POST /v1/activate

```json
{
  "license": "FOU-DEV-FULL-2026",
  "product": "hermes-role-pack",
  "machine_id": "device-uuid"
}
```

响应：

```json
{
  "pack_key_hex": "...",
  "pack_id": "hermes-roles-zh-CN",
  "expires_at": "2027-12-31T23:59:59.000Z",
  "seats": 2,
  "content_version": "2026.08.1",
  "download_url": "https://...",
  "message": "激活成功"
}
```

### GET /v1/catalog

返回可售包列表与最新 `contentVersion`、`downloadUrl`。

### POST /v1/check-updates

```json
{
  "installed": [{ "packId": "hermes-roles-zh-CN", "contentVersion": "2026.08.0" }]
}
```

### POST /v1/webhooks/payment

支付平台回调（需 `X-Fou-Signature` HMAC）：

```json
{
  "email": "buyer@example.com",
  "sku": "full-zh-CN",
  "seats": 1
}
```

自动生成 `FOU-XXXXXXXX` 许可证并写入 `data/licenses.json`。  
对接爱发电/Stripe 时，在支付成功 webhook 中 POST 到此端点，再用邮件服务把 `license` + `downloadUrl` 发给用户。

## 开发许可证

首次启动会创建 `FOU-DEV-FULL-2026`（2 席，2027 年底过期），仅用于本地联调。

## 数据文件

| 文件 | 说明 |
|------|------|
| `data/licenses.json` | 已发售许可证 |
| `data/catalog.json` | SKU 与下载地址、contentVersion |
| `data/activations.json` | 席位绑定记录 |
