import type { Locator, Page } from "@playwright/test";

type FieldSelector = {
  labels: readonly string[];
  placeholders: readonly string[];
  css: readonly string[];
};

type ButtonSelector = {
  names: readonly string[];
  css: readonly string[];
};

type GeneratedAddressProgress = {
  count: number;
  source: string;
};

export type AirdropProgress = {
  txCount: number;
  hasCompletionText: boolean;
};

const ETHEREUM_ADDRESS_PATTERN = /0x[a-fA-F0-9]{40,64}/g;

export const PAGE_SELECTORS = {
  fields: {
    airdropContract: {
      labels: ["空投合約", "空投合約地址", "Airdrop Contract", "Airdrop contract address"],
      placeholders: ["空投合約", "空投合約地址", "Airdrop Contract", "Airdrop contract address"],
      css: [
        'input[name="airdropContract"]',
        'input[name="airdrop_contract"]',
        'input[data-testid="airdrop-contract"]'
      ]
    },
    tokenContract: {
      labels: ["ERC20 代幣地址", "ERC20代幣地址", "代幣地址", "Token Contract", "Token contract address"],
      placeholders: ["ERC20 代幣地址", "ERC20代幣地址", "代幣地址", "Token Contract", "Token contract address"],
      css: [
        'input[name="tokenContract"]',
        'input[name="token_contract"]',
        'input[data-testid="token-contract"]'
      ]
    },
    amountPerAddress: {
      labels: ["每個地址的數量", "每個地址數量", "每地址數量", "單地址數量", "代幣數量", "空投數量", "Amount per address"],
      placeholders: ["每個地址的數量", "每個地址數量", "每地址數量", "單地址數量", "代幣數量", "空投數量", "Amount per address"],
      css: [
        'input[name="amountPerAddress"]',
        'input[name="amount_per_address"]',
        'input[data-testid="amount-per-address"]'
      ]
    },
    recipientCount: {
      labels: ["接收地址數", "接收地址數量", "接受地址數", "接受地址數量", "地址數", "地址數量", "Recipient count"],
      placeholders: ["接收地址數", "接收地址數量", "接受地址數", "接受地址數量", "地址數", "地址數量", "Recipient count"],
      css: [
        'input[name="recipientCount"]',
        'input[name="recipient_count"]',
        'input[data-testid="recipient-count"]'
      ]
    }
  },
  buttons: {
    generateRandomAddresses: {
      names: ["生成", "生成隨機地址", "生成 N 個隨機地址", "Generate", "Generate random addresses"],
      css: ['button[data-testid="generate-addresses"]']
    },
    authorizeAndAirdrop: {
      names: [
        "授權並空投",
        "授权并空投",
        "授權并空投",
        "開始空投",
        "开始空投",
        "開始",
        "开始",
        "空投",
        "批量空投",
        "確認空投",
        "确认空投",
        "Start Airdrop",
        "Authorize and Airdrop",
        "Approve and Airdrop",
        "Airdrop",
        "Start",
        "Submit",
        "Send"
      ],
      css: [
        'button[data-testid="authorize-airdrop"]',
        'button[data-testid="start-airdrop"]',
        'button[type="submit"]',
        '[role="button"][data-testid="authorize-airdrop"]',
        '[role="button"][data-testid="start-airdrop"]'
      ]
    }
  },
  generatedAddressContainers: [
    'textarea[name="recipients"]',
    'textarea[data-testid="recipients"]',
    "textarea",
    '[role="textbox"]',
    '[contenteditable="true"]',
    '[class*="recipient" i]',
    '[class*="address" i]',
    '[id*="recipient" i]',
    '[id*="address" i]',
    "pre",
    "code",
    '[data-testid="generated-addresses"]',
    ".generated-addresses"
  ],
  logContainers: ['[data-testid="logs"]', '[data-testid="airdrop-logs"]', ".logs", ".airdrop-logs"],
  txHashPattern: /0x[a-fA-F0-9]{64}/g,
  completionTexts: ["完成", "成功", "全部完成", "airdrop finished", "completed", "success"]
} as const;

export class DistributionPage {
  constructor(private readonly page: Page) {}

  async fillAirdropContract(address: string): Promise<void> {
    await this.fillField(PAGE_SELECTORS.fields.airdropContract, address, "airdrop contract");
  }

  async fillTokenContract(tokenContract: string): Promise<void> {
    await this.fillField(PAGE_SELECTORS.fields.tokenContract, tokenContract, "token contract");
  }

  async fillAmountPerAddress(amount: string): Promise<void> {
    await this.fillField(PAGE_SELECTORS.fields.amountPerAddress, amount, "amount per address");
  }

  async fillRecipientCount(count: number): Promise<void> {
    await this.fillField(PAGE_SELECTORS.fields.recipientCount, String(count), "recipient count");
  }

  async clickGenerateRandomAddresses(count: number): Promise<void> {
    const button = await this.findButton(PAGE_SELECTORS.buttons.generateRandomAddresses);
    await button.click({ timeout: 0 });
    console.log(`Clicked generate random addresses for ${count} recipients.`);
  }

  async waitForGeneratedAddresses(
    expectedCount: number,
    options: { log?: (message: string) => void; pollIntervalMs?: number; shouldStop?: () => boolean } = {}
  ): Promise<void> {
    const pollIntervalMs = options.pollIntervalMs ?? 2000;
    let lastLoggedCount = -1;
    let lastLoggedAt = 0;

    while (true) {
      if (options.shouldStop?.()) {
        options.log?.("generated address wait stopped because task state changed");
        return;
      }

      const progress = await this.countGeneratedAddresses();
      if (progress.count >= expectedCount) {
        options.log?.(`generated addresses ready: ${progress.count}/${expectedCount} from ${progress.source}`);
        return;
      }

      const now = Date.now();
      if (progress.count !== lastLoggedCount || now - lastLoggedAt >= 15000) {
        options.log?.(`waiting for generated addresses: ${progress.count}/${expectedCount} from ${progress.source}`);
        lastLoggedCount = progress.count;
        lastLoggedAt = now;
      }

      await this.page.waitForTimeout(pollIntervalMs);
    }
  }

  async waitForAirdropProgressSinceBaseline(options: {
    baselineTxHashes: string[];
    timeoutMs?: number;
  }): Promise<void> {
    const baseline = [...new Set(options.baselineTxHashes)];
    await this.page.waitForFunction(
      ({ logSelectors, txPatternSource, completionTexts, baselineHashes }) => {
        const txPattern = new RegExp(txPatternSource, "g");
        const texts: string[] = [];

        for (const selector of logSelectors) {
          document.querySelectorAll(selector).forEach((element) => {
            texts.push(element.textContent ?? "");
          });
        }
        texts.push(document.body.innerText);

        const text = texts.join("\n");
        const txHashes = new Set(text.match(txPattern) ?? []);
        const baseline = new Set(baselineHashes);
        const hasNewTx = [...txHashes].some((hash) => !baseline.has(hash));
        const hasCompletionText = completionTexts.some((entry: string) =>
          text.toLowerCase().includes(entry.toLowerCase())
        );

        return hasNewTx || hasCompletionText;
      },
      {
        logSelectors: PAGE_SELECTORS.logContainers,
        txPatternSource: PAGE_SELECTORS.txHashPattern.source,
        completionTexts: PAGE_SELECTORS.completionTexts,
        baselineHashes: baseline
      },
      { timeout: options.timeoutMs ?? 1800000 }
    );
  }

  async clickAuthorizeAndAirdrop(
    log?: (message: string) => void,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {}
  ): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 180000;
    const pollIntervalMs = options.pollIntervalMs ?? 1000;
    const startedAt = Date.now();
    let lastLoggedAt = 0;

    while (Date.now() - startedAt < timeoutMs) {
      const button = await this.findClickableButton(PAGE_SELECTORS.buttons.authorizeAndAirdrop);
      if (button) {
        const label = await button.innerText().catch(() => "");
        log?.(`page airdrop button matched: ${label || "unnamed button"}`);
        await button.scrollIntoViewIfNeeded().catch(() => undefined);

        try {
          await button.click({ timeout: 15000 });
        } catch (error) {
          log?.(`page airdrop normal click failed; retrying with direct click: ${String(error)}`);
          await button.evaluate((element) => (element as HTMLElement).click(), { timeout: 15000 });
        }

        log?.("page airdrop button clicked");
        return;
      }

      const now = Date.now();
      if (now - lastLoggedAt >= 10000) {
        const labels = await this.visibleButtonLabels();
        log?.(`waiting for clickable page airdrop button; visible buttons: ${labels.join(" | ") || "none"}`);
        lastLoggedAt = now;
      }

      await this.page.waitForTimeout(pollIntervalMs);
    }

    const labels = await this.visibleButtonLabels();
    log?.(`page airdrop button click failed; visible buttons: ${labels.join(" | ") || "none"}`);
    throw new Error(`Could not click page authorize and airdrop button within ${Math.round(timeoutMs / 1000)}s.`);
  }

  async extractTxHashesFromLogs(): Promise<string[]> {
    const texts: string[] = [];

    for (const selector of PAGE_SELECTORS.logContainers) {
      const locators = await this.page.locator(selector).all();
      for (const locator of locators) {
        if (await locator.isVisible().catch(() => false)) {
          texts.push(await locator.innerText().catch(() => ""));
        }
      }
    }

    texts.push(await this.page.locator("body").innerText().catch(() => ""));
    const matches = texts.join("\n").match(PAGE_SELECTORS.txHashPattern) ?? [];
    return [...new Set(matches)];
  }

  async getAirdropProgress(): Promise<AirdropProgress> {
    return this.page.evaluate(
      ({ logSelectors, txPatternSource, completionTexts }) => {
        const txPattern = new RegExp(txPatternSource, "g");
        const texts: string[] = [];

        for (const selector of logSelectors) {
          document.querySelectorAll(selector).forEach((element) => {
            texts.push(element.textContent ?? "");
          });
        }
        texts.push(document.body.innerText);

        const text = texts.join("\n");
        const txCount = new Set(text.match(txPattern) ?? []).size;
        const hasCompletionText = completionTexts.some((entry: string) =>
          text.toLowerCase().includes(entry.toLowerCase())
        );

        return { txCount, hasCompletionText };
      },
      {
        logSelectors: PAGE_SELECTORS.logContainers,
        txPatternSource: PAGE_SELECTORS.txHashPattern.source,
        completionTexts: PAGE_SELECTORS.completionTexts
      }
    );
  }

  async waitForTokenAirdropFinished(
    expectedTxCount: number,
    timeoutMs = 1800000,
    options: { completionMinTxCount?: number } = {}
  ): Promise<void> {
    await this.page.waitForFunction(
      ({ logSelectors, txPatternSource, expected, completionTexts, completionMinTxCount }) => {
        const txPattern = new RegExp(txPatternSource, "g");
        const texts: string[] = [];

        for (const selector of logSelectors) {
          document.querySelectorAll(selector).forEach((element) => {
            texts.push(element.textContent ?? "");
          });
        }
        texts.push(document.body.innerText);

        const text = texts.join("\n");
        const txCount = new Set(text.match(txPattern) ?? []).size;
        const hasEnoughTx = txCount >= expected;
        const hasCompletionText = completionTexts.some((entry: string) =>
          text.toLowerCase().includes(entry.toLowerCase())
        );

        return hasEnoughTx || (hasCompletionText && txCount >= completionMinTxCount);
      },
      {
        logSelectors: PAGE_SELECTORS.logContainers,
        txPatternSource: PAGE_SELECTORS.txHashPattern.source,
        expected: expectedTxCount,
        completionTexts: PAGE_SELECTORS.completionTexts,
        completionMinTxCount: options.completionMinTxCount ?? expectedTxCount
      },
      { timeout: timeoutMs }
    );
  }

  private async fillField(selector: FieldSelector, value: string, fieldName: string): Promise<void> {
    const locator = await this.findField(selector, fieldName);
    await locator.fill(value);
  }

  private async findField(selector: FieldSelector, fieldName: string): Promise<Locator> {
    for (const label of selector.labels) {
      const locator = this.page.getByLabel(label, { exact: false }).first();
      if (await locator.isVisible().catch(() => false)) {
        return locator;
      }
    }

    for (const placeholder of selector.placeholders) {
      const locator = this.page.getByPlaceholder(placeholder, { exact: false }).first();
      if (await locator.isVisible().catch(() => false)) {
        return locator;
      }
    }

    for (const css of selector.css) {
      const locator = this.page.locator(css).first();
      if (await locator.isVisible().catch(() => false)) {
        return locator;
      }
    }

    for (const label of selector.labels) {
      const escaped = label.replace(/"/g, '\\"');
      const locator = this.page
        .locator(`xpath=//*[contains(normalize-space(.), "${escaped}")]/following::input[1]`)
        .first();
      if (await locator.isVisible().catch(() => false)) {
        return locator;
      }
    }

    throw new Error(`Could not find ${fieldName} input. Adjust PAGE_SELECTORS in src/distributionPage.ts.`);
  }

  private async findButton(selector: ButtonSelector): Promise<Locator> {
    for (const name of selector.names) {
      const button = this.page.getByRole("button", { name: new RegExp(escapeRegExp(name), "i") }).first();
      if (await button.isVisible().catch(() => false)) {
        return button;
      }
    }

    for (const name of selector.names) {
      const button = this.page.locator("button").filter({ hasText: name }).first();
      if (await button.isVisible().catch(() => false)) {
        return button;
      }
    }

    for (const css of selector.css) {
      const button = this.page.locator(css).first();
      if (await button.isVisible().catch(() => false)) {
        return button;
      }
    }

    throw new Error(`Could not find button. Adjust PAGE_SELECTORS in src/distributionPage.ts.`);
  }

  private async findClickableButton(selector: ButtonSelector): Promise<Locator | null> {
    const candidates = await this.findButtonCandidates(selector);
    for (const button of candidates) {
      if (
        (await button.isVisible().catch(() => false)) &&
        (await button.isEnabled().catch(() => false))
      ) {
        return button;
      }
    }
    return null;
  }

  private async findButtonCandidates(selector: ButtonSelector): Promise<Locator[]> {
    const candidates: Locator[] = [];

    for (const name of selector.names) {
      candidates.push(this.page.getByRole("button", { name: new RegExp(escapeRegExp(name), "i") }).first());
    }

    for (const name of selector.names) {
      candidates.push(this.page.locator("button").filter({ hasText: name }).first());
    }

    for (const css of selector.css) {
      candidates.push(this.page.locator(css).first());
    }

    return candidates;
  }

  private async visibleButtonLabels(): Promise<string[]> {
    const labels: string[] = [];
    const buttons = await this.page.locator("button, [role='button']").all();
    for (const button of buttons) {
      if (!(await button.isVisible().catch(() => false))) {
        continue;
      }
      const text = (await button.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const ariaLabel = (await button.getAttribute("aria-label").catch(() => ""))?.trim() ?? "";
      const label = text || ariaLabel;
      if (label) {
        labels.push(label);
      }
    }
    return labels.slice(0, 30);
  }

  private async countGeneratedAddresses(): Promise<GeneratedAddressProgress> {
    return this.page.evaluate(
      ({ selectors, addressPatternSource }) => {
        const addressPattern = new RegExp(addressPatternSource, "g");
        let best = { count: 0, source: "none" };

        for (const selector of selectors) {
          const elements = Array.from(document.querySelectorAll(selector));
          for (const element of elements) {
            const text = "value" in element
              ? String((element as HTMLTextAreaElement | HTMLInputElement).value)
              : element.textContent ?? "";
            const count = (text.match(addressPattern) ?? []).filter((match) => match.length === 42).length;
            if (count > best.count) {
              best = { count, source: selector };
            }
          }
        }

        const bodyCount = (document.body.innerText.match(addressPattern) ?? [])
          .filter((match) => match.length === 42)
          .length;
        if (bodyCount > best.count) {
          best = { count: bodyCount, source: "body" };
        }

        return best;
      },
      {
        selectors: PAGE_SELECTORS.generatedAddressContainers,
        addressPatternSource: ETHEREUM_ADDRESS_PATTERN.source
      }
    );
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
