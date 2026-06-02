import { Decimal } from "decimal.js";

type JsonRecord = Record<string, unknown>;

export type HoldersWaitStatus = "changed" | "timeout_no_change" | "failed";

export interface HoldersWaitResult {
  holdersCount: number;
  holdersDelta: number;
  holdersWaitStatus: HoldersWaitStatus;
  attempts: number;
  errorMessage: string;
}

export async function getAddressTokenBalances(options: {
  explorerBaseUrl: string;
  walletAddress: string;
}): Promise<unknown[]> {
  const payload = await blockscoutGet<unknown>(
    options.explorerBaseUrl,
    `/api/v2/addresses/${options.walletAddress}/token-balances`
  );

  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);
  if (Array.isArray(record.items)) {
    return record.items;
  }

  return [];
}

export async function getTokenBalanceForAddress(options: {
  explorerBaseUrl: string;
  walletAddress: string;
  tokenContract: string;
}): Promise<string> {
  const balances = await getAddressTokenBalances({
    explorerBaseUrl: options.explorerBaseUrl,
    walletAddress: options.walletAddress
  });
  const targetAddress = options.tokenContract.toLowerCase();

  for (const entry of balances) {
    const record = asRecord(entry);
    const token = asRecord(record.token);
    const address = firstString(
      token.address,
      token.address_hash,
      token.hash,
      record.address,
      record.address_hash,
      record.token_address,
      record.token_address_hash
    );

    if (!address || address.toLowerCase() !== targetAddress) {
      continue;
    }

    const balance = firstString(record.value, record.balance);
    if (!balance) {
      return "0";
    }

    const decimals = parseOptionalInteger(firstString(token.decimals, record.decimals));
    return normalizeTokenBalance(balance, decimals);
  }

  return "0";
}

export async function getTokenInfo(explorerBaseUrl: string, tokenContract: string): Promise<JsonRecord> {
  const payload = await blockscoutGet<unknown>(
    explorerBaseUrl,
    `/api/v2/tokens/${tokenContract}`
  );
  return asRecord(payload);
}

export async function getTokenHoldersCount(explorerBaseUrl: string, tokenContract: string): Promise<number> {
  const tokenInfo = await getTokenInfo(explorerBaseUrl, tokenContract);
  const value = firstString(
    tokenInfo.holders_count,
    tokenInfo.token_holders_count,
    tokenInfo.holders,
    tokenInfo.token_holders
  );

  if (!value) {
    throw new Error(`Token response missing holders_count for ${tokenContract}`);
  }

  const parsed = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid holders_count "${value}" for ${tokenContract}`);
  }

  return parsed;
}

export async function waitForHoldersCountChange(options: {
  explorerBaseUrl: string;
  tokenContract: string;
  holdersBefore: number;
  intervalMs: number;
  timeoutMs: number;
  stableConfirmations?: number;
  logProgress?: (result: { attempt: number; holdersCount: number; holdersDelta: number }) => void;
}): Promise<HoldersWaitResult> {
  const startedAt = Date.now();
  let attempts = 0;
  let lastHoldersCount = options.holdersBefore;
  let previousObservedHoldersCount = options.holdersBefore;
  let lastError = "";
  let changed = false;
  let stableCount = 0;
  const requiredStableConfirmations = options.stableConfirmations ?? 2;

  while (Date.now() - startedAt < options.timeoutMs) {
    attempts += 1;
    await delay(options.intervalMs);

    try {
      const holdersCount = await getTokenHoldersCount(options.explorerBaseUrl, options.tokenContract);
      const holdersDelta = holdersCount - options.holdersBefore;
      options.logProgress?.({ attempt: attempts, holdersCount, holdersDelta });

      if (holdersDelta !== 0) {
        stableCount = changed && holdersCount === previousObservedHoldersCount
          ? stableCount + 1
          : 1;
        changed = true;
        previousObservedHoldersCount = holdersCount;
        lastHoldersCount = holdersCount;

        if (stableCount >= requiredStableConfirmations) {
          return {
            holdersCount: lastHoldersCount,
            holdersDelta,
            holdersWaitStatus: "changed",
            attempts,
            errorMessage: ""
          };
        }

      } else {
        previousObservedHoldersCount = holdersCount;
        lastHoldersCount = holdersCount;
        stableCount = 0;
      }

      if (changed && requiredStableConfirmations <= 1) {
        return {
          holdersCount: lastHoldersCount,
          holdersDelta,
          holdersWaitStatus: "changed",
          attempts,
          errorMessage: ""
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    holdersCount: lastHoldersCount,
    holdersDelta: lastHoldersCount - options.holdersBefore,
    holdersWaitStatus: lastHoldersCount !== options.holdersBefore
      ? "changed"
      : lastError ? "failed" : "timeout_no_change",
    attempts,
    errorMessage: lastError
  };
}

async function blockscoutGet<T>(explorerBaseUrl: string, path: string): Promise<T> {
  const baseUrl = explorerBaseUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Blockscout API ${path} failed with HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

function normalizeTokenBalance(value: string, decimals: number | undefined): string {
  const normalized = value.replace(/,/g, "");

  if (/^0x[0-9a-f]+$/i.test(normalized)) {
    const integerValue = new Decimal(BigInt(normalized).toString());
    return decimals === undefined
      ? integerValue.toFixed()
      : integerValue.div(new Decimal(10).pow(decimals)).toFixed();
  }

  if (!/^\d+$/.test(normalized)) {
    return new Decimal(normalized || "0").toFixed();
  }

  const integerValue = new Decimal(normalized || "0");
  return decimals === undefined
    ? integerValue.toFixed()
    : integerValue.div(new Decimal(10).pow(decimals)).toFixed();
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
