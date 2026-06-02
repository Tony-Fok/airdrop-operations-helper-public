import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Decimal } from "decimal.js";

export const ROOT_DIR = process.cwd();
export const REPORTS_DIR = path.join(ROOT_DIR, "reports");
export const SCREENSHOTS_DIR = path.join(ROOT_DIR, "screenshots");
export const LOGS_DIR = path.join(ROOT_DIR, "logs");

export async function ensureRuntimeDirs(): Promise<void> {
  await Promise.all([
    mkdir(REPORTS_DIR, { recursive: true }),
    mkdir(SCREENSHOTS_DIR, { recursive: true }),
    mkdir(LOGS_DIR, { recursive: true })
  ]);
}

export function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

export function decimalSubtract(left: string, right: string): string {
  return new Decimal(left || "0").minus(new Decimal(right || "0")).toFixed();
}

export function normalizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\u001b\[[0-9;]*m/g, "");
}
