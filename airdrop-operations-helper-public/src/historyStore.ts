import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { REPORTS_DIR } from "./utils.js";

export type HistoryRow = Record<string, string>;

export async function readTaskHistory(limit = 200): Promise<HistoryRow[]> {
  const files = await readdir(REPORTS_DIR).catch(() => []);
  const csvFiles = files
    .filter((file) => /^airdrop_session_summary_.*\.csv$/.test(file))
    .sort()
    .reverse();
  const rows: HistoryRow[] = [];

  for (const file of csvFiles) {
    const content = await readFile(path.join(REPORTS_DIR, file), "utf8").catch(() => "");
    if (!content.trim()) {
      continue;
    }

    const [headerLine, ...dataLines] = content.split(/\r?\n/).filter(Boolean);
    const headers = parseCsvLine(headerLine);

    for (const line of dataLines.reverse()) {
      const values = parseCsvLine(line);
      const row: HistoryRow = { report_file: file };
      headers.forEach((header, index) => {
        row[header] = values[index] ?? "";
      });
      rows.push(row);

      if (rows.length >= limit) {
        return rows;
      }
    }
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}
