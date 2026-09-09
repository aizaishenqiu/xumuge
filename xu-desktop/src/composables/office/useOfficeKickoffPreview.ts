/**
 * Preview kickoff waves / headcount before Boss confirms 全体开工.
 */
import { computed, ref, type Ref } from "vue";
import type { Employee } from "../../utils/employees";
import type { XuProject } from "../../utils/projects";
import type { RequirementBrief } from "../../intent/briefTypes";
import { resolveLegacyAgencyRoleId } from "../../office/agencyRoleIdMap";
import { ensureEmployeesForRoleIds } from "../../utils/employees";
import { resolveProjectEmployees } from "../../utils/projects";
import { loadEmployees, readEmployees } from "../../utils/employees";
import {
  groupEmployeesByWave,
  kickoffWaveOrder,
  waveLabel,
} from "../../utils/kickoffOrchestrator";
import { readKickoffMaxEmployees, readKickoffParallel } from "../../utils/concurrencySlots";
import type { KickoffWave } from "../../office/industryWorkflows";
import { toUserError } from "../../utils/userFacingError";

export type KickoffWaveRow = {
  wave: KickoffWave;
  label: string;
  count: number;
  names: string;
};

export type KickoffPreview = {
  total: number;
  parallel: number;
  kickoffMax: number;
  matchedOnly: boolean;
  waves: KickoffWaveRow[];
  summaryText: string;
};

export function useOfficeKickoffPreview(opts: {
  employees: Ref<Employee[]>;
  fouProject: Ref<XuProject | null>;
  brief: Ref<RequirementBrief | null>;
}) {
  const loading = ref(false);
  const preview = ref<KickoffPreview | null>(null);
  const error = ref("");

  const rosterTargets = computed(() =>
    opts.employees.value.filter((e) => e.roleKind !== "boss"),
  );

  async function resolveKickoffTargets(forceAll: boolean): Promise<Employee[]> {
    const project = opts.fouProject.value;
    const brief = opts.brief.value;
    if (!project) return rosterTargets.value;

    if (!forceAll && brief?.matchedRoleIds?.length) {
      const matched = await ensureEmployeesForRoleIds(brief.matchedRoleIds);
      const allow = new Set(
        brief.matchedRoleIds.map((id) => resolveLegacyAgencyRoleId(id)).filter(Boolean),
      );
      return matched.filter((e) => {
        if (e.roleKind === "boss") return false;
        const rid = resolveLegacyAgencyRoleId(e.agentRoleId || "");
        return rid && allow.has(rid);
      });
    }

    return resolveProjectEmployees(
      project,
      await loadEmployees().catch(() => readEmployees()),
    ).filter((e) => e.roleKind !== "boss");
  }

  async function buildPreview(forceAll: boolean): Promise<KickoffPreview> {
    loading.value = true;
    error.value = "";
    try {
      const targets = await resolveKickoffTargets(forceAll);
      if (!targets.length) {
        throw new Error("花名册为空或 Brief 匹配岗位无人。");
      }
      const industry = opts.fouProject.value?.type || "software";
      const grouped = groupEmployeesByWave(targets, industry);
      const order = kickoffWaveOrder(industry);
      const waves: KickoffWaveRow[] = [];
      for (const wave of order) {
        const batch = grouped[wave];
        if (!batch.length) continue;
        waves.push({
          wave,
          label: waveLabel(wave, industry),
          count: batch.length,
          names: batch.map((e) => e.name).join("、"),
        });
      }
      const parallel = readKickoffParallel();
      const kickoffMax = readKickoffMaxEmployees();
      const matchedOnly = !forceAll && Boolean(opts.brief.value?.matchedRoleIds?.length);
      const lines = [
        `共 ${targets.length} 人 · 波内并行 ${parallel || 1}`,
        matchedOnly ? "按 Brief 匹配岗位派活" : "全员派活",
      ];
      for (const row of waves) {
        lines.push(`${row.label}（${row.count}）：${row.names}`);
      }
      const result: KickoffPreview = {
        total: targets.length,
        parallel: parallel || 1,
        kickoffMax,
        matchedOnly,
        waves,
        summaryText: lines.join("\n"),
      };
      preview.value = result;
      return result;
    } catch (e) {
      error.value = toUserError(e);
      preview.value = null;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  return {
    loading,
    preview,
    error,
    buildPreview,
  };
}
