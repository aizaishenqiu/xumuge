/**
 * Parse employee self-reported acceptance from agent output.
 */
export function parseAcceptanceReport(text: string): {
  lines: string[];
  checked: string[];
  unchecked: string[];
} {
  const raw = text || "";
  const marker = /XU_ACCEPTANCE_REPORT\s*:?/i;
  const idx = raw.search(marker);
  if (idx < 0) return { lines: [], checked: [], unchecked: [] };
  const tail = raw.slice(idx).split(/\n/).slice(1, 20);
  const lines: string[] = [];
  const checked: string[] = [];
  const unchecked: string[] = [];
  for (const line of tail) {
    const t = line.trim();
    if (!t || /^#{1,3}\s/.test(t)) break;
    const m = t.match(/^\d+\.\s*\[([xX ])\]\s*(.+)$/);
    if (!m) continue;
    lines.push(t);
    if (m[1].toLowerCase() === "x") checked.push(m[2].trim());
    else unchecked.push(m[2].trim());
  }
  return { lines, checked, unchecked };
}
