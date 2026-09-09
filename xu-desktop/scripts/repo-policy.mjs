/**
 * Repo data policy — public-oss (demo only) vs private-full (team private remote).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const POLICY_FILE = path.join(ROOT, "xu.repo-policy.json");

/** @typedef {'public-oss' | 'private-full'} DataPolicy */

/**
 * @returns {{ dataPolicy: DataPolicy, primaryRemote?: string, description?: string }}
 */
export function loadRepoPolicy() {
  try {
    const raw = fs.readFileSync(POLICY_FILE, "utf8");
    const j = JSON.parse(raw);
    const mode = j.dataPolicy === "private-full" ? "private-full" : "public-oss";
    return {
      dataPolicy: mode,
      primaryRemote: typeof j.primaryRemote === "string" ? j.primaryRemote : undefined,
      description: typeof j.description === "string" ? j.description : undefined,
    };
  } catch {
    return { dataPolicy: "public-oss" };
  }
}

export function isPrivateFullRepo() {
  return loadRepoPolicy().dataPolicy === "private-full";
}
