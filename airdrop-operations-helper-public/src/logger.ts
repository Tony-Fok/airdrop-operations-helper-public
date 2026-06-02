import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionReportRow } from "./types.js";
import { REPORTS_DIR, todayYmd } from "./utils.js";

const CSV_HEADERS: Array<keyof SessionReportRow> = [
  "date",
  "session_label",
  "wallet_address",
  "task_title",
  "task_date",
  "token_symbol",
  "token_contract",
  "recipient_count",
  "amount_per_address",
  "expected_total_airdrop_amount",
  "actual_wallet_confirm_count",
  "tx_hashes",
  "tx_hash_count",
  "native_before",
  "native_after",
  "native_gas_cost_by_balance",
  "native_gas_cost_by_receipt",
  "token_balance_before",
  "token_balance_after",
  "token_balance_delta",
  "holders_before",
  "holders_after",
  "holders_delta",
  "holders_count_delta",
  "holders_wait_status",
  "gas_per_recipient",
  "explorer_check_status",
  "explorer_check_error",
  "explorer_check_attempts",
  "status",
  "error_message",
  "started_at",
  "finished_at",
  "screenshot_paths"
];

export async function appendSessionSummary(row: SessionReportRow): Promise<string> {
  await mkdir(REPORTS_DIR, { recursive: true });
  const reportPath = await resolveReportPath();

  if (!(await fileExists(reportPath))) {
    await writeFile(reportPath, `${CSV_HEADERS.join(",")}\n`, "utf8");
  }

  await appendFile(reportPath, `${formatRow(row)}\n`, "utf8");
  return reportPath;
}

async function resolveReportPath(): Promise<string> {
  const baseReportPath = path.join(REPORTS_DIR, `airdrop_session_summary_${todayYmd()}.csv`);

  if (!(await fileExists(baseReportPath))) {
    return baseReportPath;
  }

  const firstLine = (await readFile(baseReportPath, "utf8")).split(/\r?\n/, 1)[0];
  if (firstLine === CSV_HEADERS.join(",")) {
    return baseReportPath;
  }

  return path.join(REPORTS_DIR, `airdrop_session_summary_${todayYmd()}_v2.csv`);
}

function formatRow(row: SessionReportRow): string {
  return CSV_HEADERS.map((header) => {
    const value = row[header];

    if (Array.isArray(value)) {
      return csvEscape(value.join("|"));
    }

    return csvEscape(String(value ?? ""));
  }).join(",");
}

function csvEscape(value: string): string {
  const normalized = value.replace(/\r?\n/g, "\\n");
  if (/[",\n\r]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
