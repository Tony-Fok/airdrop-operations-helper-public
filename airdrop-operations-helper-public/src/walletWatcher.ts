import path from "node:path";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import type { WalletWatchResult } from "./types.js";
import { randomInt, safeFilePart, SCREENSHOTS_DIR, sleep } from "./utils.js";

const WALLET_BUTTON_TEXTS = [
  "Confirm",
  "確認",
  "确认",
  "Approve",
  "批准",
  "Sign",
  "簽名",
  "签名",
  "Connect",
  "連接",
  "连接",
  "Next",
  "下一步",
  "允許",
  "允许"
];

const FINAL_CONFIRM_TEXTS = [
  "Confirm",
  "確認",
  "确认",
  "Approve",
  "批准",
  "Sign",
  "簽名",
  "签名",
  "Connect",
  "連接",
  "连接",
  "允許",
  "允许"
];
const STEP_TEXTS = ["Next", "下一步"];
const METAMASK_BUTTON_SELECTORS = [
  { label: "Next", selector: '[data-testid="page-container-footer-next"]' },
  { label: "Connect", selector: '[data-testid="page-container-footer-connect"]' },
  { label: "Approve", selector: '[data-testid="page-container-footer-approve"]' },
  { label: "Confirm", selector: '[data-testid="page-container-footer-confirm"]' },
  { label: "Confirm", selector: '[data-testid="confirm-footer-button"]' },
  { label: "Confirm", selector: '[data-testid="confirm-btn"]' },
  { label: "Confirm", selector: '[data-testid="confirmation-submit-button"]' },
  { label: "Sign", selector: '[data-testid="request-signature__sign"]' },
  { label: "Sign", selector: '[data-testid="signature-request-sign-button"]' },
  { label: "Sign", selector: '[data-testid="confirm-signature-request"]' },
  { label: "Sign", selector: '[data-testid="eth-sign-button"]' },
  { label: "Confirm", selector: '[data-testid="mm-primary-button"]' },
  { label: "Confirm", selector: ".page-container__footer-button" },
  { label: "Confirm", selector: ".btn-primary" }
];

interface ChromeTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

export async function watchAndConfirmWalletPopups(options: {
  context: BrowserContext;
  expectedConfirmCount: number;
  timeoutMs: number;
  tokenSymbol: string;
}): Promise<WalletWatchResult> {
  let confirmedCount = 0;
  return watchWalletPopups({
    context: options.context,
    tokenSymbol: options.tokenSymbol,
    shouldStop: () => confirmedCount >= options.expectedConfirmCount,
    timeoutMs: options.timeoutMs,
    expectedConfirmCount: options.expectedConfirmCount,
    onConfirmed: (count) => {
      confirmedCount = count;
    }
  });
}

export async function watchWalletPopups(options: {
  context: BrowserContext;
  browser?: Browser;
  cdpEndpoint?: string;
  tokenSymbol: string;
  shouldStop: () => boolean;
  timeoutMs?: number;
  expectedConfirmCount?: number;
  onConfirmed?: (confirmedCount: number) => void;
  onAction?: (label: string, confirmedCount: number) => void;
  onPageDetected?: (url: string) => void;
  log?: (message: string) => void;
}): Promise<WalletWatchResult> {
  const startedAt = Date.now();
  const watchedContexts = new Set<BrowserContext>();
  const baselinePages = new Set<Page>();
  const popupPages = new Set<Page>();
  const loggedPages = new Set<Page>();
  const loggedTargets = new Set<string>();
  const screenshots: string[] = [];
  let confirmedCount = 0;
  let failedCount = 0;

  const allContexts = (): BrowserContext[] => {
    const contexts = [options.context, ...(options.browser?.contexts() ?? [])];
    return [...new Set(contexts)];
  };

  const attachContext = (context: BrowserContext): void => {
    if (watchedContexts.has(context)) {
      return;
    }

    watchedContexts.add(context);
    context.pages().forEach((page) => baselinePages.add(page));
    context.backgroundPages().forEach((page) => baselinePages.add(page));
    context.on("page", onPage);
    context.on("backgroundpage", onPage);
  };

  const watchablePages = (): Page[] => {
    allContexts().forEach(attachContext);

    const pages = allContexts().flatMap((context) => [
      ...context.pages(),
      ...context.backgroundPages()
    ]);

    return [...new Set(pages)].filter((page) => isWatchableWalletPage(page, baselinePages, popupPages));
  };

  const onPage = (page: Page): void => {
    popupPages.add(page);
  };

  allContexts().forEach(attachContext);

  try {
    while (!options.shouldStop()) {
      if (options.timeoutMs && Date.now() - startedAt > options.timeoutMs) {
        failedCount = options.expectedConfirmCount
          ? Math.max(options.expectedConfirmCount - confirmedCount, 0)
          : 1;
        const timeoutShot = await screenshotAllPages(
          watchablePages(),
          `${safeFilePart(options.tokenSymbol)}_wallet_timeout`,
          screenshots
        );
        screenshots.push(...timeoutShot);
        break;
      }

      const pages = watchablePages();
      let clicked = false;

      for (const page of pages) {
        if (page.isClosed()) {
          continue;
        }

        if (!loggedPages.has(page)) {
          loggedPages.add(page);
          options.onPageDetected?.(page.url());
          emitLog(options, `[${options.tokenSymbol}] wallet page detected: ${page.url()}`);
        }

        const result = await clickWalletButton(page);
        if (!result) {
          continue;
        }

        if (STEP_TEXTS.includes(result)) {
          options.onAction?.(result, confirmedCount);
          emitLog(options, `[${options.tokenSymbol}] wallet step clicked: ${result} at ${new Date().toISOString()}`);
        } else {
          confirmedCount += 1;
          options.onConfirmed?.(confirmedCount);
          options.onAction?.(result, confirmedCount);
          emitLog(
            options,
            options.expectedConfirmCount
              ? `[${options.tokenSymbol}] wallet confirm ${confirmedCount}/${options.expectedConfirmCount} clicked: ${result} at ${new Date().toISOString()}`
              : `[${options.tokenSymbol}] wallet confirm ${confirmedCount} clicked: ${result} at ${new Date().toISOString()}`
          );
        }

        clicked = true;
        await sleep(randomInt(1000, 3000));
        break;
      }

      if (!clicked && options.cdpEndpoint) {
        const cdpResult = await clickWalletButtonViaCdp(
          options.cdpEndpoint,
          loggedTargets,
          options.log,
          options.onPageDetected
        );
        if (cdpResult) {
          if (STEP_TEXTS.includes(cdpResult)) {
            options.onAction?.(cdpResult, confirmedCount);
            emitLog(options, `[${options.tokenSymbol}] wallet step clicked by CDP: ${cdpResult} at ${new Date().toISOString()}`);
          } else {
            confirmedCount += 1;
            options.onConfirmed?.(confirmedCount);
            options.onAction?.(cdpResult, confirmedCount);
            emitLog(
              options,
              options.expectedConfirmCount
                ? `[${options.tokenSymbol}] wallet confirm ${confirmedCount}/${options.expectedConfirmCount} clicked by CDP: ${cdpResult} at ${new Date().toISOString()}`
                : `[${options.tokenSymbol}] wallet confirm ${confirmedCount} clicked by CDP: ${cdpResult} at ${new Date().toISOString()}`
            );
          }

          clicked = true;
          await sleep(randomInt(1000, 3000));
        }
      }

      if (!clicked) {
        await sleep(500);
      }
    }
  } finally {
    for (const context of watchedContexts) {
      context.off("page", onPage);
      context.off("backgroundpage", onPage);
    }
  }

  return {
    confirmedCount,
    failedCount,
    screenshots
  };
}

function emitLog(options: { log?: (message: string) => void }, message: string): void {
  if (options.log) {
    options.log(message);
    return;
  }
  console.log(message);
}

function isWatchableWalletPage(page: Page, baselinePages: Set<Page>, popupPages: Set<Page>): boolean {
  if (page.isClosed()) {
    return false;
  }

  return popupPages.has(page) || !baselinePages.has(page) || looksLikeWalletPage(page);
}

function looksLikeWalletPage(page: Page): boolean {
  const url = page.url().toLowerCase();
  return (
    url.startsWith("chrome-extension://") ||
    url.startsWith("moz-extension://") ||
    url.includes("metamask") ||
    url.includes("notification.html") ||
    url.includes("home.html") ||
    url.includes("popup.html") ||
    url.includes("rabby") ||
    url.includes("okx") ||
    url.includes("wallet")
  );
}

async function clickWalletButton(page: Page): Promise<string | null> {
  await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => undefined);

  for (const { label, selector } of METAMASK_BUTTON_SELECTORS) {
    const button = page.locator(selector).last();
    if (await canClick(button)) {
      await button.click({ timeout: 5000 });
      return label;
    }
  }

  for (const text of [...FINAL_CONFIRM_TEXTS, ...WALLET_BUTTON_TEXTS]) {
    const button = page.getByRole("button", { name: new RegExp(escapeRegExp(text), "i") }).first();
    if (await canClick(button)) {
      await button.click({ timeout: 5000 });
      return text;
    }
  }

  for (const text of [...FINAL_CONFIRM_TEXTS, ...WALLET_BUTTON_TEXTS]) {
    const button = page.locator("button").filter({ hasText: text }).first();
    if (await canClick(button)) {
      await button.click({ timeout: 5000 });
      return text;
    }
  }

  return null;
}

async function clickWalletButtonViaCdp(
  endpoint: string,
  loggedTargets: Set<string>,
  log?: (message: string) => void,
  onPageDetected?: (url: string) => void
): Promise<string | null> {
  const targets = await listChromeTargets(endpoint).catch(() => []);
  const walletTargets = targets.filter((target) => isWalletTarget(target));

  for (const target of walletTargets) {
    if (!loggedTargets.has(target.id)) {
      loggedTargets.add(target.id);
      onPageDetected?.(target.url || target.title);
      if (log) {
        log(`[wallet-cdp] target detected: ${target.type} ${target.url || target.title}`);
      } else {
        console.log(`[wallet-cdp] target detected: ${target.type} ${target.url || target.title}`);
      }
    }

    if (!target.webSocketDebuggerUrl) {
      continue;
    }

    const clicked = await evaluateClickInTarget(target.webSocketDebuggerUrl).catch(() => null);
    if (clicked) {
      return clicked;
    }
  }

  return null;
}

async function listChromeTargets(endpoint: string): Promise<ChromeTarget[]> {
  const baseUrl = endpoint.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/json/list`);
  if (!response.ok) {
    throw new Error(`Chrome target list failed with HTTP ${response.status}`);
  }
  return (await response.json()) as ChromeTarget[];
}

function isWalletTarget(target: ChromeTarget): boolean {
  const value = `${target.type} ${target.title} ${target.url}`.toLowerCase();
  return (
    target.type === "page" &&
    (value.includes("chrome-extension://") ||
      value.includes("metamask") ||
      value.includes("notification.html") ||
      value.includes("home.html") ||
      value.includes("popup.html") ||
      value.includes("wallet"))
  );
}

async function evaluateClickInTarget(wsUrl: string): Promise<string | null> {
  const result = await sendCdpCommand<{ result?: { value?: string | null } }>(wsUrl, "Runtime.evaluate", {
    expression: buildClickExpression(),
    awaitPromise: false,
    returnByValue: true
  });

  return result.result?.value ?? null;
}

function sendCdpCommand<T>(wsUrl: string, method: string, params: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = 1;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`CDP command ${method} timed out`));
    }, 5000);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id, method, params }));
    });

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: T; error?: { message: string } };
      if (message.id !== id) {
        return;
      }

      clearTimeout(timeout);
      ws.close();

      if (message.error) {
        reject(new Error(message.error.message));
        return;
      }

      resolve(message.result as T);
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`CDP websocket failed for ${wsUrl}`));
    });
  });
}

function buildClickExpression(): string {
  return `(() => {
    const selectorEntries = ${JSON.stringify(METAMASK_BUTTON_SELECTORS)};
    const textEntries = ${JSON.stringify([...FINAL_CONFIRM_TEXTS, ...WALLET_BUTTON_TEXTS])};
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const disabled = element.disabled || element.getAttribute("aria-disabled") === "true";
      return !disabled && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    for (const entry of selectorEntries) {
      const elements = Array.from(document.querySelectorAll(entry.selector)).filter(isVisible);
      const element = elements[elements.length - 1];
      if (element) {
        element.click();
        return entry.label;
      }
    }
    const candidates = Array.from(document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')).filter(isVisible);
    for (const text of textEntries) {
      const lowerText = String(text).toLowerCase();
      const element = candidates.find((candidate) => {
        const value = [
          candidate.textContent,
          candidate.getAttribute("aria-label"),
          candidate.getAttribute("title"),
          candidate.value
        ].filter(Boolean).join(" ").toLowerCase();
        return value.includes(lowerText);
      });
      if (element) {
        element.click();
        return text;
      }
    }
    return null;
  })()`;
}

async function canClick(locator: Locator): Promise<boolean> {
  return (await locator.isVisible().catch(() => false)) && (await locator.isEnabled().catch(() => false));
}

async function screenshotAllPages(pages: Page[], namePrefix: string, existing: string[]): Promise<string[]> {
  const paths: string[] = [];

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (page.isClosed()) {
      continue;
    }

    const screenshotPath = path.join(SCREENSHOTS_DIR, `${namePrefix}_${existing.length + index + 1}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    paths.push(screenshotPath);
  }

  return paths;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
