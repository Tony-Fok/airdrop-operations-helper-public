export interface AirdropConfig {
  airdrop_page_url: string;
  rpc_url: string;
  explorer_base_url?: string;
  wallet_address: string;
  gas_token_symbol: string;
  native_decimals: number;
  headless: boolean;
  browser_mode?: "connect_existing_chrome" | "launch_google_chrome";
  chrome_debug_url?: string;
  auto_click_start_after_address_generated?: boolean;
  session_label?: string;
  explorer_retry_count?: number;
  explorer_retry_interval_ms?: number;
  explorer_holders_retry_count?: number;
  explorer_holders_retry_interval_ms?: number;
  explorer_holders_wait_timeout_ms?: number;
  explorer_holders_wait_interval_ms?: number;
  tokens?: Record<string, TokenConfig>;
}

export interface TokenConfig {
  contract: string;
  amount_per_address: string;
}

export interface ParsedTask {
  task_title: string;
  task_date: string;
  token_symbol: string;
  recipient_count: number;
}

export interface ResolvedTask extends ParsedTask {
  token_contract: string;
  amount_per_address: string;
  expected_total_airdrop_amount: string;
}

export type ExplorerCheckStatus = "success" | "failed" | "stale_or_no_change" | "token_success_holders_pending";
export type HoldersWaitStatus = "changed" | "timeout_no_change" | "failed" | "";

export interface ExplorerVerification {
  token_balance_before: string;
  token_balance_after: string;
  token_balance_delta: string;
  holders_before: string;
  holders_after: string;
  holders_delta: string;
  holders_count_delta: string;
  holders_wait_status: HoldersWaitStatus;
  explorer_check_status: ExplorerCheckStatus | "";
  explorer_check_error: string;
  explorer_check_attempts: number;
}

export interface WalletWatchResult {
  confirmedCount: number;
  failedCount: number;
  screenshots: string[];
}

export interface SessionReportRow {
  date: string;
  session_label: string;
  wallet_address: string;
  task_title?: string;
  task_date?: string;
  token_symbol?: string;
  token_contract?: string;
  recipient_count?: number | string;
  amount_per_address?: string;
  expected_total_airdrop_amount?: string;
  actual_wallet_confirm_count: number;
  tx_hashes: string[];
  tx_hash_count: number;
  native_before: string;
  native_after: string;
  native_gas_cost_by_balance: string;
  native_gas_cost_by_receipt: string;
  token_balance_before?: string;
  token_balance_after?: string;
  token_balance_delta?: string;
  holders_before?: string;
  holders_after?: string;
  holders_delta?: string;
  holders_count_delta?: string;
  holders_wait_status?: string;
  gas_per_recipient?: string;
  explorer_check_status?: string;
  explorer_check_error?: string;
  explorer_check_attempts?: number | string;
  status: "completed" | "failed";
  error_message: string;
  started_at: string;
  finished_at: string;
  screenshot_paths: string[];
}
