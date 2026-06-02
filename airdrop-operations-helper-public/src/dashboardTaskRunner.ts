import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { Decimal } from "decimal.js";
import { DistributionPage } from "./distributionPage.js";
import { getTokenBalanceForAddress, getTokenHoldersCount, waitForHoldersCountChange } from "./blockscout.js";
import { getNativeBalance, sumGasCostFromReceipts } from "./gas.js";
import { appendSessionSummary } from "./logger.js";
import { resolveTaskFromConfig } from "./task.js";
import { watchWalletPopups } from "./walletWatcher.js";
import type { AirdropConfig, ExplorerVerification, ResolvedTask, SessionReportRow, WalletWatchResult } from "./types.js";
import {
  decimalSubtract,
  ensureRuntimeDirs,
  normalizeError,
  safeFilePart,
  SCREENSHOTS_DIR,
  sleep,
  todayYmd
} from "./utils.js";

const DEFAULT_HOLDERS_WAIT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_HOLDERS_WAIT_INTERVAL_MS = 15 * 1000;

type DashboardTaskStatus =
  | "idle"
  | "parsed"
  | "starting"
  | "waiting_for_user"
  | "fetching_explorer_data"
  | "completed"
  | "failed"
  | "cancelled";

interface BrowserSession {
  browser?: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

interface ActiveTaskState {
  config: AirdropConfig;
  task: ResolvedTask;
  sessionLabel: string;
  startedAt: Date;
  browserSession: BrowserSession;
  distributionPage: DistributionPage;
  stopWalletWatcher: boolean;
  walletWatchPromise: Promise<WalletWatchResult>;
  walletResult: WalletWatchResult;
  lastWalletActionAt: number;
  lastWalletPageDetectedAt: number;
  screenshotPaths: string[];
  txHashes: string[];
  txHashBaseline: string[];
  nativeBefore: string;
  explorerVerification: ExplorerVerification;
  status: DashboardTaskStatus;
  errorMessage: string;
}

export interface DashboardTaskSnapshot {
  status: DashboardTaskStatus;
  task: ResolvedTask | null;
  started_at: string;
  finished_at: string;
  wallet_confirmations: number;
  native_before: string;
  native_after: string;
  native_gas_cost_total: string;
  native_gas_cost_by_receipt: string;
  tx_hash_count: number;
  explorer_verification: ExplorerVerification | null;
  report_path: string;
  error_message: string;
  logs: string[];
}

export class DashboardTaskRunner {
  private activeTask: ActiveTaskState | null = null;
  private retainedBrowserSession: BrowserSession | null = null;
  private endingPromise: Promise<DashboardTaskSnapshot> | null = null;
  private lastSnapshot: DashboardTaskSnapshot = this.emptySnapshot();
  private logs: string[] = [];

  parseTask(taskTitle: string, config: AirdropConfig): ResolvedTask {
    const task = resolveTaskFromConfig(taskTitle, config);
    this.lastSnapshot = {
      ...this.lastSnapshot,
      status: "parsed",
      task,
      error_message: "",
      logs: this.logs
    };
    return task;
  }

  async startTask(
    taskTitle: string,
    config: AirdropConfig,
    options: { reuseBrowserSession?: boolean; autoClickAirdropPage?: boolean } = {}
  ): Promise<DashboardTaskSnapshot> {
    if (this.endingPromise) {
      throw new Error("Previous task is still settling. Wait for settlement to finish before starting a new task.");
    }

    if (this.activeTask) {
      throw new Error(`Task ${this.activeTask.task.task_title} is already active`);
    }

    await ensureRuntimeDirs();
    const task = resolveTaskFromConfig(taskTitle, config);
    const sessionLabel = task.task_title || config.session_label || "manual_airdrop";
    const startedAt = new Date();
    this.logs = [];
    this.log(`[${sessionLabel}] task parsed`);
    this.log(
      `[${sessionLabel}] auto page airdrop click ${options.autoClickAirdropPage ? "enabled" : "disabled"}`
    );

    const browserSession = await this.openTaskBrowserSession(config, options);
    const distributionPage = new DistributionPage(browserSession.page);
    let activeTask: ActiveTaskState | null = null;

    try {
      this.lastSnapshot = {
        ...this.emptySnapshot(),
        status: "starting",
        task,
        started_at: startedAt.toISOString(),
        logs: this.logs
      };

      activeTask = {
        config,
        task,
        sessionLabel,
        startedAt,
        browserSession,
        distributionPage,
        stopWalletWatcher: false,
        walletWatchPromise: Promise.resolve({ confirmedCount: 0, failedCount: 0, screenshots: [] }),
        walletResult: { confirmedCount: 0, failedCount: 0, screenshots: [] },
        lastWalletActionAt: Date.now(),
        lastWalletPageDetectedAt: 0,
        screenshotPaths: [],
        txHashes: [],
        txHashBaseline: [],
        nativeBefore: "",
        explorerVerification: emptyExplorerVerification(),
        status: "starting",
        errorMessage: ""
      };

      this.activeTask = activeTask;
      this.lastSnapshot = this.snapshotFromActive(activeTask);
      this.log(`[${sessionLabel}] starting wallet watcher before page preparation`);
      const runningTask = activeTask;
      runningTask.walletWatchPromise = watchWalletPopups({
        browser: browserSession.browser,
        context: browserSession.context,
        cdpEndpoint: config.chrome_debug_url ?? "http://127.0.0.1:9222",
        tokenSymbol: sessionLabel,
        shouldStop: () => runningTask.stopWalletWatcher,
        onConfirmed: (confirmedCount) => {
          runningTask.walletResult = {
            ...runningTask.walletResult,
            confirmedCount
          };
          this.lastSnapshot = this.snapshotFromActive(runningTask);
        },
        onAction: () => {
          runningTask.lastWalletActionAt = Date.now();
        },
        onPageDetected: () => {
          runningTask.lastWalletPageDetectedAt = Date.now();
        },
        log: this.log.bind(this)
      });
      this.log(`[${sessionLabel}] wallet watcher started`);

      await browserSession.page.goto(config.airdrop_page_url, { waitUntil: "domcontentloaded" });
      await focusChromePage(browserSession.page, this.log.bind(this));
      let beforeDataReady = false;
      const beforeDataPromise = Promise.all([
        getNativeBalance(config.rpc_url, config.wallet_address, config.native_decimals),
        getExplorerBeforeVerification(config, task, this.log.bind(this))
      ]).then((result) => {
        beforeDataReady = true;
        return result;
      });
      this.log(`[${sessionLabel}] before balance and holders collection started`);
      await fillTaskInputs(distributionPage, task, this.log.bind(this), () => activeTask?.status !== "starting");
      if (activeTask.status !== "starting") {
        this.lastSnapshot = this.snapshotFromActive(activeTask);
        return this.lastSnapshot;
      }
      this.log(`[${sessionLabel}] airdrop page opened and task inputs filled`);
      activeTask.txHashBaseline = await distributionPage.extractTxHashesFromLogs().catch(() => []);

      if (!beforeDataReady) {
        this.log(`[${sessionLabel}] waiting for before balance and holders before page airdrop click`);
      }
      const [nativeBefore, explorerVerification] = await beforeDataPromise;
      activeTask.nativeBefore = nativeBefore;
      activeTask.explorerVerification = explorerVerification;
      this.log(`[${sessionLabel}] ${config.gas_token_symbol} before: ${activeTask.nativeBefore}`);

      if (options.autoClickAirdropPage) {
        await this.autoClickAirdropPageUntilTriggered(activeTask);
      } else {
        this.log(`[${sessionLabel}] waiting for manual page authorize and airdrop click`);
      }

      activeTask.status = "waiting_for_user";
      this.lastSnapshot = this.snapshotFromActive(activeTask);
      return this.lastSnapshot;
    } catch (error) {
      if (activeTask) {
        activeTask.stopWalletWatcher = true;
        await Promise.race([
          activeTask.walletWatchPromise.catch(() => activeTask?.walletResult),
          sleep(2000)
        ]);
      }
      this.activeTask = null;
      await browserSession.close();
      const message = normalizeError(error);
      this.log(`[${sessionLabel}] start failed: ${message}`);
      this.lastSnapshot = {
        ...this.emptySnapshot(),
        status: "failed",
        task,
        started_at: startedAt.toISOString(),
        error_message: message,
        logs: this.logs
      };
      throw error;
    }
  }

  async endTask(options: { force?: boolean; keepBrowserSession?: boolean } = {}): Promise<DashboardTaskSnapshot> {
    const activeTask = this.activeTask;
    if (!activeTask) {
      throw new Error("No active task to end");
    }

    let status: SessionReportRow["status"] = "failed";
    const endWarnings: string[] = [];
    let errorMessage = "";
    let nativeAfter = "";
    let nativeGasCostByBalance = "";
    let nativeGasCostByReceipt = "";
    const gasPerRecipient = "";
    let reportPath = "";

    activeTask.status = "fetching_explorer_data";
    this.lastSnapshot = this.snapshotFromActive(activeTask);
    this.log(
      options.force
        ? `[${activeTask.sessionLabel}] force ending task and collecting required data`
        : `[${activeTask.sessionLabel}] ending task and collecting data`
    );

    try {
      if (!options.force) {
        await this.waitForWalletWatcherIdle(activeTask);
      }

      activeTask.stopWalletWatcher = true;
      try {
        activeTask.walletResult = await activeTask.walletWatchPromise;
        activeTask.screenshotPaths.push(...activeTask.walletResult.screenshots);
      } catch (error) {
        const message = `wallet watcher result failed: ${normalizeError(error)}`;
        endWarnings.push(message);
        this.log(`[${activeTask.sessionLabel}] ${message}`);
      }

      try {
        activeTask.txHashes = await activeTask.distributionPage.extractTxHashesFromLogs();
      } catch (error) {
        const message = `tx hash extraction skipped: ${normalizeError(error)}`;
        endWarnings.push(message);
        this.log(`[${activeTask.sessionLabel}] ${message}`);
      }

      if (activeTask.txHashes.length > 0) {
        try {
          nativeGasCostByReceipt = await waitForReceiptGasTotal({
            config: activeTask.config,
            txHashes: activeTask.txHashes,
            log: this.log.bind(this)
          });
        } catch (error) {
          const message = `receipt gas calculation skipped: ${normalizeError(error)}`;
          endWarnings.push(message);
          this.log(`[${activeTask.sessionLabel}] ${message}`);
        }
      }

      try {
        nativeAfter = await getNativeBalance(
          activeTask.config.rpc_url,
          activeTask.config.wallet_address,
          activeTask.config.native_decimals
        );
        nativeGasCostByBalance = decimalSubtract(activeTask.nativeBefore, nativeAfter);
      } catch (error) {
        throw new Error(`native token after balance failed: ${normalizeError(error)}`);
      }

      try {
        activeTask.explorerVerification = await getExplorerAfterVerification({
          config: activeTask.config,
          task: activeTask.task,
          current: activeTask.explorerVerification,
          log: this.log.bind(this),
          force: options.force
        });
      } catch (error) {
        const message = `explorer after check failed: ${normalizeError(error)}`;
        endWarnings.push(message);
        activeTask.explorerVerification = {
          ...activeTask.explorerVerification,
          explorer_check_status: "failed",
          explorer_check_error: appendError(activeTask.explorerVerification.explorer_check_error, message)
        };
        this.log(`[${activeTask.sessionLabel}] ${message}`);
      }

      status = "completed";
      activeTask.status = "completed";
      errorMessage = endWarnings.join("; ");
      this.log(`[${activeTask.sessionLabel}] task completed`);
    } catch (error) {
      errorMessage = appendError(endWarnings.join("; "), normalizeError(error));
      activeTask.errorMessage = errorMessage;
      activeTask.status = "failed";
      this.log(`[${activeTask.sessionLabel}] end failed: ${errorMessage}`);
      activeTask.screenshotPaths.push(await takeFailureScreenshot(activeTask.browserSession.page, activeTask.sessionLabel));
    } finally {
      const finishedAt = new Date();
      reportPath = await appendSessionSummary(
        buildReportRow({
          config: activeTask.config,
          sessionLabel: activeTask.sessionLabel,
          task: activeTask.task,
          startedAt: activeTask.startedAt,
          finishedAt,
          status,
          errorMessage,
          actualWalletConfirmCount: activeTask.walletResult.confirmedCount,
          txHashes: activeTask.txHashes,
          nativeBefore: activeTask.nativeBefore,
          nativeAfter,
          nativeGasCostByBalance,
          nativeGasCostByReceipt,
          gasPerRecipient,
          explorerVerification: activeTask.explorerVerification,
          screenshotPaths: activeTask.screenshotPaths
        })
      );

      if (options.keepBrowserSession) {
        this.retainedBrowserSession = activeTask.browserSession;
      } else {
        await activeTask.browserSession.page.close().catch(() => undefined);
        await activeTask.browserSession.close();
        if (this.retainedBrowserSession === activeTask.browserSession) {
          this.retainedBrowserSession = null;
        }
      }

      this.lastSnapshot = {
        status: activeTask.status,
        task: activeTask.task,
        started_at: activeTask.startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        wallet_confirmations: activeTask.walletResult.confirmedCount,
        native_before: activeTask.nativeBefore,
        native_after: nativeAfter,
        native_gas_cost_total: preferredGasCost(nativeGasCostByBalance, nativeGasCostByReceipt),
        native_gas_cost_by_receipt: nativeGasCostByReceipt,
        tx_hash_count: activeTask.txHashes.length,
        explorer_verification: activeTask.explorerVerification,
        report_path: reportPath,
        error_message: errorMessage,
        logs: this.logs
      };
      this.activeTask = null;
    }

    return this.lastSnapshot;
  }

  requestEndTask(options: { force?: boolean; keepBrowserSession?: boolean } = {}): DashboardTaskSnapshot {
    const activeTask = this.activeTask;
    if (!activeTask) {
      return this.getSnapshot();
    }

    if (this.endingPromise) {
      return this.getSnapshot();
    }

    activeTask.status = "fetching_explorer_data";
    this.lastSnapshot = this.snapshotFromActive(activeTask);
    this.endingPromise = this.endTask(options)
      .catch((error) => {
        const message = normalizeError(error);
        this.log(`[${activeTask.sessionLabel}] background end failed: ${message}`);
        this.lastSnapshot = {
          ...this.lastSnapshot,
          status: "failed",
          error_message: message,
          logs: this.logs
        };
        this.activeTask = null;
        return this.lastSnapshot;
      })
      .finally(() => {
        this.endingPromise = null;
      });

    return this.getSnapshot();
  }

  async settleTask(options: { force?: boolean; keepBrowserSession?: boolean } = {}): Promise<DashboardTaskSnapshot> {
    if (this.endingPromise) {
      const snapshot = await this.endingPromise;
      if (!this.activeTask || isTerminalTaskStatus(snapshot.status)) {
        return snapshot;
      }
      this.log(
        `[${this.activeTask.sessionLabel}] previous settlement returned non-terminal status ${snapshot.status}; retrying active task settlement`
      );
    }

    if (!this.activeTask) {
      return this.getSnapshot();
    }

    this.endingPromise = this.endTask(options)
      .catch((error) => {
        const message = normalizeError(error);
        this.log(`background end failed: ${message}`);
        this.lastSnapshot = {
          ...this.lastSnapshot,
          status: "failed",
          error_message: message,
          logs: this.logs
        };
        this.activeTask = null;
        return this.lastSnapshot;
      })
      .finally(() => {
        this.endingPromise = null;
      });

    return await this.endingPromise;
  }

  async waitForActiveTaskAirdropFinished(timeoutMs = 30 * 60 * 1000): Promise<void> {
    const activeTask = this.activeTask;
    if (!activeTask) {
      throw new Error("No active task to wait for");
    }

    this.log(`[${activeTask.sessionLabel}] waiting for airdrop page completion signal`);
    await activeTask.distributionPage.waitForAirdropProgressSinceBaseline({
      baselineTxHashes: activeTask.txHashBaseline,
      timeoutMs
    });
    this.log(`[${activeTask.sessionLabel}] airdrop page completion signal detected`);
  }

  private async autoClickAirdropPageUntilTriggered(activeTask: ActiveTaskState): Promise<void> {
    const maxAttempts = 3;
    const signalTimeoutMs = 15000;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const walletSignalBefore = Math.max(activeTask.lastWalletActionAt, activeTask.lastWalletPageDetectedAt);
      const txCountBefore = await activeTask.distributionPage.extractTxHashesFromLogs()
        .then((hashes) => hashes.length)
        .catch(() => activeTask.txHashes.length);

      this.log(
        attempt === 1
          ? `[${activeTask.sessionLabel}] auto clicking page authorize and airdrop button`
          : `[${activeTask.sessionLabel}] retrying page authorize and airdrop button (${attempt}/${maxAttempts})`
      );
      await activeTask.distributionPage.clickAuthorizeAndAirdrop((message) => this.log(`[${activeTask.sessionLabel}] ${message}`));

      const signal = await this.waitForAirdropClickSignal(activeTask, walletSignalBefore, txCountBefore, signalTimeoutMs);
      if (signal) {
        this.log(`[${activeTask.sessionLabel}] page airdrop click trigger confirmed: ${signal}`);
        return;
      }

      this.log(
        `[${activeTask.sessionLabel}] page airdrop click produced no wallet or tx signal after ${Math.round(signalTimeoutMs / 1000)}s`
      );
    }

    this.log(
      `[${activeTask.sessionLabel}] auto page airdrop click could not be confirmed; continuing to wait for manual click or tx progress`
    );
  }

  private async waitForAirdropClickSignal(
    activeTask: ActiveTaskState,
    walletSignalBefore: number,
    txCountBefore: number,
    timeoutMs: number
  ): Promise<string> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (activeTask.lastWalletPageDetectedAt > walletSignalBefore) {
        return "wallet page detected";
      }

      if (activeTask.lastWalletActionAt > walletSignalBefore) {
        return "wallet button clicked";
      }

      const txCount = await activeTask.distributionPage.extractTxHashesFromLogs()
        .then((hashes) => hashes.length)
        .catch(() => txCountBefore);
      if (txCount > txCountBefore) {
        activeTask.txHashes = await activeTask.distributionPage.extractTxHashesFromLogs().catch(() => activeTask.txHashes);
        this.lastSnapshot = this.snapshotFromActive(activeTask);
        return `tx count increased ${txCountBefore}->${txCount}`;
      }

      await sleep(1000);
    }

    return "";
  }

  async waitForActiveTaskAirdropTransactions(
    expectedTxCount: number,
    timeoutMs = 30 * 60 * 1000,
    options: { completionMinTxCount?: number; shouldStop?: () => boolean } = {}
  ): Promise<void> {
    const activeTask = this.activeTask;
    if (!activeTask) {
      throw new Error("No active task to wait for");
    }

    this.log(
      `[${activeTask.sessionLabel}] waiting for at least ${expectedTxCount} airdrop tx hashes`
    );
    const startedAt = Date.now();
    let lastLoggedAt = 0;

    while (Date.now() - startedAt < timeoutMs) {
      if (options.shouldStop?.()) {
        this.log(`[${activeTask.sessionLabel}] airdrop wait stopped because queue state changed`);
        return;
      }

      const progress = await activeTask.distributionPage.getAirdropProgress()
        .catch(() => ({ txCount: activeTask.txHashes.length, hasCompletionText: false }));
      const walletConfirmations = activeTask.walletResult.confirmedCount;
      const hasEnoughTx = progress.txCount >= expectedTxCount;
      const hasCompletionByTx = progress.hasCompletionText && progress.txCount >= (options.completionMinTxCount ?? expectedTxCount);
      const hasCompletionByWallet = progress.hasCompletionText && walletConfirmations >= expectedTxCount;

      if (hasEnoughTx || hasCompletionByTx || hasCompletionByWallet) {
        activeTask.txHashes = await activeTask.distributionPage.extractTxHashesFromLogs().catch(() => activeTask.txHashes);
        this.lastSnapshot = this.snapshotFromActive(activeTask);
        this.log(
          `[${activeTask.sessionLabel}] airdrop completion detected: tx=${progress.txCount}/${expectedTxCount}, wallet=${walletConfirmations}, completion_text=${progress.hasCompletionText}`
        );
        return;
      }

      const now = Date.now();
      if (now - lastLoggedAt >= 15000) {
        this.log(
          `[${activeTask.sessionLabel}] waiting for airdrop completion: tx=${progress.txCount}/${expectedTxCount}, wallet=${walletConfirmations}, completion_text=${progress.hasCompletionText}`
        );
        lastLoggedAt = now;
      }

      await sleep(3000);
    }

    throw new Error(`Airdrop completion wait timed out after ${Math.round(timeoutMs / 1000)}s.`);
  }

  private async waitForWalletWatcherIdle(activeTask: ActiveTaskState, idleMs = 8000, maxMs = 45000): Promise<void> {
    const startedAt = Date.now();
    activeTask.lastWalletActionAt = Math.max(activeTask.lastWalletActionAt, startedAt);
    this.log(`[${activeTask.sessionLabel}] waiting for wallet watcher idle before settlement`);

    while (Date.now() - startedAt < maxMs) {
      const idleFor = Date.now() - activeTask.lastWalletActionAt;
      if (idleFor >= idleMs) {
        this.log(`[${activeTask.sessionLabel}] wallet watcher idle for ${Math.round(idleFor / 1000)}s`);
        return;
      }

      await sleep(Math.min(1000, Math.max(idleMs - idleFor, 250)));
    }

    this.log(`[${activeTask.sessionLabel}] wallet watcher idle wait reached ${Math.round(maxMs / 1000)}s limit`);
  }

  async cancelTask(): Promise<DashboardTaskSnapshot> {
    const activeTask = this.activeTask;
    if (!activeTask) {
      return this.getSnapshot();
    }

    activeTask.stopWalletWatcher = true;
    activeTask.status = "cancelled";
    activeTask.errorMessage = "Task cancelled by user";
    this.log(`[${activeTask.sessionLabel}] task cancelled by user`);

    await Promise.race([
      activeTask.walletWatchPromise.catch(() => activeTask.walletResult),
      sleep(2000)
    ]);
    await activeTask.browserSession.page.close().catch(() => undefined);
    await activeTask.browserSession.close();
    if (this.retainedBrowserSession === activeTask.browserSession) {
      this.retainedBrowserSession = null;
    }

    this.lastSnapshot = {
      status: "cancelled",
      task: activeTask.task,
      started_at: activeTask.startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      wallet_confirmations: activeTask.walletResult.confirmedCount,
      native_before: activeTask.nativeBefore,
      native_after: "",
      native_gas_cost_total: "",
      native_gas_cost_by_receipt: "",
      tx_hash_count: activeTask.txHashes.length,
      explorer_verification: activeTask.explorerVerification,
      report_path: "",
      error_message: activeTask.errorMessage,
      logs: this.logs
    };
    this.activeTask = null;
    return this.lastSnapshot;
  }

  getSnapshot(): DashboardTaskSnapshot {
    if (this.activeTask) {
      this.lastSnapshot = this.snapshotFromActive(this.activeTask);
    }
    return {
      ...this.lastSnapshot,
      logs: this.logs
    };
  }

  private snapshotFromActive(activeTask: ActiveTaskState): DashboardTaskSnapshot {
    return {
      status: activeTask.status,
      task: activeTask.task,
      started_at: activeTask.startedAt.toISOString(),
      finished_at: "",
      wallet_confirmations: activeTask.walletResult.confirmedCount,
      native_before: activeTask.nativeBefore,
      native_after: "",
      native_gas_cost_total: "",
      native_gas_cost_by_receipt: "",
      tx_hash_count: activeTask.txHashes.length,
      explorer_verification: activeTask.explorerVerification,
      report_path: "",
      error_message: activeTask.errorMessage,
      logs: this.logs
    };
  }

  private emptySnapshot(): DashboardTaskSnapshot {
    return {
      status: "idle",
      task: null,
      started_at: "",
      finished_at: "",
      wallet_confirmations: 0,
      native_before: "",
      native_after: "",
      native_gas_cost_total: "",
      native_gas_cost_by_receipt: "",
      tx_hash_count: 0,
      explorer_verification: null,
      report_path: "",
      error_message: "",
      logs: []
    };
  }

  private log(message: string): void {
    const entry = `${new Date().toISOString()} ${message}`;
    this.logs.push(entry);
    if (this.logs.length > 500) {
      this.logs = this.logs.slice(-500);
    }
    console.log(entry);
  }

  private async openTaskBrowserSession(
    config: AirdropConfig,
    options: { reuseBrowserSession?: boolean }
  ): Promise<BrowserSession> {
    if (options.reuseBrowserSession && this.retainedBrowserSession && !this.retainedBrowserSession.page.isClosed()) {
      this.log("Reusing existing airdrop page for next sub task");
      const session = this.retainedBrowserSession;
      this.retainedBrowserSession = null;
      return session;
    }

    if (this.retainedBrowserSession) {
      await this.retainedBrowserSession.page.close().catch(() => undefined);
      await this.retainedBrowserSession.close();
      this.retainedBrowserSession = null;
    }

    return await openBrowserSession(config, this.log.bind(this));
  }
}

async function openBrowserSession(config: AirdropConfig, log: (message: string) => void): Promise<BrowserSession> {
  const browserMode = config.browser_mode ?? "connect_existing_chrome";

  if (browserMode === "connect_existing_chrome") {
    const endpoint = config.chrome_debug_url ?? "http://127.0.0.1:9222";
    await ensureChromeRemoteDebuggingAvailable(endpoint, log);
    await openChromePageViaDevTools(endpoint, config.airdrop_page_url, log);

    const browser = await connectToExistingChromeOrLaunch(endpoint, log);
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close();
      throw new Error("Connected to Chrome, but no browser context was found.");
    }

    const page = context.pages().find((entry) => entry.url().startsWith(config.airdrop_page_url))
      ?? await context.newPage();
    return {
      browser,
      context,
      page,
      close: async () => {
        await browser.close().catch(() => undefined);
      }
    };
  }

  const userDataDir = path.resolve(process.env.BROWSER_PROFILE_DIR ?? "./playwright-profile");
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chrome",
    headless: config.headless,
    viewport: { width: 1440, height: 1000 }
  });
  const page = await context.newPage();

  return {
    browser: context.browser() ?? undefined,
    context,
    page,
    close: async () => {
      await context.close().catch(() => undefined);
    }
  };
}

async function connectToExistingChromeOrLaunch(endpoint: string, log: (message: string) => void): Promise<Browser> {
  try {
    return await connectToExistingChrome(endpoint);
  } catch (firstError) {
    const firstMessage = normalizeError(firstError);
    log(`Cannot let Playwright control Chrome remote debugging at ${endpoint}.`);

    try {
      return await connectToExistingChrome(endpoint);
    } catch (secondError) {
      const secondMessage = normalizeError(secondError);
      throw new Error(
        [
          `Cannot control Google Chrome at ${endpoint}.`,
          "Dashboard 已經用 Chrome DevTools API 打開空投頁，但 Playwright 無法接管目前這個 Chrome。",
          "這通常是目前 Chrome 版本與 Playwright CDP 控制協議不兼容，或 Chrome 不是用可被 Playwright 管理的方式啟動。",
          "請先完全退出所有 Chrome，再重新點 Start Task；如果仍失敗，請在 Settings 把 browser_mode 改成 launch_google_chrome 測試獨立瀏覽器模式。",
          `First error: ${summarizeChromeConnectionError(firstMessage)}`,
          `Second error: ${summarizeChromeConnectionError(secondMessage)}`
        ].join("\n")
      );
    }
  }
}

async function ensureChromeRemoteDebuggingAvailable(endpoint: string, log: (message: string) => void): Promise<void> {
  if (await isChromeDebugEndpointAvailable(endpoint)) {
    return;
  }

  log(`Chrome remote debugging is not available at ${endpoint}; launching Google Chrome.`);
  await launchChromeRemoteDebugging(endpoint, log);
  await waitForChromeDebugEndpoint(endpoint, 15000);
}

async function connectToExistingChrome(endpoint: string): Promise<Browser> {
  try {
    return await chromium.connectOverCDP(endpoint);
  } catch (error) {
    throw new Error(
      [
        `Cannot connect to existing Google Chrome at ${endpoint}.`,
        "請先完全退出 Chrome，然後用 remote debugging 方式重新打開你平常使用的 Chrome：",
        "/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222",
        `Original error: ${normalizeError(error)}`
      ].join("\n")
    );
  }
}

async function launchChromeRemoteDebugging(endpoint: string, log: (message: string) => void): Promise<void> {
  const url = new URL(endpoint);
  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const port = url.port || "9222";
  const child = spawn(chromePath, [`--remote-debugging-port=${port}`], {
    detached: true,
    stdio: "ignore"
  });

  child.on("error", (error) => {
    log(`Google Chrome launch failed: ${normalizeError(error)}`);
  });
  child.unref();
  log(`Google Chrome launch requested with remote debugging port ${port}`);
}

async function openChromePageViaDevTools(endpoint: string, pageUrl: string, log: (message: string) => void): Promise<void> {
  const baseUrl = endpoint.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/json/new?${encodeURIComponent(pageUrl)}`, {
    method: "PUT"
  });

  if (!response.ok) {
    throw new Error(`Chrome DevTools could not open ${pageUrl}: HTTP ${response.status}`);
  }

  log(`Chrome page opened: ${pageUrl}`);
}

async function isChromeDebugEndpointAvailable(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForChromeDebugEndpoint(endpoint: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isChromeDebugEndpointAvailable(endpoint)) {
      return;
    }
    await sleep(500);
  }
}

function summarizeChromeConnectionError(message: string): string {
  const firstLine = message.split(/\r?\n/, 1)[0] ?? message;
  return firstLine.replace(/^Cannot connect to existing Google Chrome at .*?\.\s*/, "").trim();
}

async function focusChromePage(page: Page, log: (message: string) => void): Promise<void> {
  await page.bringToFront().catch(() => undefined);
  const child = spawn("osascript", ["-e", 'tell application "Google Chrome" to activate'], {
    detached: true,
    stdio: "ignore"
  });
  child.on("error", (error) => {
    log(`Google Chrome focus failed: ${normalizeError(error)}`);
  });
  child.unref();
  log("Google Chrome focused");
}

async function fillTaskInputs(
  distributionPage: DistributionPage,
  task: ResolvedTask,
  log: (message: string) => void,
  shouldStop?: () => boolean
): Promise<void> {
  await distributionPage.fillTokenContract(task.token_contract);
  await distributionPage.fillAmountPerAddress(task.amount_per_address);
  await distributionPage.fillRecipientCount(task.recipient_count);
  await distributionPage.clickGenerateRandomAddresses(task.recipient_count);
  await distributionPage.waitForGeneratedAddresses(task.recipient_count, {
    log: (message) => log(`[${task.task_title}] ${message}`),
    shouldStop
  });
}

function emptyExplorerVerification(): ExplorerVerification {
  return {
    token_balance_before: "",
    token_balance_after: "",
    token_balance_delta: "",
    holders_before: "",
    holders_after: "",
    holders_delta: "",
    holders_count_delta: "",
    holders_wait_status: "",
    explorer_check_status: "",
    explorer_check_error: "",
    explorer_check_attempts: 0
  };
}

async function getExplorerBeforeVerification(
  config: AirdropConfig,
  task: ResolvedTask,
  log: (message: string) => void
): Promise<ExplorerVerification> {
  const verification = emptyExplorerVerification();
  const explorerBaseUrl = config.explorer_base_url;

  if (!explorerBaseUrl) {
    return {
      ...verification,
      explorer_check_status: "failed",
      explorer_check_error: "Missing explorer_base_url in config"
    };
  }

  try {
    const [tokenBalanceBefore, holdersBefore] = await Promise.all([
      getTokenBalanceForAddress({
        explorerBaseUrl,
        walletAddress: config.wallet_address,
        tokenContract: task.token_contract
      }),
      getTokenHoldersCount(explorerBaseUrl, task.token_contract)
    ]);

    log(`[${task.task_title}] token balance before: ${tokenBalanceBefore}`);
    log(`[${task.task_title}] holders before: ${holdersBefore}`);
    return {
      ...verification,
      token_balance_before: tokenBalanceBefore,
      holders_before: String(holdersBefore)
    };
  } catch (error) {
    const message = normalizeError(error);
    log(`[${task.task_title}] explorer before check failed: ${message}`);
    return {
      ...verification,
      explorer_check_status: "failed",
      explorer_check_error: message
    };
  }
}

async function getExplorerAfterVerification(options: {
  config: AirdropConfig;
  task: ResolvedTask;
  current: ExplorerVerification;
  log: (message: string) => void;
  force?: boolean;
}): Promise<ExplorerVerification> {
  const retryCount = options.force ? 1 : options.config.explorer_retry_count ?? 6;
  const retryIntervalMs = options.force ? 0 : options.config.explorer_retry_interval_ms ?? 10000;
  const explorerBaseUrl = options.config.explorer_base_url;

  if (!explorerBaseUrl) {
    return {
      ...options.current,
      explorer_check_status: "failed",
      explorer_check_error: "Missing explorer_base_url in config"
    };
  }

  let latest = options.current;
  let lastError = "";

  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    options.log(`Explorer check attempt ${attempt}/${retryCount}`);
    await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));

    try {
      const [tokenBalanceAfter, holdersAfter] = await Promise.all([
        getTokenBalanceForAddress({
          explorerBaseUrl,
          walletAddress: options.config.wallet_address,
          tokenContract: options.task.token_contract
        }),
        getTokenHoldersCount(explorerBaseUrl, options.task.token_contract)
      ]);
      const holdersDelta = decimalSubtract(String(holdersAfter), options.current.holders_before || "0");

      latest = {
        ...options.current,
        token_balance_after: tokenBalanceAfter,
        holders_after: String(holdersAfter),
        token_balance_delta: decimalSubtract(tokenBalanceAfter, options.current.token_balance_before || "0"),
        holders_delta: holdersDelta,
        holders_count_delta: holdersDelta,
        explorer_check_attempts: attempt,
        explorer_check_error: ""
      };

      if (options.force) {
        return {
          ...latest,
          explorer_check_status: "token_success_holders_pending",
          explorer_check_error: appendError(latest.explorer_check_error, "Force end skipped long holders wait")
        };
      }

      if (isTokenSpendReached(options.task, options.current, latest)) {
        return await waitForHoldersChange({
          config: options.config,
          task: options.task,
          current: options.current,
          latest,
          explorerBaseUrl,
          log: options.log
        });
      }
    } catch (error) {
      lastError = normalizeError(error);
      latest = {
        ...latest,
        explorer_check_attempts: attempt,
        explorer_check_error: lastError
      };
    }
  }

  if (!latest.token_balance_after && !latest.holders_after) {
    return {
      ...latest,
      explorer_check_status: "failed",
      explorer_check_error: lastError || "Explorer after check failed"
    };
  }

  return {
    ...latest,
    explorer_check_status: "stale_or_no_change"
  };
}

function appendError(current: string, next: string): string {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  return `${current}; ${next}`;
}

function isTerminalTaskStatus(status: DashboardTaskStatus): boolean {
  return ["completed", "failed", "cancelled", "idle"].includes(status);
}

async function waitForReceiptGasTotal(options: {
  config: AirdropConfig;
  txHashes: string[];
  log: (message: string) => void;
}): Promise<string> {
  const attempts = 10;
  const intervalMs = 3000;
  let lastError = "";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const gasCost = await sumGasCostFromReceipts(
        options.config.rpc_url,
        options.txHashes,
        options.config.native_decimals
      );
      options.log(`Receipt gas calculation completed on attempt ${attempt}/${attempts}: ${gasCost}`);
      return gasCost;
    } catch (error) {
      lastError = normalizeError(error);
      options.log(`Receipt gas calculation attempt ${attempt}/${attempts} failed: ${lastError}`);
      await sleep(intervalMs);
    }
  }

  throw new Error(lastError || "Receipt gas calculation failed");
}

function preferredGasCost(balanceGasCost: string, receiptGasCost: string): string {
  if (balanceGasCost && new Decimal(balanceGasCost).gt(0)) {
    return balanceGasCost;
  }
  return receiptGasCost || balanceGasCost;
}

async function waitForHoldersChange(options: {
  config: AirdropConfig;
  task: ResolvedTask;
  current: ExplorerVerification;
  latest: ExplorerVerification;
  explorerBaseUrl: string;
  log: (message: string) => void;
}): Promise<ExplorerVerification> {
  if (!options.current.holders_before) {
    return {
      ...options.latest,
      holders_wait_status: "failed",
      explorer_check_status: "token_success_holders_pending",
      explorer_check_error: "holders_before is unavailable"
    };
  }

  const holdersBefore = Number(options.current.holders_before);
  const result = await waitForHoldersCountChange({
    explorerBaseUrl: options.explorerBaseUrl,
    tokenContract: options.task.token_contract,
    holdersBefore,
    intervalMs: options.config.explorer_holders_wait_interval_ms ?? DEFAULT_HOLDERS_WAIT_INTERVAL_MS,
    timeoutMs: options.config.explorer_holders_wait_timeout_ms ?? DEFAULT_HOLDERS_WAIT_TIMEOUT_MS,
    stableConfirmations: 2,
    logProgress: ({ attempt, holdersCount, holdersDelta }) => {
      options.log(`Explorer holders check attempt ${attempt}: holders_count=${holdersCount}, holders_delta=${holdersDelta}`);
    }
  });

  const holdersAfter = String(result.holdersCount);
  const holdersDelta = String(result.holdersDelta);
  return {
    ...options.latest,
    holders_after: holdersAfter,
    holders_delta: holdersDelta,
    holders_count_delta: holdersDelta,
    holders_wait_status: result.holdersWaitStatus,
    explorer_check_attempts: options.latest.explorer_check_attempts + result.attempts,
    explorer_check_status: result.holdersWaitStatus === "changed" ? "success" : "token_success_holders_pending",
    explorer_check_error: result.errorMessage
  };
}

function isTokenSpendReached(
  task: ResolvedTask,
  before: ExplorerVerification,
  after: ExplorerVerification
): boolean {
  if (!before.token_balance_before || !after.token_balance_after) {
    return false;
  }

  const tokenSpent = new Decimal(before.token_balance_before).minus(after.token_balance_after);
  return tokenSpent.gte(task.expected_total_airdrop_amount);
}

function buildReportRow(options: {
  config: AirdropConfig;
  sessionLabel: string;
  task: ResolvedTask;
  startedAt: Date;
  finishedAt: Date;
  status: SessionReportRow["status"];
  errorMessage: string;
  actualWalletConfirmCount: number;
  txHashes: string[];
  nativeBefore: string;
  nativeAfter: string;
  nativeGasCostByBalance: string;
  nativeGasCostByReceipt: string;
  gasPerRecipient: string;
  explorerVerification: ExplorerVerification;
  screenshotPaths: string[];
}): SessionReportRow {
  return {
    date: todayYmd(),
    session_label: options.sessionLabel,
    wallet_address: options.config.wallet_address,
    task_title: options.task.task_title,
    task_date: options.task.task_date,
    token_symbol: options.task.token_symbol,
    token_contract: options.task.token_contract,
    recipient_count: options.task.recipient_count,
    amount_per_address: options.task.amount_per_address,
    expected_total_airdrop_amount: options.task.expected_total_airdrop_amount,
    actual_wallet_confirm_count: options.actualWalletConfirmCount,
    tx_hashes: options.txHashes,
    tx_hash_count: options.txHashes.length,
    native_before: options.nativeBefore,
    native_after: options.nativeAfter,
    native_gas_cost_by_balance: options.nativeGasCostByBalance,
    native_gas_cost_by_receipt: options.nativeGasCostByReceipt,
    token_balance_before: options.explorerVerification.token_balance_before,
    token_balance_after: options.explorerVerification.token_balance_after,
    token_balance_delta: options.explorerVerification.token_balance_delta,
    holders_before: options.explorerVerification.holders_before,
    holders_after: options.explorerVerification.holders_after,
    holders_delta: options.explorerVerification.holders_delta,
    holders_count_delta: options.explorerVerification.holders_count_delta,
    holders_wait_status: options.explorerVerification.holders_wait_status,
    gas_per_recipient: options.gasPerRecipient,
    explorer_check_status: options.explorerVerification.explorer_check_status,
    explorer_check_error: options.explorerVerification.explorer_check_error,
    explorer_check_attempts: options.explorerVerification.explorer_check_attempts,
    status: options.status,
    error_message: options.errorMessage,
    started_at: options.startedAt.toISOString(),
    finished_at: options.finishedAt.toISOString(),
    screenshot_paths: options.screenshotPaths
  };
}

async function takeFailureScreenshot(page: Page, sessionLabel: string): Promise<string> {
  const screenshotPath = path.join(
    SCREENSHOTS_DIR,
    `${safeFilePart(sessionLabel)}_failed_${new Date().toISOString().replace(/[:.]/g, "-")}.png`
  );
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  return screenshotPath;
}
