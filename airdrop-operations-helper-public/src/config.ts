import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import type { AirdropConfig } from "./types.js";

const DEFAULT_CONFIG_PATH = "./airdrop_config.json";

export function getConfigPath(): string {
  return path.resolve(process.env.AIRDROP_CONFIG_PATH ?? DEFAULT_CONFIG_PATH);
}

export async function loadConfig(): Promise<AirdropConfig> {
  const configPath = getConfigPath();
  const raw = await readFile(configPath, "utf8");
  const config = JSON.parse(raw) as AirdropConfig;
  validateConfig(config, configPath);
  return config;
}

export async function saveConfig(config: AirdropConfig): Promise<AirdropConfig> {
  const configPath = getConfigPath();
  validateConfig(config, configPath);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

function validateConfig(config: AirdropConfig, configPath: string): void {
  const requiredStringFields: Array<keyof AirdropConfig> = [
    "airdrop_page_url",
    "rpc_url",
    "wallet_address"
  ];

  for (const field of requiredStringFields) {
    if (typeof config[field] !== "string" || !config[field]) {
      throw new Error(`Missing required config field "${field}" in ${configPath}`);
    }
  }

  if (!Number.isInteger(config.native_decimals) || config.native_decimals < 0) {
    throw new Error("native_decimals must be a non-negative integer");
  }

  if (
    config.browser_mode &&
    config.browser_mode !== "connect_existing_chrome" &&
    config.browser_mode !== "launch_google_chrome"
  ) {
    throw new Error('browser_mode must be "connect_existing_chrome" or "launch_google_chrome"');
  }

  if (
    config.auto_click_start_after_address_generated !== undefined &&
    typeof config.auto_click_start_after_address_generated !== "boolean"
  ) {
    throw new Error("auto_click_start_after_address_generated must be a boolean");
  }

  if (
    config.explorer_retry_count !== undefined &&
    (!Number.isInteger(config.explorer_retry_count) || config.explorer_retry_count < 1)
  ) {
    throw new Error("explorer_retry_count must be a positive integer");
  }

  if (
    config.explorer_retry_interval_ms !== undefined &&
    (!Number.isInteger(config.explorer_retry_interval_ms) || config.explorer_retry_interval_ms < 0)
  ) {
    throw new Error("explorer_retry_interval_ms must be a non-negative integer");
  }

  if (
    config.explorer_holders_retry_count !== undefined &&
    (!Number.isInteger(config.explorer_holders_retry_count) || config.explorer_holders_retry_count < 1)
  ) {
    throw new Error("explorer_holders_retry_count must be a positive integer");
  }

  if (
    config.explorer_holders_retry_interval_ms !== undefined &&
    (!Number.isInteger(config.explorer_holders_retry_interval_ms) || config.explorer_holders_retry_interval_ms < 0)
  ) {
    throw new Error("explorer_holders_retry_interval_ms must be a non-negative integer");
  }

  if (
    config.explorer_holders_wait_timeout_ms !== undefined &&
    (!Number.isInteger(config.explorer_holders_wait_timeout_ms) || config.explorer_holders_wait_timeout_ms < 1)
  ) {
    throw new Error("explorer_holders_wait_timeout_ms must be a positive integer");
  }

  if (
    config.explorer_holders_wait_interval_ms !== undefined &&
    (!Number.isInteger(config.explorer_holders_wait_interval_ms) || config.explorer_holders_wait_interval_ms < 1)
  ) {
    throw new Error("explorer_holders_wait_interval_ms must be a positive integer");
  }

  if (config.tokens) {
    for (const [symbol, token] of Object.entries(config.tokens)) {
      if (typeof token.contract !== "string" || !token.contract) {
        throw new Error(`Missing contract for token "${symbol}" in ${configPath}`);
      }

      if (typeof token.amount_per_address !== "string" || !token.amount_per_address) {
        throw new Error(`Missing amount_per_address for token "${symbol}" in ${configPath}`);
      }
    }
  }
}
