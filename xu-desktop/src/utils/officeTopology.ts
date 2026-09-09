/**
 * @file 办公室协作拓扑：hierarchical（默认）/ mesh
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @version 1.0.0
 * @category Schedule
 * @algo office-topology-mode
 */
import { readLs, writeLs } from "./xuStorage";

export const OFFICE_TOPOLOGY_KEY = "xu.office.topology";

export type OfficeTopology = "hierarchical" | "mesh";

export function normalizeOfficeTopology(raw: unknown): OfficeTopology {
  return raw === "mesh" ? "mesh" : "hierarchical";
}

export function readOfficeTopology(): OfficeTopology {
  return normalizeOfficeTopology(readLs(OFFICE_TOPOLOGY_KEY, "hierarchical"));
}

export function writeOfficeTopology(next: OfficeTopology): OfficeTopology {
  const v = normalizeOfficeTopology(next);
  writeLs(OFFICE_TOPOLOGY_KEY, v);
  return v;
}
