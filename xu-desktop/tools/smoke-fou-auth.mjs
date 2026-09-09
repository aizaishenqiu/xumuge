/**
 * Fou Auth/session smoke: login → session (A) → session (B, solo kicks A) → renew.
 * Usage: node tools/smoke-fou-auth.mjs [baseUrl]
 * Default base: http://127.0.0.1:8080/api/v1
 */
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const base = (process.argv[2] || "http://127.0.0.1:8080/api/v1").replace(/\/$/, "");

function post(path, body, headers = {}) {
  const f = join(tmpdir(), `xu-smoke-${Date.now()}.json`);
  writeFileSync(f, JSON.stringify(body), "utf8");
  const args = ["-s", "-X", "POST", `${base}${path}`, "-H", "Content-Type: application/json"];
  for (const [k, v] of Object.entries(headers)) {
    args.push("-H", `${k}: ${v}`);
  }
  args.push("--data-binary", `@${f}`);
  const r = spawnSync("curl.exe", args, { encoding: "utf8" });
  try {
    unlinkSync(f);
  } catch {
    /* ignore */
  }
  if (r.status !== 0) throw new Error(`curl failed: ${r.stderr || r.error}`);
  return JSON.parse(r.stdout || "{}");
}

const login = post("/auth/login", {
  email: "admin@fou.local",
  password: "admin123",
});
if (login.code !== 0 || !login.data?.access_token) {
  console.error("LOGIN FAIL", login);
  process.exit(1);
}
const token = login.data.access_token;
console.log("login ok", login.data.user?.email);

const s1 = post(
  "/session/login",
  { machine_id: "smoke-machine-a", edition: "solo" },
  { Authorization: `Bearer ${token}` },
);
if (!s1.session_id) {
  console.error("SESSION A FAIL", s1);
  process.exit(1);
}
console.log("session A", s1.session_id, s1.message);

const s2 = post(
  "/session/login",
  { machine_id: "smoke-machine-b", edition: "solo" },
  { Authorization: `Bearer ${token}` },
);
if (!s2.session_id) {
  console.error("SESSION B FAIL", s2);
  process.exit(1);
}
if (!s2.revoked_other && s2.message !== "revoked_other") {
  console.error("EXPECTED kick-offline (revoked_other)", s2);
  process.exit(1);
}
console.log("session B kicked A", s2.session_id, s2.message);

const renewed = post("/session/renew", {
  session_id: s2.session_id,
  refresh_token: s2.refresh_token,
});
if (!renewed.session_id || renewed.message !== "renewed") {
  console.error("RENEW FAIL", renewed);
  process.exit(1);
}
console.log("renew ok", renewed.expires_at);
console.log("SMOKE PASS");
