/**
 * IDE-style duplicate naming: `file.txt` → `file copy.txt` → `file copy 2.txt`
 */
export function resolveUniquePasteName(baseName: string, siblingNames: string[]): string {
  const lowerSet = new Set(siblingNames.map((n) => n.toLowerCase()));
  if (!lowerSet.has(baseName.toLowerCase())) return baseName;

  const dot = baseName.lastIndexOf(".");
  const hasExt = dot > 0;
  const stem = hasExt ? baseName.slice(0, dot) : baseName;
  const ext = hasExt ? baseName.slice(dot) : "";

  const first = `${stem} copy${ext}`;
  if (!lowerSet.has(first.toLowerCase())) return first;

  for (let i = 2; i < 10_000; i++) {
    const candidate = `${stem} copy ${i}${ext}`;
    if (!lowerSet.has(candidate.toLowerCase())) return candidate;
  }
  return `${stem} copy ${Date.now()}${ext}`;
}
