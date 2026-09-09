/**
 * Issue a license into data/licenses.json (private ops)
 * node scripts/issue-license.mjs --sku full-zh-CN --email user@example.com --seats 1
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");
const LICENSES = path.join(DATA, "licenses.json");
const CATALOG = path.join(DATA, "catalog.json");

function arg(name, def = "") {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function derivePackKeyHex(packId, code) {
  const master = process.env.XU_PACK_MASTER_KEY_HEX;
  if (master) {
    return crypto.hkdfSync("sha256", Buffer.from(master.replace(/^0x/, ""), "hex"), Buffer.alloc(0), `${packId}:${code}`, 32).toString("hex");
  }
  return crypto.createHash("sha256").update(`xu-pack:${packId}:${code}`).digest("hex");
}

const sku = arg("--sku", "full-zh-CN");
const email = arg("--email", "");
const seats = Number(arg("--seats", "1")) || 1;
const years = Number(arg("--years", "1")) || 1;

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const pack = catalog.packs.find((p) => p.sku === sku);
if (!pack) {
  console.error("Unknown sku:", sku);
  process.exit(1);
}

const code = `XU-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
const expires = new Date();
expires.setFullYear(expires.getFullYear() + years);

const db = JSON.parse(fs.readFileSync(LICENSES, "utf8"));
db.licenses.push({
  code,
  packId: pack.packId,
  packKeyHex: derivePackKeyHex(pack.packId, code),
  seats,
  expiresAt: expires.toISOString(),
  sku,
  email: email || null,
  createdAt: new Date().toISOString(),
});
fs.writeFileSync(LICENSES, JSON.stringify(db, null, 2));

console.log("License:", code);
console.log("Pack:", pack.packId);
console.log("Expires:", expires.toISOString());
if (email) console.log("Email:", email);
