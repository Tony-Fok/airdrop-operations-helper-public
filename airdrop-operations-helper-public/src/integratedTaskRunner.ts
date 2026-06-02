import type { AirdropConfig, ResolvedTask } from "./types.js";
import { DashboardTaskRunner, type DashboardTaskSnapshot } from "./dashboardTaskRunner.js";
import { appendIntegratedTaskHistory } from "./integratedHistoryStore.js";
import { resolveTaskFromConfig } from "./task.js";
import { normalizeError, safeFilePart, sleep } from "./utils.js";

const INTEGRATED_AIRDROP_WAIT_MS = 30 * 60 * 1000;
const AIRDROP_RECIPIENTS_PER_TX = 200;
const AIRDROP_APPROVAL_TX_COUNT = 1;

export type IntegratedTaskStatus =
  | "idle"
  | "running"
  | "waiting_for_user"
  | "settling"
  | "completed"
  | "failed"
  | "cancelled";

export type IntegratedSubTaskStatus =
  | "pending"
  | "starting"
  | "waiting_for_user"
  | "waiting_for_airdrop_finish"
  | "settling"
  | "completed"
  | "failed"
  | "skipped";

export interface IntegratedSubTaskSnapshot {
  index: number;
  status: IntegratedSubTaskStatus;
  task: ResolvedTask;
  started_at: string;
  finished_at: string;
  report_path: string;
  wallet_confirmations: number;
  tx_hash_count: number;
  native_before: string;
  native_after: string;
  native_gas_cost_total: string;
  token_balance_after: string;
  token_balance_delta: string;
  holders_after: string;
  holders_delta: string;
  explorer_check_status: string;
  error_message: string;
}

export interface IntegratedTaskSnapshot {
  queue_id: string;
  status: IntegratedTaskStatus;
  queue_title: string;
  current_index: number;
  total_count: number;
  current_task: ResolvedTask | null;
  started_at: string;
  finished_at: string;
  error_message: string;
  subtasks: IntegratedSubTaskSnapshot[];
  active_task_snapshot: DashboardTaskSnapshot | null;
  logs: string[];
}

interface IntegratedTaskState {
  queueId: string;
  status: IntegratedTaskStatus;
  queueTitle: string;
  currentIndex: number;
  startedAt: Date;
  finishedAt: Date | null;
  errorMessage: string;
  subtasks: IntegratedSubTaskSnapshot[];
  activeTaskSnapshot: DashboardTaskSnapshot | null;
  cancelRequested: boolean;
  forceEndRequested: boolean;
  historySaved: boolean;
  autoClickAirdropPage: boolean;
  logs: string[];
}

export class IntegratedTaskRunner {
  private state: IntegratedTaskState | null = null;
  private runPromise: Promise<void> | null = null;
  private lastSnapshot: IntegratedTaskSnapshot = this.emptySnapshot();

  constructor(private readonly taskRunner: DashboardTaskRunner) {}

  parseQueue(taskTitles: string[], config: AirdropConfig): IntegratedSubTaskSnapshot[] {
    return normalizeTaskTitles(taskTitles).map((taskTitle, index) => ({
      index,
      status: "pending",
      task: resolveTaskFromConfig(taskTitle, config),
      started_at: "",
      finished_at: "",
      report_path: "",
      wallet_confirmations: 0,
      tx_hash_count: 0,
      native_before: "",
      native_after: "",
      native_gas_cost_total: "",
      token_balance_after: "",
      token_balance_delta: "",
      holders_after: "",
      holders_delta: "",
      explorer_check_status: "",
      error_message: ""
    }));
  }

  startQueue(options: {
    queueTitle?: string;
    taskTitles: string[];
    config: AirdropConfig;
    autoClickAirdropPage?: boolean;
  }): IntegratedTaskSnapshot {
    if (this.state && isInProgress(this.state.status)) {
      throw new Error(`Integrated task "${this.state.queueTitle}" is already active`);
    }

    const subtasks = this.parseQueue(options.taskTitles, options.config);
    if (subtasks.length === 0) {
      throw new Error("Integrated task requires at least one sub task");
    }

    const queueTitle = options.queueTitle?.trim() || `integrated_${subtasks[0].task.task_date}_${subtasks.length}`;
    this.state = {
      queueId: buildQueueId(queueTitle),
      status: "running",
      queueTitle,
      currentIndex: 0,
      startedAt: new Date(),
      finishedAt: null,
      errorMessage: "",
      subtasks,
      activeTaskSnapshot: null,
      cancelRequested: false,
      forceEndRequested: false,
      historySaved: false,
      autoClickAirdropPage: options.autoClickAirdropPage ?? true,
      logs: []
    };
    this.log(`[${queueTitle}] integrated task started with ${subtasks.length} sub tasks`);
    this.log(
      `[${queueTitle}] auto page airdrop click ${this.state.autoClickAirdropPage ? "enabled" : "disabled"}`
    );

    this.runPromise = this.runQueue(this.state, options.config)
      .catch((error) => {
        const message = normalizeError(error);
        if (this.state) {
          this.state.status = "failed";
          this.state.errorMessage = message;
          this.state.finishedAt = new Date();
          this.log(`[${this.state.queueTitle}] integrated task failed: ${message}`);
          void this.saveHistory(this.state);
        }
      })
      .finally(() => {
        this.runPromise = null;
        this.lastSnapshot = this.getSnapshot();
      });

    this.lastSnapshot = this.getSnapshot();
    return this.lastSnapshot;
  }

  async cancelQueue(): Promise<IntegratedTaskSnapshot> {
    const state = this.state;
    if (!state || !isInProgress(state.status)) {
      return this.getSnapshot();
    }

    state.cancelRequested = true;
    state.status = "cancelled";
    state.errorMessage = "Integrated task cancelled by user";
    this.log(`[${state.queueTitle}] cancel requested`);

    await this.taskRunner.cancelTask().catch((error) => {
      this.log(`[${state.queueTitle}] active sub task cancel failed: ${normalizeError(error)}`);
    });
    await this.runPromise?.catch(() => undefined);

    state.finishedAt = state.finishedAt ?? new Date();
    await this.saveHistory(state);
    this.lastSnapshot = this.snapshotFromState(state);
    return this.lastSnapshot;
  }

  async forceEndQueue(): Promise<IntegratedTaskSnapshot> {
    const state = this.state;
    if (!state || !isInProgress(state.status)) {
      return this.getSnapshot();
    }

    state.forceEndRequested = true;
    state.status = "settling";
    state.errorMessage = "Integrated task force ended and settled by user";
    this.log(`[${state.queueTitle}] force end and settle requested`);

    const subtask = state.subtasks[state.currentIndex];
    if (subtask && !["completed", "failed", "skipped"].includes(subtask.status)) {
      subtask.status = "settling";
      try {
        state.activeTaskSnapshot = await this.taskRunner.settleTask({
          force: true,
          keepBrowserSession: false
        });
        applySettlementSnapshot(subtask, state.activeTaskSnapshot);
        subtask.status = state.activeTaskSnapshot.status === "completed" ? "completed" : "failed";
      } catch (error) {
        subtask.status = "failed";
        subtask.error_message = appendMessage(subtask.error_message, `force settle failed: ${normalizeError(error)}`);
      }
      subtask.finished_at = subtask.finished_at || new Date().toISOString();
    }

    this.markRemainingSkipped(state, state.currentIndex + 1);
    state.status = state.subtasks.some((item) => item.status === "failed") ? "failed" : "completed";
    state.finishedAt = new Date();
    await this.saveHistory(state);
    await this.runPromise?.catch(() => undefined);
    this.lastSnapshot = this.snapshotFromState(state);
    return this.lastSnapshot;
  }

  getSnapshot(): IntegratedTaskSnapshot {
    if (!this.state) {
      return this.lastSnapshot;
    }

    if (isInProgress(this.state.status)) {
      this.state.activeTaskSnapshot = this.taskRunner.getSnapshot();
    }
    this.lastSnapshot = this.snapshotFromState(this.state);
    return this.lastSnapshot;
  }

  private async runQueue(state: IntegratedTaskState, config: AirdropConfig): Promise<void> {
    for (let index = 0; index < state.subtasks.length; index += 1) {
      if (state.cancelRequested) {
        this.markRemainingSkipped(state, index);
        await this.finishState(state, "cancelled", "Integrated task cancelled by user");
        return;
      }

      if (state.forceEndRequested) {
        this.markRemainingSkipped(state, index);
        await this.finishState(state, state.status, state.errorMessage);
        return;
      }

      state.currentIndex = index;
      const subtask = state.subtasks[index];
      subtask.status = "starting";
      subtask.started_at = new Date().toISOString();
      this.log(`[${state.queueTitle}] starting sub task ${index + 1}/${state.subtasks.length}: ${subtask.task.task_title}`);

      try {
        state.activeTaskSnapshot = await this.taskRunner.startTask(subtask.task.task_title, config, {
          reuseBrowserSession: true,
          autoClickAirdropPage: state.autoClickAirdropPage
        });
        subtask.status = "waiting_for_user";
        state.status = "waiting_for_user";
        this.log(
          state.autoClickAirdropPage
            ? `[${state.queueTitle}] sub task ${subtask.task.task_title} page airdrop click was requested automatically`
            : `[${state.queueTitle}] sub task ${subtask.task.task_title} is ready for manual page check and airdrop click`
        );

        subtask.status = "waiting_for_airdrop_finish";
        try {
          const expectedAirdropTxCount = estimateExpectedAirdropTxCount(subtask.task.recipient_count);
          const expectedTxCount = expectedAirdropTxCount + AIRDROP_APPROVAL_TX_COUNT;
          this.log(
            `[${state.queueTitle}] waiting for sub task ${subtask.task.task_title} tx threshold: ${expectedTxCount} (${expectedAirdropTxCount} airdrop + ${AIRDROP_APPROVAL_TX_COUNT} approval)`
          );
          await this.taskRunner.waitForActiveTaskAirdropTransactions(expectedTxCount, INTEGRATED_AIRDROP_WAIT_MS, {
            completionMinTxCount: expectedAirdropTxCount,
            shouldStop: () => state.cancelRequested || state.forceEndRequested
          });
        } catch (waitError) {
          const message = normalizeError(waitError);
          this.log(
            `[${state.queueTitle}] sub task ${subtask.task.task_title} tx threshold wait failed; continuing to settlement: ${message}`
          );
          subtask.error_message = appendMessage(subtask.error_message, `tx threshold wait failed: ${message}`);
        }

        subtask.status = "settling";
        state.status = "settling";
        state.activeTaskSnapshot = await this.settleSubTaskWithRetry(index < state.subtasks.length - 1);

        applySettlementSnapshot(subtask, state.activeTaskSnapshot);

        if (state.forceEndRequested) {
          subtask.status = state.activeTaskSnapshot.status === "completed" ? "completed" : "failed";
          this.markRemainingSkipped(state, index + 1);
          await this.finishState(
            state,
            subtask.status === "failed" ? "failed" : "completed",
            state.errorMessage || "Integrated task force ended and settled by user"
          );
          return;
        }

        if (state.activeTaskSnapshot.status !== "completed") {
          subtask.status = "failed";
          state.status = "failed";
          state.errorMessage = state.activeTaskSnapshot.error_message || `Sub task ${subtask.task.task_title} failed`;
          this.markRemainingSkipped(state, index + 1);
          await this.saveHistory(state);
          return;
        }

        if (isExplorerWarningStatus(subtask.explorer_check_status)) {
          this.log(
            `[${state.queueTitle}] sub task ${subtask.task.task_title} completed with explorer warning: ${subtask.explorer_check_status}`
          );
        }

        subtask.status = "completed";
        state.status = "running";
        this.log(`[${state.queueTitle}] sub task completed: ${subtask.task.task_title}`);
      } catch (error) {
        const message = normalizeError(error);

        if (state.cancelRequested) {
          subtask.status = "skipped";
          state.status = "cancelled";
          state.errorMessage = "Integrated task cancelled by user";
          this.markRemainingSkipped(state, index + 1);
          await this.saveHistory(state);
          return;
        }

        subtask.status = "failed";
        subtask.error_message = message;
        state.status = "failed";
        state.errorMessage = message;
        this.log(`[${state.queueTitle}] sub task failed: ${subtask.task.task_title}: ${message}`);

        try {
          state.activeTaskSnapshot = await this.taskRunner.settleTask({
            force: true,
            keepBrowserSession: false
          });
          applySettlementSnapshot(subtask, state.activeTaskSnapshot);
        } catch (settleError) {
          subtask.error_message = appendMessage(subtask.error_message, `force settle failed: ${normalizeError(settleError)}`);
        }

        this.markRemainingSkipped(state, index + 1);
        await this.saveHistory(state);
        return;
      }
    }

    state.currentIndex = state.subtasks.length - 1;
    await this.finishState(state, "completed", "");
    this.log(`[${state.queueTitle}] integrated task completed`);
  }

  private async finishState(
    state: IntegratedTaskState,
    status: IntegratedTaskStatus,
    errorMessage: string
  ): Promise<void> {
    state.status = status;
    state.errorMessage = errorMessage;
    state.finishedAt = state.finishedAt ?? new Date();
    await this.saveHistory(state);
  }

  private async saveHistory(state: IntegratedTaskState): Promise<void> {
    if (state.historySaved) {
      return;
    }

    if (!["completed", "failed", "cancelled"].includes(state.status)) {
      return;
    }

    state.finishedAt = state.finishedAt ?? new Date();
    state.historySaved = true;

    await appendIntegratedTaskHistory({
      queue_id: state.queueId,
      date: state.finishedAt.toISOString().slice(0, 10),
      queue_title: state.queueTitle,
      status: state.status,
      total_count: state.subtasks.length,
      completed_count: state.subtasks.filter((subtask) => subtask.status === "completed").length,
      failed_count: state.subtasks.filter((subtask) => subtask.status === "failed").length,
      skipped_count: state.subtasks.filter((subtask) => subtask.status === "skipped").length,
      started_at: state.startedAt.toISOString(),
      finished_at: state.finishedAt.toISOString(),
      error_message: state.errorMessage,
      subtasks: state.subtasks
    });
  }

  private async settleSubTaskWithRetry(keepBrowserSession: boolean): Promise<DashboardTaskSnapshot> {
    const attempts = 3;
    let latest = this.taskRunner.getSnapshot();

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      latest = await this.taskRunner.settleTask({
        force: false,
        keepBrowserSession
      });

      if (isTerminalDashboardStatus(latest.status)) {
        return latest;
      }

      this.log(
        `[${this.state?.queueTitle ?? "integrated"}] settlement attempt ${attempt}/${attempts} returned non-terminal status ${latest.status}; retrying`
      );
      await sleep(5000);
    }

    return latest;
  }

  private markRemainingSkipped(state: IntegratedTaskState, startIndex: number): void {
    for (let index = startIndex; index < state.subtasks.length; index += 1) {
      if (state.subtasks[index].status === "pending") {
        state.subtasks[index].status = "skipped";
      }
    }
    state.finishedAt = state.finishedAt ?? new Date();
  }

  private snapshotFromState(state: IntegratedTaskState): IntegratedTaskSnapshot {
    const current = state.subtasks[state.currentIndex]?.task ?? null;
    return {
      queue_id: state.queueId,
      status: state.status,
      queue_title: state.queueTitle,
      current_index: state.currentIndex,
      total_count: state.subtasks.length,
      current_task: current,
      started_at: state.startedAt.toISOString(),
      finished_at: state.finishedAt?.toISOString() ?? "",
      error_message: state.errorMessage,
      subtasks: state.subtasks,
      active_task_snapshot: state.activeTaskSnapshot,
      logs: state.logs
    };
  }

  private emptySnapshot(): IntegratedTaskSnapshot {
    return {
      queue_id: "",
      status: "idle",
      queue_title: "",
      current_index: 0,
      total_count: 0,
      current_task: null,
      started_at: "",
      finished_at: "",
      error_message: "",
      subtasks: [],
      active_task_snapshot: null,
      logs: []
    };
  }

  private log(message: string): void {
    const state = this.state;
    if (!state) {
      return;
    }

    const entry = `${new Date().toISOString()} ${message}`;
    state.logs.push(entry);
    if (state.logs.length > 500) {
      state.logs = state.logs.slice(-500);
    }
    console.log(entry);
  }
}

function normalizeTaskTitles(taskTitles: string[]): string[] {
  return taskTitles.map((taskTitle) => taskTitle.trim()).filter(Boolean);
}

function isInProgress(status: IntegratedTaskStatus): boolean {
  return ["running", "waiting_for_user", "settling"].includes(status);
}

function isExplorerWarningStatus(status: string): boolean {
  return status === "failed" || status === "stale_or_no_change" || status === "token_success_holders_pending";
}

function isTerminalDashboardStatus(status: DashboardTaskSnapshot["status"]): boolean {
  return ["completed", "failed", "cancelled", "idle"].includes(status);
}

function estimateExpectedAirdropTxCount(recipientCount: number): number {
  return Math.max(1, Math.ceil(recipientCount / AIRDROP_RECIPIENTS_PER_TX));
}

function buildQueueId(queueTitle: string): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeFilePart(queueTitle)}`;
}

function applySettlementSnapshot(subtask: IntegratedSubTaskSnapshot, snapshot: DashboardTaskSnapshot): void {
  subtask.finished_at = snapshot.finished_at;
  subtask.report_path = snapshot.report_path;
  subtask.wallet_confirmations = snapshot.wallet_confirmations;
  subtask.tx_hash_count = snapshot.tx_hash_count;
  subtask.native_before = snapshot.native_before;
  subtask.native_after = snapshot.native_after;
  subtask.native_gas_cost_total = snapshot.native_gas_cost_total;
  subtask.token_balance_after = snapshot.explorer_verification?.token_balance_after ?? "";
  subtask.token_balance_delta = snapshot.explorer_verification?.token_balance_delta ?? "";
  subtask.holders_after = snapshot.explorer_verification?.holders_after ?? "";
  subtask.holders_delta = snapshot.explorer_verification?.holders_delta || snapshot.explorer_verification?.holders_count_delta || "";
  subtask.explorer_check_status = snapshot.explorer_verification?.explorer_check_status ?? "";
  subtask.error_message = appendMessage(subtask.error_message, snapshot.error_message);
}

function appendMessage(current: string, next: string): string {
  return [current, next].filter(Boolean).join("; ");
}
