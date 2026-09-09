/**
 * Lightweight Snowflake ID generator for desktop (single-process).
 * Epoch: 2024-01-01 UTC. workerId=1, datacenterId=1.
 */

const EPOCH = 1_704_067_200_000; // 2024-01-01T00:00:00.000Z
const WORKER_ID = 1n;
const DATACENTER_ID = 1n;
const SEQUENCE_BITS = 12n;
const WORKER_BITS = 5n;
const DATACENTER_BITS = 5n;

const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n;

let lastTs = -1n;
let sequence = 0n;

function nowMs(): bigint {
  return BigInt(Date.now());
}

function composeId(ts: bigint, seq: bigint): string {
  const id =
    ((ts - BigInt(EPOCH)) << (DATACENTER_BITS + WORKER_BITS + SEQUENCE_BITS)) |
    (DATACENTER_ID << (WORKER_BITS + SEQUENCE_BITS)) |
    (WORKER_ID << SEQUENCE_BITS) |
    seq;
  return id.toString();
}

/** Generate next monotonic Snowflake ID (string). */
export function nextSnowflakeId(): string {
  let ts = nowMs();
  if (ts < lastTs) {
    ts = lastTs;
  }
  if (ts === lastTs) {
    sequence = (sequence + 1n) & MAX_SEQUENCE;
    if (sequence === 0n) {
      while (ts <= lastTs) ts = nowMs();
    }
  } else {
    sequence = 0n;
  }
  lastTs = ts;
  return composeId(ts, sequence);
}

/** FNV-1a 64-bit hash for stable keys. */
function fnv1a64(input: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}

/**
 * Deterministic Snowflake-like ID from a stable key (catalog slug / source path).
 * Same key always yields the same id — safe for catalog rebuilds.
 */
export function stableSnowflakeFromKey(key: string): string {
  const h = fnv1a64(key.trim());
  const ts = BigInt(EPOCH) + (h % 8_640_000_000_000n); // spread within ~100 days window
  const seq = h & MAX_SEQUENCE;
  return composeId(ts, seq);
}

/** True if string looks like a numeric Snowflake id (not legacy slug). */
export function isSnowflakeId(id: string | null | undefined): boolean {
  if (!id) return false;
  if (/^[a-z][a-z0-9_-]*$/i.test(id) && !/^\d+$/.test(id)) return false;
  return /^\d{15,20}$/.test(id);
}
