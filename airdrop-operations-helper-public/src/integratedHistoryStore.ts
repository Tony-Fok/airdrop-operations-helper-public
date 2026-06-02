import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedTask } from "./types.js";
import { REPORTS_DIR } from "./utils.js";

export interface IntegratedHistorySubTask {
  index: number;
  status: string;
  task: ResolvedTask;
  started_at: string;
  finished_at: string;
  report_path: string;
  native_gas_cost_total?: string;
  token_balance_after?: string;
  token_balance_delta?: string;
  holders_after?: string;
  holders_delta?: string;
  explorer_check_status: string;
  error_message: string;
}

export interface IntegratedHistoryEntry {
  queue_id: string;
  date: string;
  queue_title: string;
  status: string;
  total_count: number;
  completed_count: number;
  failed_count: number;
  skipped_count: number;
  started_at: string;
  finished_at: string;
  error_message: string;
  subtasks: IntegratedHistorySubTask[];
}

const INTEGRATED_HISTORY_PATH = path.join(REPORTS_DIR, "integrated_task_history.json");

export async function appendIntegratedTaskHistory(entry: IntegratedHistoryEntry): Promise<void> {
  await mkdir(REPORTS_DIR, { recursive: true });
  const current = await readIntegratedTaskHistory(10000);
  const next = [
    ...current.filter((item) => item.queue_id !== entry.queue_id),
    entry
  ];
  await writeFile(INTEGRATED_HISTORY_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export async function readIntegratedTaskHistory(limit = 200): Promise<IntegratedHistoryEntry[]> {
  const raw = await readFile(INTEGRATED_HISTORY_PATH, "utf8").catch(() => "[]");
  const parsed = JSON.parse(raw) as IntegratedHistoryEntry[];
  return parsed
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))
    .slice(0, limit);
}
