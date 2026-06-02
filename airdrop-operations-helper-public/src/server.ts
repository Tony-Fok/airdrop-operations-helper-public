import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { loadConfig, saveConfig } from "./config.js";
import { DashboardTaskRunner } from "./dashboardTaskRunner.js";
import { readTaskHistory } from "./historyStore.js";
import { readIntegratedTaskHistory } from "./integratedHistoryStore.js";
import { IntegratedTaskRunner } from "./integratedTaskRunner.js";
import { resolveTaskFromConfig } from "./task.js";
import type { AirdropConfig, TokenConfig } from "./types.js";
import { normalizeError, ROOT_DIR } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dashboardDistDir = path.resolve(__dirname, "../dashboard/dist");
const runner = new DashboardTaskRunner();
const integratedRunner = new IntegratedTaskRunner(runner);

const app = Fastify({
  logger: true
});

app.get("/api/health", async () => ({
  ok: true,
  service: "airdrop-operations-helper-dashboard"
}));

app.get("/api/settings", async () => {
  const config = await loadConfig();
  return {
    config,
    tokens: config.tokens ?? {}
  };
});

app.get("/api/tokens", async () => {
  const config = await loadConfig();
  return config.tokens ?? {};
});

app.post<{ Body: SettingsUpdateBody }>("/api/settings", async (request, reply) => {
  try {
    const current = await loadConfig();
    const next = applySettingsUpdate(current, request.body ?? {});
    const saved = await saveConfig(next);
    return {
      config: saved,
      tokens: saved.tokens ?? {}
    };
  } catch (error) {
    return reply.code(400).send({ error: normalizeError(error) });
  }
});

app.post<{ Body: { taskTitle?: string } }>("/api/task/parse", async (request, reply) => {
  try {
    const config = await loadConfig();
    const task = resolveTaskFromConfig(request.body.taskTitle ?? "", config);
    runner.parseTask(task.task_title, config);
    return { task };
  } catch (error) {
    return reply.code(400).send({ error: normalizeError(error) });
  }
});

app.post<{ Body: TaskStartRequestBody }>("/api/task/start", async (request, reply) => {
  try {
    const config = await loadConfig();
    const snapshot = await runner.startTask(request.body.taskTitle ?? "", config, {
      autoClickAirdropPage: request.body.autoClickAirdropPage ?? config.auto_click_start_after_address_generated ?? true
    });
    return snapshot;
  } catch (error) {
    return reply.code(400).send({ error: normalizeError(error), snapshot: runner.getSnapshot() });
  }
});

app.post("/api/task/end", async (_request, reply) => {
  try {
    return await runner.settleTask({ force: true });
  } catch (error) {
    return reply.code(400).send({ error: normalizeError(error), snapshot: runner.getSnapshot() });
  }
});

app.post("/api/task/force-end", async (_request, reply) => {
  try {
    return await runner.settleTask({ force: true });
  } catch (error) {
    return reply.code(400).send({ error: normalizeError(error), snapshot: runner.getSnapshot() });
  }
});

app.post("/api/task/cancel", async (_request, reply) => {
  try {
    return await runner.cancelTask();
  } catch (error) {
    return reply.code(400).send({ error: normalizeError(error), snapshot: runner.getSnapshot() });
  }
});

app.get("/api/task/status", async () => runner.getSnapshot());

app.post<{ Body: IntegratedTaskRequestBody }>("/api/integrated-task/parse", async (request, reply) => {
  try {
    const config = await loadConfig();
    const subtasks = integratedRunner.parseQueue(request.body.taskTitles ?? [], config);
    return { subtasks };
  } catch (error) {
    return reply.code(400).send({ error: normalizeError(error) });
  }
});

app.post<{ Body: IntegratedTaskRequestBody }>("/api/integrated-task/start", async (request, reply) => {
  try {
    const config = await loadConfig();
    return integratedRunner.startQueue({
      queueTitle: request.body.queueTitle,
      taskTitles: request.body.taskTitles ?? [],
      config,
      autoClickAirdropPage: request.body.autoClickAirdropPage ?? config.auto_click_start_after_address_generated ?? true
    });
  } catch (error) {
    return reply.code(400).send({ error: normalizeError(error), snapshot: integratedRunner.getSnapshot() });
  }
});

app.post("/api/integrated-task/cancel", async (_request, reply) => {
  try {
    return await integratedRunner.cancelQueue();
  } catch (error) {
    return reply.code(400).send({ error: normalizeError(error), snapshot: integratedRunner.getSnapshot() });
  }
});

app.post("/api/integrated-task/force-end", async (_request, reply) => {
  try {
    return await integratedRunner.forceEndQueue();
  } catch (error) {
    return reply.code(400).send({ error: normalizeError(error), snapshot: integratedRunner.getSnapshot() });
  }
});

app.get("/api/integrated-task/status", async () => integratedRunner.getSnapshot());

app.get<{ Querystring: { limit?: string } }>("/api/history", async (request) => {
  const limit = Number(request.query.limit ?? "200");
  return {
    rows: await readTaskHistory(Number.isFinite(limit) ? limit : 200)
  };
});

app.get<{ Querystring: { limit?: string } }>("/api/integrated-history", async (request) => {
  const limit = Number(request.query.limit ?? "200");
  return {
    rows: await readIntegratedTaskHistory(Number.isFinite(limit) ? limit : 200)
  };
});

if (existsSync(dashboardDistDir)) {
  await app.register(fastifyStatic, {
    root: dashboardDistDir,
    prefix: "/"
  });

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.sendFile("index.html");
  });
}

const port = Number(process.env.DASHBOARD_API_PORT ?? "3001");
const host = process.env.DASHBOARD_API_HOST ?? "127.0.0.1";

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  app.log.error(`Project root: ${ROOT_DIR}`);
  process.exitCode = 1;
});

type EditableConfigField =
  | "wallet_address"
  | "browser_mode"
  | "chrome_debug_url"
  | "auto_click_start_after_address_generated"
  | "explorer_base_url"
  | "explorer_retry_count"
  | "explorer_retry_interval_ms"
  | "explorer_holders_wait_interval_ms"
  | "explorer_holders_wait_timeout_ms";

type SettingsUpdateBody = {
  config?: Partial<Record<EditableConfigField, string | number | boolean>>;
  tokens?: Record<string, TokenConfig>;
};

type TaskStartRequestBody = {
  taskTitle?: string;
  autoClickAirdropPage?: boolean;
};

type IntegratedTaskRequestBody = {
  queueTitle?: string;
  taskTitles?: string[];
  autoClickAirdropPage?: boolean;
};

const editableConfigFields: EditableConfigField[] = [
  "wallet_address",
  "browser_mode",
  "chrome_debug_url",
  "auto_click_start_after_address_generated",
  "explorer_base_url",
  "explorer_retry_count",
  "explorer_retry_interval_ms",
  "explorer_holders_wait_interval_ms",
  "explorer_holders_wait_timeout_ms"
];

const numericConfigFields = new Set<EditableConfigField>([
  "explorer_retry_count",
  "explorer_retry_interval_ms",
  "explorer_holders_wait_interval_ms",
  "explorer_holders_wait_timeout_ms"
]);

const booleanConfigFields = new Set<EditableConfigField>([
  "auto_click_start_after_address_generated"
]);

function applySettingsUpdate(current: AirdropConfig, update: SettingsUpdateBody): AirdropConfig {
  const next: AirdropConfig = {
    ...current,
    tokens: current.tokens ? { ...current.tokens } : {}
  };

  if (update.config) {
    for (const field of editableConfigFields) {
      if (!(field in update.config)) {
        continue;
      }

      const value = update.config[field];
      if (numericConfigFields.has(field)) {
        const numericValue = Number(value);
        if (!Number.isInteger(numericValue) || numericValue < 0) {
          throw new Error(`${field} must be a non-negative integer`);
        }
        next[field] = numericValue as never;
      } else if (booleanConfigFields.has(field)) {
        next[field] = parseBooleanConfigValue(field, value) as never;
      } else {
        const stringValue = String(value ?? "").trim();
        if (field === "browser_mode" && stringValue !== "connect_existing_chrome" && stringValue !== "launch_google_chrome") {
          throw new Error('browser_mode must be "connect_existing_chrome" or "launch_google_chrome"');
        }
        next[field] = stringValue as never;
      }
    }
  }

  if (update.tokens) {
    next.tokens = normalizeTokens(update.tokens);
  }

  return next;
}

function parseBooleanConfigValue(field: string, value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off", ""].includes(normalized)) {
    return false;
  }

  throw new Error(`${field} must be a boolean`);
}

function normalizeTokens(tokens: Record<string, TokenConfig>): Record<string, TokenConfig> {
  const next: Record<string, TokenConfig> = {};
  const seenSymbols = new Set<string>();

  for (const [rawSymbol, rawToken] of Object.entries(tokens)) {
    const symbol = rawSymbol.trim();
    const contract = rawToken.contract.trim();
    const amountPerAddress = rawToken.amount_per_address.trim();

    if (!symbol) {
      throw new Error("Token symbol cannot be empty");
    }

    if (!/^[A-Za-z0-9_]+$/.test(symbol)) {
      throw new Error(`Token symbol "${symbol}" can only contain letters, numbers, and underscores`);
    }

    if (seenSymbols.has(symbol)) {
      throw new Error(`Duplicate token symbol "${symbol}"`);
    }
    seenSymbols.add(symbol);

    if (!/^0x[a-fA-F0-9]{40}$/.test(contract)) {
      throw new Error(`Token "${symbol}" contract must be a valid EVM address`);
    }

    if (!/^\d+(\.\d+)?$/.test(amountPerAddress) || Number(amountPerAddress) <= 0) {
      throw new Error(`Token "${symbol}" amount_per_address must be a positive decimal string`);
    }

    next[symbol] = {
      contract,
      amount_per_address: amountPerAddress
    };
  }

  return next;
}
