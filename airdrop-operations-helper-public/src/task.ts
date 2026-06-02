import { Decimal } from "decimal.js";
import type { AirdropConfig, ParsedTask, ResolvedTask, TokenConfig } from "./types.js";

export function parseTaskTitle(taskTitle: string): ParsedTask {
  const trimmed = taskTitle.trim();
  const match = /^(\d{4})_([A-Za-z][A-Za-z0-9]*)_(\d+)$/.exec(trimmed);

  if (!match) {
    throw new Error(
      [
        `Invalid task title: ${taskTitle}`,
        "Correct format: 日期_代幣_接收地址數",
        "Example: MMDD_TOKEN_A_20000"
      ].join("\n")
    );
  }

  const recipientCount = Number(match[3]);
  if (!Number.isSafeInteger(recipientCount) || recipientCount <= 0) {
    throw new Error(`recipient_count must be a positive integer in task title: ${taskTitle}`);
  }

  return {
    task_title: trimmed,
    task_date: match[1],
    token_symbol: match[2],
    recipient_count: recipientCount
  };
}

export function resolveTaskFromConfig(taskTitle: string, config: AirdropConfig): ResolvedTask {
  const parsed = parseTaskTitle(taskTitle);
  const tokenEntry = findTokenEntry(parsed.token_symbol, config.tokens ?? {});

  if (!tokenEntry) {
    const supported = Object.keys(config.tokens ?? {}).join(", ") || "(none configured)";
    throw new Error(
      [
        `Unsupported token_symbol: ${parsed.token_symbol}`,
        `Supported tokens: ${supported}`
      ].join("\n")
    );
  }

  const [resolvedSymbol, token] = tokenEntry;
  const expectedTotal = new Decimal(token.amount_per_address)
    .mul(new Decimal(parsed.recipient_count))
    .toFixed();

  return {
    ...parsed,
    token_symbol: resolvedSymbol,
    token_contract: token.contract,
    amount_per_address: token.amount_per_address,
    expected_total_airdrop_amount: expectedTotal
  };
}

function findTokenEntry(
  tokenSymbol: string,
  tokens: Record<string, TokenConfig>
): [string, TokenConfig] | undefined {
  const exact = tokens[tokenSymbol];
  if (exact) {
    return [tokenSymbol, exact];
  }

  const normalized = tokenSymbol.toLowerCase();
  return Object.entries(tokens).find(([symbol]) => symbol.toLowerCase() === normalized);
}

export function printResolvedTask(task: ResolvedTask): void {
  console.log("Task parsed:");
  console.log(`- task_title: ${task.task_title}`);
  console.log(`- task_date: ${task.task_date}`);
  console.log(`- token_symbol: ${task.token_symbol}`);
  console.log(`- token_contract: ${task.token_contract}`);
  console.log(`- recipient_count: ${task.recipient_count}`);
  console.log(`- amount_per_address: ${task.amount_per_address}`);
  console.log(`- expected_total_airdrop_amount: ${task.expected_total_airdrop_amount}`);
}
