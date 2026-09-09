/**
 * .xupack binary format (AES-256-GCM).
 *
 * Layout:
 *   magic     8  "XUPACK\x01\x00"
 *   version   1  u8 = 1
 *   flags     1  u8 (bit0 = demo)
 *   sha256   32  plaintext payload hash
 *   nonce    12
 *   ciphertext+tag  (GCM)
 */
import crypto from "node:crypto";

export const XUPACK_MAGIC = Buffer.from("XUPACK\x01\x00", "binary");
export const XUPACK_VERSION = 1;
export const XUPACK_FLAG_DEMO = 1;

/** Demo key — matches Rust DEMO_PACK_KEY (OSS only unlocks demo packs). */
export const DEMO_PACK_KEY = crypto
  .createHash("sha256")
  .update("xu-virmoor-demo-role-pack-v1")
  .digest();

/**
 * @param {string} packId
 * @param {string} [licenseId]
 */
export function deriveCommercialKey(packId, licenseId = "") {
  return crypto.hkdfSync("sha256", DEMO_PACK_KEY, Buffer.alloc(0), `${packId}:${licenseId}`, 32);
}

/**
 * @param {object} payload
 * @param {{ key: Buffer; demo?: boolean }} opts
 */
export function encodeXupack(payload, opts) {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const sha256 = crypto.createHash("sha256").update(plaintext).digest();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", opts.key, nonce);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const flags = opts.demo ? XUPACK_FLAG_DEMO : 0;
  return Buffer.concat([XUPACK_MAGIC, Buffer.from([XUPACK_VERSION, flags]), sha256, nonce, enc, tag]);
}

/**
 * @param {Buffer} buf
 * @param {Buffer} key
 */
export function decodeXupack(buf, key) {
  if (buf.length < 8 + 1 + 1 + 32 + 12 + 16) throw new Error("xupack too small");
  const magic = buf.subarray(0, 8);
  if (!magic.equals(XUPACK_MAGIC)) throw new Error("invalid xupack magic");
  const version = buf.readUInt8(8);
  if (version !== XUPACK_VERSION) throw new Error(`unsupported xupack version ${version}`);
  const flags = buf.readUInt8(9);
  const expectedSha = buf.subarray(10, 42);
  const nonce = buf.subarray(42, 54);
  const tag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(54, buf.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const sha256 = crypto.createHash("sha256").update(plaintext).digest();
  if (!sha256.equals(expectedSha)) throw new Error("xupack sha256 mismatch");
  const payload = JSON.parse(plaintext.toString("utf8"));
  return { payload, flags };
}
