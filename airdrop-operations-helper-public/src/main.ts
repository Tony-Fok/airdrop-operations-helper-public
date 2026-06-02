import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { Decimal } from "decimal.js";
import { DistributionPage } from "./distributionPage.js";
import { getTokenBalanceForAddress, getTokenHoldersCount, waitForHoldersCountChange } from "./blockscout.js";
import { loadConfig } from "./config.js";
import { getNativeBalance } from "./gas.js";
import { appendSessionSummary } from "./logger.js";
import { printResolvedTask, resolveTaskFromConfig } from "./task.js";
import { watchWalletPopups } from "./walletWatcher.js";
import type {
  AirdropConfig,
  ExplorerVerification,
  ResolvedTask,
  SessionReportRow,
  WalletWatchResult
} from "./types.js";
import {
  decimalSubtract,
  ensureRuntimeDirs,
  normalizeError,
  ROOT_DIR,
  safeFilePart,
  SCREENSHOTS_DIR,
  sleep,
  todayYmd
} from "./utils.js";

const DEFAULT_HOLDERS_WAIT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_HOLDERS_WAIT_INTERVAL_MS = 15 * 1000;

async function main(): Promise<void> {
  await ensureRuntimeDirs();
  const config = await loadConfig();
  const rl = createInterface({ input, output });
  let resolvedTask = await promptResolvedTaskOrExit(rl, config);

  if (!resolvedTask) {
    console.log("Exit requested. Closing program.");
    rl.close();
    return;
  }

  const browserSession = await openBrowserSession(config);

  try {
    while (resolvedTask) {
      printResolvedTask(resolvedTask);
      await runAirdropTask({
        config,
        rl,
        browserSession,
        resolvedTask
      });

      resolvedTask = await promptResolvedTaskOrExit(rl, config);
    }

    console.log("Exit requested. Closing program.");
  } finally {
    await browserSession.page.close().catch(() => undefined);
    await browserSession.close();
    rl.close();
  }
}

async function runAirdropTask(options: {
  config: AirdropConfig;
  rl: ReturnType<typeof createInterface>;
  browserSession: {
    browser?: Browser;
    context: BrowserContext;
    page: Page;
    close: () => Promise<void>;
  };
  resolvedTask: ResolvedTask;
}): Promise<void> {
  const { config, rl, browserSession, resolvedTask } = options;
  const sessionLabel = resolvedTask.task_title || config.session_label || "manual_airdrop";
  const startedAt = new Date();
  const { browser, context, page } = browserSession;
  const distributionPage = new DistributionPage(page);
  const screenshotPaths: string[] = [];
  let stopWalletWatcher = false;
  let walletResult: WalletWatchResult = {
    confirmedCount: 0,
    failedCount: 0,
    screenshots: []
  };

  let status: SessionReportRow["status"] = "failed";
  let errorMessage = "";
  let nativeBefore = "";
  let nativeAfter = "";
  let nativeGasCostByBalance = "";
  const nativeGasCostByReceipt = "";
  const gasPerRecipient = "";
  let txHashes: string[] = [];
  let explorerVerification = emptyExplorerVerification();

  try {
    await page.goto(config.airdrop_page_url, { waitUntil: "domcontentloaded" });
    await fillTaskInputs(distributionPage, resolvedTask);

    nativeBefore = await getNativeBalance(config.rpc_url, config.wallet_address, config.native_decimals);
    console.log(`[${sessionLabel}] ${config.gas_token_symbol} before: ${nativeBefore}`);
    explorerVerification = await getExplorerBeforeVerification(config, resolvedTask);
    console.log(`[${sessionLabel}] 已自動填入 ERC20 代幣地址、每地址數量、接收地址數。請檢查頁面後手動開始空投。`);
    console.log(`[${sessionLabel}] 程序運行期間會自動處理 MetaMask 的 Next / Connect / Approve / Confirm 等彈窗。`);

    const walletWatchPromise = watchWalletPopups({
      browser,
      context,
      cdpEndpoint: config.chrome_debug_url ?? "http://127.0.0.1:9222",
      tokenSymbol: sessionLabel,
      shouldStop: () => stopWalletWatcher
    });

    await rl.question(`[${sessionLabel}] 本輪空投完成後，回到 terminal 按 Enter 結束監控並統計 Gas：`);
    stopWalletWatcher = true;
    walletResult = await walletWatchPromise;
    screenshotPaths.push(...walletResult.screenshots);

    txHashes = await distributionPage.extractTxHashesFromLogs();
    nativeAfter = await getNativeBalance(config.rpc_url, config.wallet_address, config.native_decimals);
    nativeGasCostByBalance = decimalSubtract(nativeBefore, nativeAfter);

    explorerVerification = await getExplorerAfterVerificationWithRetry({
      config,
      task: resolvedTask,
      current: explorerVerification
    });
    status = "completed";
    console.log(`[${sessionLabel}] MetaMask confirmations clicked: ${walletResult.confirmedCount}`);
    console.log(`[${sessionLabel}] ${config.gas_token_symbol} after: ${nativeAfter}`);
    console.log(`[${sessionLabel}] ${config.gas_token_symbol} gas total: ${nativeGasCostByBalance}`);
    printTaskSummary({
      task: resolvedTask,
      config,
      nativeBefore,
      nativeAfter,
      nativeGasCostByBalance,
      nativeGasCostByReceipt,
      gasPerRecipient,
      explorerVerification
    });
  } catch (error) {
    errorMessage = normalizeError(error);
    console.error(`[${sessionLabel}] failed: ${errorMessage}`);
    screenshotPaths.push(await takeFailureScreenshot(page, sessionLabel));

    if (!nativeAfter && nativeBefore) {
      try {
        nativeAfter = await getNativeBalance(config.rpc_url, config.wallet_address, config.native_decimals);
        nativeGasCostByBalance = decimalSubtract(nativeBefore, nativeAfter);
      } catch (balanceError) {
        errorMessage = `${errorMessage}; after-balance failed: ${normalizeError(balanceError)}`;
      }
    }
  } finally {
    stopWalletWatcher = true;

    const finishedAt = new Date();
    const reportPath = await appendSessionSummary(
      buildReportRow({
        config,
        sessionLabel,
        task: resolvedTask,
        startedAt,
        finishedAt,
        status,
        errorMessage,
        actualWalletConfirmCount: walletResult.confirmedCount,
        txHashes,
        nativeBefore,
        nativeAfter,
        nativeGasCostByBalance,
        nativeGasCostByReceipt,
        gasPerRecipient,
        explorerVerification,
        screenshotPaths
      })
    );

    console.log(`[${sessionLabel}] report appended: ${reportPath}`);
    console.log(`[${sessionLabel}] 本輪任務已結束。輸入下一輪 title 可繼續，或輸入 exit 關閉程序。`);
  }
}

async function openBrowserSession(config: AirdropConfig): Promise<{
  browser?: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}> {
  const browserMode = config.browser_mode ?? "connect_existing_chrome";

  if (browserMode === "connect_existing_chrome") {
    const browser = await connectToExistingChrome(config.chrome_debug_url ?? "http://127.0.0.1:9222");
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close();
      throw new Error("Connected to Chrome, but no browser context was found.");
    }

    const page = await context.newPage();
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

async function promptResolvedTaskOrExit(
  rl: ReturnType<typeof createInterface>,
  config: AirdropConfig
): Promise<ResolvedTask | null> {
  while (true) {
    const taskTitleInput = await rl.question("請輸入本輪任務 title，例如 MMDD_TOKEN_A_20000；輸入 exit 關閉程序：");
    const normalizedInput = taskTitleInput.trim();

    if (normalizedInput.toLowerCase() === "exit") {
      return null;
    }

    try {
      return resolveTaskFromConfig(normalizedInput, config);
    } catch (error) {
      console.error(normalizeError(error));
    }
  }
}

async function fillTaskInputs(distributionPage: DistributionPage, task: ResolvedTask): Promise<void> {
  await distributionPage.fillTokenContract(task.token_contract);
  await distributionPage.fillAmountPerAddress(task.amount_per_address);
  await distributionPage.fillRecipientCount(task.recipient_count);
  await distributionPage.clickGenerateRandomAddresses(task.recipient_count);
  await distributionPage.waitForGeneratedAddresses(task.recipient_count, {
    log: (message) => console.log(`[${task.task_title}] ${message}`)
  });
  console.log(`[${task.task_title}] auto-filled token contract: ${task.token_contract}`);
  console.log(`[${task.task_title}] auto-filled amount per address: ${task.amount_per_address}`);
  console.log(`[${task.task_title}] auto-filled recipient count: ${task.recipient_count}`);
  console.log(`[${task.task_title}] generated random recipient addresses`);
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
  task: ResolvedTask
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

    console.log(`[${task.task_title}] token balance before: ${tokenBalanceBefore}`);
    console.log(`[${task.task_title}] holders before: ${holdersBefore}`);
    return {
      ...verification,
      token_balance_before: tokenBalanceBefore,
      holders_before: String(holdersBefore)
    };
  } catch (error) {
    const message = normalizeError(error);
    console.error(`[${task.task_title}] explorer before check failed: ${message}`);
    return {
      ...verification,
      explorer_check_status: "failed",
      explorer_check_error: message
    };
  }
}

async function getExplorerAfterVerificationWithRetry(options: {
  config: AirdropConfig;
  task: ResolvedTask;
  current: ExplorerVerification;
}): Promise<ExplorerVerification> {
  const retryCount = options.config.explorer_retry_count ?? 6;
  const retryIntervalMs = options.config.explorer_retry_interval_ms ?? 10000;
  const explorerBaseUrl = options.config.explorer_base_url;

  if (!explorerBaseUrl) {
    return {
      ...options.current,
      explorer_check_status: "failed",
      explorer_check_error: appendError(options.current.explorer_check_error, "Missing explorer_base_url in config")
    };
  }

  if (options.current.explorer_check_status === "failed" && !options.current.token_balance_before && !options.current.holders_before) {
    return options.current;
  }

  let lastError = "";
  let latest = options.current;

  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    console.log(`Explorer check attempt ${attempt}/${retryCount}...`);
    await sleep(retryIntervalMs);

    try {
      const [tokenBalanceAfter, holdersAfter] = await Promise.all([
        getTokenBalanceForAddress({
          explorerBaseUrl,
          walletAddress: options.config.wallet_address,
          tokenContract: options.task.token_contract
        }),
        getTokenHoldersCount(explorerBaseUrl, options.task.token_contract)
      ]);

      latest = {
        ...options.current,
        token_balance_after: tokenBalanceAfter,
        holders_after: String(holdersAfter),
        token_balance_delta: decimalSubtract(tokenBalanceAfter, options.current.token_balance_before || "0"),
        holders_delta: decimalSubtract(String(holdersAfter), options.current.holders_before || "0"),
        holders_count_delta: decimalSubtract(String(holdersAfter), options.current.holders_before || "0"),
        explorer_check_attempts: attempt,
        explorer_check_error: ""
      };

      printExplorerRetryProgress(options.task, latest);

      if (isExplorerTargetReached(options.task, options.current, latest)) {
        return await waitForHoldersTarget({
          config: options.config,
          task: options.task,
          current: options.current,
          latest,
          explorerBaseUrl
        });
      }
    } catch (error) {
      lastError = normalizeError(error);
      latest = {
        ...latest,
        explorer_check_attempts: attempt,
        explorer_check_error: lastError
      };
      console.error(`[${options.task.task_title}] explorer check attempt ${attempt} failed: ${lastError}`);
    }
  }

  if (!latest.token_balance_after && !latest.holders_after) {
    console.log("Explorer check completed.");
    return {
      ...latest,
      explorer_check_status: "failed",
      explorer_check_error: appendError(options.current.explorer_check_error, lastError || "Explorer after check failed")
    };
  }

  console.log("Explorer check completed.");
  return {
    ...latest,
    explorer_check_status: "stale_or_no_change"
  };
}

async function waitForHoldersTarget(options: {
  config: AirdropConfig;
  task: ResolvedTask;
  current: ExplorerVerification;
  latest: ExplorerVerification;
  explorerBaseUrl: string;
}): Promise<ExplorerVerification> {
  if (!options.current.holders_before) {
    console.log("Explorer check completed; holders_before is unavailable.");
    return {
      ...options.latest,
      holders_wait_status: "failed",
      explorer_check_status: "token_success_holders_pending",
      explorer_check_error: appendError(options.latest.explorer_check_error, "holders_before is unavailable")
    };
  }

  const holdersBefore = Number(options.current.holders_before);
  const timeoutMs = options.config.explorer_holders_wait_timeout_ms ?? DEFAULT_HOLDERS_WAIT_TIMEOUT_MS;
  const intervalMs = options.config.explorer_holders_wait_interval_ms ?? DEFAULT_HOLDERS_WAIT_INTERVAL_MS;
  console.log(`[${options.task.task_title}] token balance reached expected spend. Waiting for holders_count change from Blockscout token API...`);

  const holdersResult = await waitForHoldersCountChange({
    explorerBaseUrl: options.explorerBaseUrl,
    tokenContract: options.task.token_contract,
    holdersBefore,
    intervalMs,
    timeoutMs,
    stableConfirmations: 2,
    logProgress: ({ attempt, holdersCount, holdersDelta }) => {
      console.log(
        `Explorer holders check attempt ${attempt}: holders_count=${holdersCount}, holders_delta=${holdersDelta}`
      );
    }
  });

  const holdersAfter = String(holdersResult.holdersCount);
  const holdersDelta = String(holdersResult.holdersDelta);
  console.log("Explorer check completed.");

  return {
    ...options.latest,
    holders_after: holdersAfter,
    holders_delta: holdersDelta,
    holders_count_delta: holdersDelta,
    holders_wait_status: holdersResult.holdersWaitStatus,
    explorer_check_attempts: options.latest.explorer_check_attempts + holdersResult.attempts,
    explorer_check_status: holdersResult.holdersWaitStatus === "changed" ? "success" : "token_success_holders_pending",
    explorer_check_error: appendError(options.latest.explorer_check_error, holdersResult.errorMessage)
  };
}

function isExplorerTargetReached(
  task: ResolvedTask,
  before: ExplorerVerification,
  after: ExplorerVerification
): boolean {
  if (!before.token_balance_before || !after.token_balance_after) {
    return false;
  }

  const tokenSpent = new Decimal(before.token_balance_before).minus(after.token_balance_after);
  const expectedSpent = new Decimal(task.expected_total_airdrop_amount);

  return tokenSpent.gte(expectedSpent);
}

function printExplorerRetryProgress(task: ResolvedTask, verification: ExplorerVerification): void {
  const expectedSpent = task.expected_total_airdrop_amount;
  const tokenSpent = verification.token_balance_delta
    ? new Decimal(verification.token_balance_delta).negated().toFixed()
    : "";

  console.log(
    [
      `Explorer progress:`,
      `token_spent=${tokenSpent || "unknown"}/${expectedSpent}`,
      `holders_delta=${verification.holders_delta || verification.holders_count_delta || "unknown"}`
    ].join(" ")
  );
}

function appendError(existing: string, next: string): string {
  return [existing, next].filter(Boolean).join("; ");
}

function printTaskSummary(options: {
  task: ResolvedTask;
  config: AirdropConfig;
  nativeBefore: string;
  nativeAfter: string;
  nativeGasCostByBalance: string;
  nativeGasCostByReceipt: string;
  gasPerRecipient: string;
  explorerVerification: ExplorerVerification;
}): void {
  console.log("Task summary:");
  console.log(`- task_title: ${options.task.task_title}`);
  console.log(`- token_symbol: ${options.task.token_symbol}`);
  console.log(`- token_contract: ${options.task.token_contract}`);
  console.log(`- recipient_count: ${options.task.recipient_count}`);
  console.log(`- amount_per_address: ${options.task.amount_per_address}`);
  console.log(`- expected_total_airdrop_amount: ${options.task.expected_total_airdrop_amount}`);
  console.log("");
  console.log("Gas:");
  console.log(`- native_before: ${options.nativeBefore}`);
  console.log(`- native_after: ${options.nativeAfter}`);
  console.log(`- native_gas_cost_total: ${options.nativeGasCostByBalance}`);
  console.log("");
  console.log("Explorer verification:");
  console.log(`- wallet_address: ${options.config.wallet_address}`);
  console.log(`- token_balance_before: ${options.explorerVerification.token_balance_before}`);
  console.log(`- token_balance_after: ${options.explorerVerification.token_balance_after}`);
  console.log(`- token_balance_delta: ${options.explorerVerification.token_balance_delta}`);
  console.log(`- holders_before: ${options.explorerVerification.holders_before}`);
  console.log(`- holders_after: ${options.explorerVerification.holders_after}`);
  console.log(`- holders_delta: ${options.explorerVerification.holders_delta || options.explorerVerification.holders_count_delta}`);
  console.log(`- holders_wait_status: ${options.explorerVerification.holders_wait_status}`);
  console.log(`- explorer_check_status: ${options.explorerVerification.explorer_check_status}`);
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

main().catch((error) => {
  console.error(error);
  console.error(`Project root: ${ROOT_DIR}`);
  process.exitCode = 1;
});
