/**
 * @file 只读 CSV → Brief 结构化片段
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @version 1.0.0
 * @category Parse
 * @algo csv-header-rows
 */

export type CsvTable = {
  headers: string[];
  rows: string[][];
};

/** Minimal RFC4180-ish split (quoted fields, comma sep). */
export function parseCsvText(raw: string, maxRows = 50): CsvTable {
  const text = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (!text) return { headers: [], rows: [] };
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { headers: [], rows: [] };

  function splitLine(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') {
          inQ = false;
        } else {
          cur += c;
        }
      } else if (c === '"') {
        inQ = true;
      } else if (c === ",") {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    out.push(cur.trim());
    return out;
  }

  const headers = splitLine(lines[0]);
  const rows = lines.slice(1, 1 + maxRows).map(splitLine);
  return { headers, rows };
}

/** Format for Brief / system inject. */
export function csvTableToBriefSnippet(table: CsvTable, label = "CSV"): string {
  if (!table.headers.length) return "";
  const head = table.headers.join(" | ");
  const body = table.rows
    .slice(0, 20)
    .map((r) => r.join(" | "))
    .join("\n");
  return [
    `【数据连接器 · ${label} · 只读】`,
    `列：${head}`,
    body || "(无数据行)",
    "（xlsx/SQL 连接器后续迭代；请基于上表结构化字段作答，勿臆造行）",
  ].join("\n");
}
