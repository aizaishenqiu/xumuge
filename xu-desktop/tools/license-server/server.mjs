/**
 * 缶萃岗位包许可证服务（参考实现，部署在私有环境）
 *
 *   cp .env.example .env
 *   pnpm install && pnpm start
 *
 * POST /v1/activate       — 客户端激活
 * GET  /v1/catalog        — 可售包与最新 contentVersion
 * POST /v1/check-updates  — 客户端检查更新
 * POST /v1/webhooks/payment — 支付回调（发码）
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const LICENSES_PATH = path.join(DATA_DIR, "licenses.json");
const CATALOG_PATH = path.join(DATA_DIR, "catalog.json");
const ACTIVATIONS_PATH = path.join(DATA_DIR, "activations.json");

const PORT = Number(process.env.PORT || 8787);
const WEBHOOK_SECRET = process.env.XU_WEBHOOK_SECRET || "dev-webhook-secret";
const MASTER_KEY_HEX = process.env.XU_PACK_MASTER_KEY_HEX || "";

function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LICENSES_PATH)) {
    fs.writeFileSync(
      LICENSES_PATH,
      JSON.stringify(
        {
          licenses: [
            {
              code: "FOU-DEV-FULL-2026",
              packId: "hermes-roles-zh-CN",
              packKeyHex: derivePackKeyHex("hermes-roles-zh-CN", "FOU-DEV-FULL-2026"),
              seats: 2,
              expiresAt: "2027-12-31T23:59:59.000Z",
              sku: "full-zh-CN",
            },
          ],
        },
        null,
        2,
      ),
    );
  }
  if (!fs.existsSync(CATALOG_PATH)) {
    fs.writeFileSync(
      CATALOG_PATH,
      JSON.stringify(
        {
          packs: [
            {
              packId: "hermes-roles-zh-CN",
              locale: "zh-CN",
              contentVersion: "2026.08.1",
              downloadUrl: "https://example.com/dist/hermes-roles-zh-CN.xupack",
              sku: "full-zh-CN",
            },
            {
              packId: "hermes-roles-industry-software-zh-CN",
              locale: "zh-CN",
              contentVersion: "2026.08.1",
              downloadUrl: "https://example.com/dist/hermes-roles-industry-software-zh-CN.xupack",
              sku: "industry-software-zh-CN",
            },
          ],
        },
        null,
        2,
      ),
    );
  }
  if (!fs.existsSync(ACTIVATIONS_PATH)) {
    fs.writeFileSync(ACTIVATIONS_PATH, JSON.stringify({ activations: [] }, null, 2));
  }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function derivePackKeyHex(packId, licenseCode) {
  if (MASTER_KEY_HEX) {
    return crypto.hkdfSync("sha256", Buffer.from(MASTER_KEY_HEX.replace(/^0x/, ""), "hex"), Buffer.alloc(0), `${packId}:${licenseCode}`, 32).toString("hex");
  }
  return crypto.createHash("sha256").update(`xu-pack:${packId}:${licenseCode}`).digest("hex");
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function findLicense(code) {
  const db = readJson(LICENSES_PATH);
  return db.licenses.find((l) => l.code === code);
}

function countActivations(licenseCode) {
  const db = readJson(ACTIVATIONS_PATH);
  return db.activations.filter((a) => a.license === licenseCode).length;
}

function recordActivation(license, machineId) {
  const db = readJson(ACTIVATIONS_PATH);
  const existing = db.activations.find((a) => a.license === license && a.machineId === machineId);
  if (!existing) {
    db.activations.push({ license, machineId, at: new Date().toISOString() });
    writeJson(ACTIVATIONS_PATH, db);
  }
}

const SESSIONS_PATH = path.join(DATA_DIR, "sessions.json");
const USERS_PATH = path.join(DATA_DIR, "users.json");

function ensureSessions() {
  if (!fs.existsSync(SESSIONS_PATH)) {
    writeJson(SESSIONS_PATH, { sessions: [] });
  }
}

function ensureUsers() {
  if (!fs.existsSync(USERS_PATH)) {
    writeJson(USERS_PATH, {
      users: [
        {
          id: "u-admin",
          email: "admin@fou.local",
          // password: admin123 — sha256 for stub (not production bcrypt)
          passwordSha256: crypto.createHash("sha256").update("admin123").digest("hex"),
          role: "admin",
          createdAt: new Date().toISOString(),
        },
      ],
    });
  }
}

function envelope(code, msg, data) {
  return { code, msg, data: data ?? null };
}

function handleAuthRegister(body) {
  ensureUsers();
  const email = String(body.email || body.username || "")
    .trim()
    .toLowerCase();
  const password = String(body.password || "");
  if (!email || !email.includes("@")) {
    return { status: 400, body: envelope(40001, "email 无效", null) };
  }
  if (password.length < 6) {
    return { status: 400, body: envelope(40001, "密码至少 6 位", null) };
  }
  const db = readJson(USERS_PATH);
  if (db.users.some((u) => u.email === email)) {
    return { status: 400, body: envelope(40001, "邮箱已注册", null) };
  }
  const user = {
    id: `u-${crypto.randomBytes(6).toString("hex")}`,
    email,
    passwordSha256: crypto.createHash("sha256").update(password).digest("hex"),
    role: "user",
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  writeJson(USERS_PATH, db);
  const tokens = issueTokens(user);
  return {
    status: 200,
    body: envelope(0, "success", {
      ...tokens,
      user: { id: user.id, email: user.email, role: user.role },
    }),
  };
}

function issueTokens(user) {
  const access_token = `atk-${crypto.randomBytes(24).toString("hex")}`;
  const refresh_token = `rtk-${crypto.randomBytes(24).toString("hex")}`;
  const expires_in = 900;
  ensureSessions();
  const sessions = readJson(SESSIONS_PATH);
  sessions.authTokens = sessions.authTokens || [];
  sessions.authTokens.push({
    access_token,
    refresh_token,
    userId: user.id,
    email: user.email,
    role: user.role,
    expiresAt: new Date(Date.now() + expires_in * 1000).toISOString(),
  });
  writeJson(SESSIONS_PATH, sessions);
  return { access_token, refresh_token, expires_in };
}

function handleAuthLogin(body) {
  ensureUsers();
  const email = String(body.email || body.username || "")
    .trim()
    .toLowerCase();
  const password = String(body.password || "");
  const db = readJson(USERS_PATH);
  const user = db.users.find((u) => u.email === email);
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  if (!user || user.passwordSha256 !== hash) {
    return { status: 401, body: envelope(40101, "邮箱或密码错误", null) };
  }
  const tokens = issueTokens(user);
  return {
    status: 200,
    body: envelope(0, "success", {
      ...tokens,
      user: { id: user.id, email: user.email, role: user.role },
    }),
  };
}

function handleAuthRefresh(body) {
  ensureSessions();
  const refresh = String(body.refresh_token || body.refreshToken || "").trim();
  const sessions = readJson(SESSIONS_PATH);
  sessions.authTokens = sessions.authTokens || [];
  const row = sessions.authTokens.find((t) => t.refresh_token === refresh);
  if (!row) {
    return { status: 401, body: envelope(40101, "refresh 无效", null) };
  }
  ensureUsers();
  const user = readJson(USERS_PATH).users.find((u) => u.id === row.userId);
  if (!user) {
    return { status: 401, body: envelope(40101, "用户不存在", null) };
  }
  sessions.authTokens = sessions.authTokens.filter((t) => t.refresh_token !== refresh);
  writeJson(SESSIONS_PATH, sessions);
  const tokens = issueTokens(user);
  return { status: 200, body: envelope(0, "success", tokens) };
}

function findAuthUserByBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  ensureSessions();
  const sessions = readJson(SESSIONS_PATH);
  const row = (sessions.authTokens || []).find((t) => t.access_token === m[1]);
  if (!row) return null;
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) return null;
  return row;
}

function handleSessionLogin(body, req) {
  const license = String(body.license || "").trim();
  const account = String(body.account || body.email || "").trim();
  const machineId = String(body.machine_id || body.machineId || "").trim();
  const edition = String(body.edition || "solo").toLowerCase();
  const bearer = req ? findAuthUserByBearer(req) : null;

  if (!license && !account && !bearer) {
    return { status: 400, body: { error: "missing license, account, or Bearer" } };
  }
  if (!machineId) return { status: 400, body: { error: "missing machine_id" } };

  const code = license || (bearer ? `ACC-${bearer.email}` : `ACC-${account}`);
  let rec = license ? findLicense(license) : null;
  if (!rec && (account || bearer)) {
    const db = readJson(LICENSES_PATH);
    rec = db.licenses[0] || {
      code,
      packId: "hermes-roles-zh-CN",
      packKeyHex: derivePackKeyHex("hermes-roles-zh-CN", code),
      seats: edition === "enterprise" ? 10 : 1,
      expiresAt: "2027-12-31T23:59:59.000Z",
      edition,
    };
  }
  if (!rec) return { status: 403, body: { error: "invalid license" } };
  if (rec.expiresAt && new Date(rec.expiresAt) < new Date()) {
    return { status: 403, body: { error: "license expired" } };
  }

  ensureSessions();
  const sessions = readJson(SESSIONS_PATH);
  let revokedOther = false;
  const seats = rec.seats ?? (edition === "enterprise" ? 10 : 1);
  const packId = rec.packId || "hermes-roles-zh-CN";

  if (edition === "solo" || seats <= 1) {
    const others = sessions.sessions.filter(
      (s) => s.license === rec.code && s.machineId !== machineId && !s.revoked,
    );
    for (const s of others) {
      s.revoked = true;
      revokedOther = true;
    }
  } else {
    const active = sessions.sessions.filter((s) => s.license === rec.code && !s.revoked);
    const already = active.find((s) => s.machineId === machineId);
    if (!already && active.length >= seats) {
      return { status: 403, body: { error: "seat limit exceeded" } };
    }
  }

  const sessionId = `sess-${crypto.randomBytes(8).toString("hex")}`;
  const refreshToken = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  sessions.sessions = sessions.sessions.filter(
    (s) => !(s.license === rec.code && s.machineId === machineId),
  );
  sessions.sessions.push({
    sessionId,
    refreshToken,
    license: rec.code,
    machineId,
    packId,
    edition,
    expiresAt,
    revoked: false,
    userId: bearer?.userId || null,
    at: new Date().toISOString(),
  });
  writeJson(SESSIONS_PATH, sessions);
  recordActivation(rec.code, machineId);

  const catalog = readJson(CATALOG_PATH);
  const pack = catalog.packs.find((p) => p.packId === packId);

  return {
    status: 200,
    body: {
      session_id: sessionId,
      refresh_token: refreshToken,
      unwrap_key_hex: rec.packKeyHex || derivePackKeyHex(packId, rec.code),
      pack_key_hex: rec.packKeyHex || derivePackKeyHex(packId, rec.code),
      pack_id: packId,
      expires_at: expiresAt,
      seats,
      edition,
      content_version: pack?.contentVersion || null,
      download_url: pack?.downloadUrl || null,
      revoked_other: revokedOther,
      entitlements: rec.entitlements || [],
      message: revokedOther
        ? "登录成功（已挤下其他设备的单独版会话）"
        : "会话登录成功",
    },
  };
}

function handleSessionRenew(body) {
  ensureSessions();
  const sessionId = String(body.session_id || body.sessionId || "").trim();
  const refresh = String(body.refresh_token || body.refreshToken || "").trim();
  const machineId = String(body.machine_id || body.machineId || "").trim();
  const sessions = readJson(SESSIONS_PATH);
  const sess = sessions.sessions.find(
    (s) => s.sessionId === sessionId && !s.revoked,
  );
  if (!sess) return { status: 401, body: { error: "session revoked or missing" } };
  if (machineId && sess.machineId !== machineId) {
    return { status: 401, body: { error: "machine mismatch" } };
  }
  if (refresh && sess.refreshToken && refresh !== sess.refreshToken) {
    return { status: 401, body: { error: "invalid refresh_token" } };
  }
  if (sess.expiresAt && new Date(sess.expiresAt) < new Date(Date.now() - 24 * 3600 * 1000)) {
    return { status: 401, body: { error: "session too old" } };
  }

  const rec = findLicense(sess.license);
  if (!rec) return { status: 403, body: { error: "license gone" } };

  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  sess.expiresAt = expiresAt;
  sess.refreshToken = crypto.randomBytes(16).toString("hex");
  writeJson(SESSIONS_PATH, sessions);

  return {
    status: 200,
    body: {
      session_id: sess.sessionId,
      refresh_token: sess.refreshToken,
      unwrap_key_hex: rec.packKeyHex || derivePackKeyHex(sess.packId, sess.license),
      pack_key_hex: rec.packKeyHex || derivePackKeyHex(sess.packId, sess.license),
      pack_id: sess.packId,
      expires_at: expiresAt,
      message: "renewed",
    },
  };
}

function handleActivate(body) {
  // Prefer session semantics when edition provided
  if (body.edition) {
    return handleSessionLogin(body);
  }
  const license = String(body.license || "").trim();
  const machineId = String(body.machine_id || body.machineId || "").trim();
  if (!license) return { status: 400, body: { error: "missing license" } };
  if (!machineId) return { status: 400, body: { error: "missing machine_id" } };

  const rec = findLicense(license);
  if (!rec) return { status: 403, body: { error: "invalid license" } };

  if (rec.expiresAt && new Date(rec.expiresAt) < new Date()) {
    return { status: 403, body: { error: "license expired" } };
  }

  const seats = rec.seats ?? 1;
  const used = countActivations(license);
  const db = readJson(ACTIVATIONS_PATH);
  const already = db.activations.some((a) => a.license === license && a.machineId === machineId);
  if (!already && used >= seats) {
    return { status: 403, body: { error: "seat limit exceeded" } };
  }

  recordActivation(license, machineId);
  const catalog = readJson(CATALOG_PATH);
  const pack = catalog.packs.find((p) => p.packId === rec.packId);

  return {
    status: 200,
    body: {
      pack_key_hex: rec.packKeyHex || derivePackKeyHex(rec.packId, license),
      unwrap_key_hex: rec.packKeyHex || derivePackKeyHex(rec.packId, license),
      pack_id: rec.packId,
      session_id: `legacy-${machineId.slice(0, 8)}`,
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      seats,
      content_version: pack?.contentVersion || null,
      download_url: pack?.downloadUrl || null,
      message: "激活成功",
    },
  };
}

function handleCheckUpdates(body) {
  const installed = Array.isArray(body.installed) ? body.installed : [];
  const catalog = readJson(CATALOG_PATH);
  const updates = [];
  for (const item of installed) {
    const pack = catalog.packs.find((p) => p.packId === item.packId);
    if (!pack) continue;
    const cur = item.contentVersion || "";
    if (pack.contentVersion && pack.contentVersion !== cur) {
      updates.push({
        packId: pack.packId,
        locale: pack.locale,
        contentVersion: pack.contentVersion,
        downloadUrl: pack.downloadUrl,
      });
    }
  }
  return { status: 200, body: { updates } };
}

function handlePaymentWebhook(body, headers) {
  const sig = headers["x-fou-signature"] || headers["x-foU-signature"];
  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(JSON.stringify(body)).digest("hex");
  if (sig !== expected) {
    return { status: 401, body: { error: "invalid signature" } };
  }

  const email = body.email || body.buyer_email;
  const sku = body.sku || body.product_sku || "full-zh-CN";
  const catalog = readJson(CATALOG_PATH);
  const pack = catalog.packs.find((p) => p.sku === sku) || catalog.packs[0];
  const code = `XU-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  const db = readJson(LICENSES_PATH);
  const license = {
    code,
    packId: pack.packId,
    packKeyHex: derivePackKeyHex(pack.packId, code),
    seats: body.seats ?? 1,
    expiresAt: expiresAt.toISOString(),
    sku,
    email: email || null,
    createdAt: new Date().toISOString(),
  };
  db.licenses.push(license);
  writeJson(LICENSES_PATH, db);

  return {
    status: 200,
    body: {
      ok: true,
      license: code,
      packId: pack.packId,
      downloadUrl: pack.downloadUrl,
      message: email ? `License ${code} created for ${email}` : `License ${code} created`,
    },
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const body = req.method === "POST" ? await parseBody(req) : {};

    if (req.method === "POST" && (url.pathname === "/v1/auth/register" || url.pathname === "/api/v1/auth/register")) {
      const out = handleAuthRegister(body);
      return json(res, out.status, out.body);
    }

    if (req.method === "POST" && (url.pathname === "/v1/auth/login" || url.pathname === "/api/v1/auth/login")) {
      const out = handleAuthLogin(body);
      return json(res, out.status, out.body);
    }

    if (req.method === "POST" && (url.pathname === "/v1/auth/refresh" || url.pathname === "/api/v1/auth/refresh")) {
      const out = handleAuthRefresh(body);
      return json(res, out.status, out.body);
    }

    if (req.method === "GET" && url.pathname === "/v1/catalog") {
      return json(res, 200, readJson(CATALOG_PATH));
    }

    if (req.method === "POST" && url.pathname === "/v1/session/login") {
      const out = handleSessionLogin(body, req);
      return json(res, out.status, out.body);
    }

    if (req.method === "POST" && url.pathname === "/v1/session/renew") {
      const out = handleSessionRenew(body);
      return json(res, out.status, out.body);
    }

    if (req.method === "POST" && url.pathname === "/v1/activate") {
      const out = handleActivate(body);
      return json(res, out.status, out.body);
    }

    if (req.method === "POST" && url.pathname === "/v1/check-updates") {
      const out = handleCheckUpdates(body);
      return json(res, out.status, out.body);
    }

    if (req.method === "POST" && url.pathname === "/v1/webhooks/payment") {
      const out = handlePaymentWebhook(body, req.headers);
      return json(res, out.status, out.body);
    }

    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health" || url.pathname === "/api/v1/health")) {
      return json(res, 200, { ok: true, service: "xu-license-stub" });
    }

    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: String(e) });
  }
});

ensureData();
ensureSessions();
ensureUsers();
server.listen(PORT, () => {
  console.log(`[fou-license] http://127.0.0.1:${PORT}`);
  console.log(`  POST /v1/auth/login|register|refresh  (AI-server envelope)`);
  console.log(`  POST /v1/session/login|renew`);
  console.log(`  POST /v1/activate`);
  console.log(`  GET  /health`);
  console.log(`  stub user: admin@fou.local / admin123`);
});
