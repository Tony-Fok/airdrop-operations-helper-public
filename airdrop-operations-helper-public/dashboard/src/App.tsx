import { useEffect, useState } from "react";

type Tab = "home" | "integrated" | "settings" | "history";
type Theme = "light" | "dark";
type Language = "bilingual" | "zh-TW" | "en";

interface ResolvedTask {
  task_title: string;
  task_date: string;
  token_symbol: string;
  token_contract: string;
  recipient_count: number;
  amount_per_address: string;
  expected_total_airdrop_amount: string;
}

interface ExplorerVerification {
  token_balance_before: string;
  token_balance_after: string;
  token_balance_delta: string;
  holders_before: string;
  holders_after: string;
  holders_delta: string;
  holders_wait_status: string;
  explorer_check_status: string;
  explorer_check_error: string;
  explorer_check_attempts: number;
}

interface TaskSnapshot {
  status: string;
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

interface IntegratedSubTaskSnapshot {
  index: number;
  status: string;
  task: ResolvedTask;
  started_at: string;
  finished_at: string;
  report_path: string;
  wallet_confirmations: number;
  tx_hash_count: number;
  native_before: string;
  native_after: string;
  native_gas_cost_total: string;
  token_balance_after: string;
  token_balance_delta: string;
  holders_after: string;
  holders_delta: string;
  explorer_check_status: string;
  error_message: string;
}

interface IntegratedTaskSnapshot {
  queue_id: string;
  status: string;
  queue_title: string;
  current_index: number;
  total_count: number;
  current_task: ResolvedTask | null;
  started_at: string;
  finished_at: string;
  error_message: string;
  subtasks: IntegratedSubTaskSnapshot[];
  active_task_snapshot: TaskSnapshot | null;
  logs: string[];
}

interface IntegratedHistoryEntry {
  queue_id: string;
  date: string;
  queue_title: string;
  status: string;
  total_count: number;
  completed_count: number;
  failed_count: number;
  skipped_count: number;
  started_at: string;
  finished_at: string;
  error_message: string;
  subtasks: IntegratedSubTaskSnapshot[];
}

interface SettingsResponse {
  config: Record<string, unknown>;
  tokens: Record<string, { contract: string; amount_per_address: string }>;
}

interface RuntimeSettingsDraft {
  wallet_address: string;
  browser_mode: string;
  chrome_debug_url: string;
  auto_click_start_after_address_generated: string;
  explorer_base_url: string;
  explorer_retry_count: string;
  explorer_retry_interval_ms: string;
  explorer_holders_wait_interval_ms: string;
  explorer_holders_wait_timeout_ms: string;
}

interface TokenDraft {
  id: string;
  symbol: string;
  contract: string;
  amount_per_address: string;
}

interface IntegratedDraftRow {
  id: string;
  token_symbol: string;
  recipient_count: string;
}

type HistoryRow = Record<string, string>;

type ApiError = Error & { payload?: { snapshot?: TaskSnapshot } };

const INTEGRATED_DRAFT_STORAGE_KEY = "integrated_task_draft_rows";

const labels: Record<string, { zh: string; en: string }> = {
  home: { zh: "首頁", en: "Home" },
  integrated: { zh: "集成任務", en: "Integrated Task" },
  settings: { zh: "設定", en: "Settings" },
  history: { zh: "歷史", en: "History" },
  logs: { zh: "日誌", en: "Logs" },
  local_dashboard: { zh: "本地儀表板", en: "Local dashboard" },
  task_input: { zh: "任務輸入", en: "Task Input" },
  task_date_select: { zh: "任務日期", en: "Task Date" },
  token_select: { zh: "空投代幣", en: "Airdrop Token" },
  recipient_count_input: { zh: "接收地址數", en: "Recipient Count" },
  generated_task_title: { zh: "生成任務 Title", en: "Generated Task Title" },
  parse_task: { zh: "解析任務", en: "Parse Task" },
  start_task: { zh: "開始任務", en: "Start Task" },
  end_task: { zh: "結束任務並結算", en: "End and Settle" },
  cancel_task: { zh: "取消任務", en: "Cancel Task" },
  queue_title: { zh: "隊列名稱", en: "Queue Title" },
  add_subtask: { zh: "新增子任務", en: "Add Sub Task" },
  parse_queue: { zh: "解析隊列", en: "Parse Queue" },
  start_queue: { zh: "開始集成任務", en: "Start Queue" },
  force_end_queue: { zh: "結束集成任務並立即結算", en: "End Queue and Settle Now" },
  cancel_queue: { zh: "取消集成任務", en: "Cancel Queue" },
  auto_click_airdrop_page: { zh: "自動點擊頁面授權並空投", en: "Auto Click Page Airdrop" },
  sub_tasks: { zh: "子任務", en: "Sub Tasks" },
  current_task: { zh: "當前任務", en: "Current Task" },
  refresh_status: { zh: "刷新狀態", en: "Refresh Status" },
  task_summary: { zh: "任務摘要", en: "Task Summary" },
  runtime_monitor: { zh: "執行監控", en: "Runtime Monitor" },
  gas: { zh: "Gas 統計", en: "Gas" },
  explorer_verification: { zh: "Explorer 驗證", en: "Explorer Verification" },
  runtime_settings: { zh: "執行設定", en: "Runtime Settings" },
  token_registry: { zh: "Token 註冊表", en: "Token Registry" },
  refresh: { zh: "重新整理", en: "Refresh" },
  history_view: { zh: "視察內容", en: "View" },
  history_date: { zh: "日期篩選", en: "Date Filter" },
  all_dates: { zh: "全部日期", en: "All Dates" },
  single_task_history: { zh: "單任務", en: "Single Tasks" },
  integrated_task_history: { zh: "集成任務", en: "Integrated Tasks" },
  integrated_runs: { zh: "集成任務批次", en: "Integrated Runs" },
  run_detail: { zh: "批次子任務", en: "Run Detail" },
  save_settings: { zh: "保存設定", en: "Save Settings" },
  add_token: { zh: "新增 Token", en: "Add Token" },
  remove: { zh: "移除", en: "Remove" },
  symbol: { zh: "代幣", en: "Symbol" },
  contract: { zh: "合約地址", en: "Contract" },
  amount_per_address: { zh: "每地址數量", en: "Amount Per Address" },
  task: { zh: "任務", en: "Task" },
  date: { zh: "日期", en: "Date" },
  token: { zh: "代幣", en: "Token" },
  recipients: { zh: "接收地址數", en: "Recipients" },
  expected: { zh: "預計總量", en: "Expected" },
  token_balance_after: { zh: "完成後代幣餘額", en: "Token Balance After" },
  holders_before: { zh: "Holders 前", en: "Holders Before" },
  holders_after: { zh: "Holders 後", en: "Holders After" },
  holders_total_after: { zh: "任務完成後持幣者總數", en: "Holders Total After" },
  holders_delta: { zh: "Holders 變化", en: "Holders Delta" },
  holders_wait_status: { zh: "Holders 等待狀態", en: "Holders Wait Status" },
  status: { zh: "狀態", en: "Status" },
  theme_light: { zh: "日間", en: "Light" },
  theme_dark: { zh: "夜間", en: "Dark" },
  language: { zh: "語言", en: "Language" },
  bilingual: { zh: "中英雙語", en: "Bilingual" },
  traditional_chinese: { zh: "繁體中文", en: "Traditional Chinese" },
  english: { zh: "英文", en: "English" },
  saved: { zh: "已保存", en: "Saved" },
  edit_warning: { zh: "保存後會更新 airdrop_config.json，下一輪任務會使用新設定。", en: "Saving updates airdrop_config.json and the next task uses the new settings." },
  end_requested: { zh: "已提交結束結算請求，會跳過長時間 holders 等待並盡快寫入報表。", en: "End requested. Long holders wait is skipped and the report will be written as soon as possible." },
  cancel_requested: { zh: "任務已取消，沒有寫入統計報表。", en: "Task cancelled. No report was written." },
  settling: { zh: "正在結算，請稍候。", en: "Settling. Please wait." },
  task_completed: { zh: "任務已完成，報表已寫入。", en: "Task completed and report appended." },
  status_refreshed: { zh: "狀態已刷新", en: "Status refreshed" },
  queue_started: { zh: "集成任務已開始，請在空投頁檢查後點擊授權 / 並空投。", en: "Queue started. Check the airdrop page, then click authorize and airdrop." },
  queue_force_ended: { zh: "集成任務已結束並立即結算。", en: "Integrated task ended and settled." },
  queue_cancelled: { zh: "集成任務已取消。", en: "Integrated task cancelled." }
};

const emptySnapshot: TaskSnapshot = {
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

const emptyIntegratedSnapshot: IntegratedTaskSnapshot = {
  queue_id: "",
  status: "idle",
  queue_title: "",
  current_index: 0,
  total_count: 0,
  current_task: null,
  started_at: "",
  finished_at: "",
  error_message: "",
  subtasks: [],
  active_task_snapshot: null,
  logs: []
};

export function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("dashboard_theme") as Theme) || "light");
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem("dashboard_language") as Language) || "bilingual");
  const [taskDateInput, setTaskDateInput] = useState(defaultDateInput());
  const [tokenSymbol, setTokenSymbol] = useState("TOKEN_A");
  const [recipientCountInput, setRecipientCountInput] = useState("20000");
  const [taskTitle, setTaskTitle] = useState(buildTaskTitle(defaultDateInput(), "TOKEN_A", "20000"));
  const [autoClickSingleTaskAirdropPage, setAutoClickSingleTaskAirdropPage] = useState(true);
  const [parsedTask, setParsedTask] = useState<ResolvedTask | null>(null);
  const [snapshot, setSnapshot] = useState<TaskSnapshot>(emptySnapshot);
  const [integratedSnapshot, setIntegratedSnapshot] = useState<IntegratedTaskSnapshot>(emptyIntegratedSnapshot);
  const [parsedIntegratedSubtasks, setParsedIntegratedSubtasks] = useState<IntegratedSubTaskSnapshot[]>([]);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [integratedHistory, setIntegratedHistory] = useState<IntegratedHistoryEntry[]>([]);
  const [message, setMessage] = useState("");
  const [integratedMessage, setIntegratedMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refreshStatus();
    refreshIntegratedStatus();
    refreshSettings();
    refreshHistory();
    refreshIntegratedHistory();
    const timer = window.setInterval(() => {
      void refreshStatusQuietly();
      void refreshIntegratedStatusQuietly();
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("dashboard_theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("dashboard_language", language);
  }, [language]);

  useEffect(() => {
    const tokenSymbols = Object.keys(settings?.tokens ?? {});
    if (tokenSymbols.length > 0 && !tokenSymbols.includes(tokenSymbol)) {
      setTokenSymbol(tokenSymbols.includes("TOKEN_A") ? "TOKEN_A" : tokenSymbols[0]);
    }
  }, [settings, tokenSymbol]);

  useEffect(() => {
    if (settings?.config.auto_click_start_after_address_generated !== undefined) {
      setAutoClickSingleTaskAirdropPage(settings.config.auto_click_start_after_address_generated === true);
    }
  }, [settings]);

  useEffect(() => {
    setTaskTitle(buildTaskTitle(taskDateInput, tokenSymbol, recipientCountInput));
  }, [taskDateInput, tokenSymbol, recipientCountInput]);

  useEffect(() => {
    if (snapshot.status === "completed" || snapshot.status === "failed") {
      void refreshHistory();
    }
  }, [snapshot.status, snapshot.report_path]);

  useEffect(() => {
    if (["completed", "failed", "cancelled"].includes(integratedSnapshot.status)) {
      void refreshIntegratedHistory();
      void refreshHistory();
    }
  }, [integratedSnapshot.status, integratedSnapshot.finished_at]);

  const t = (key: string) => formatLabel(key, language);

  async function api<T>(url: string, options?: RequestInit): Promise<T> {
    const headers: HeadersInit = options?.body ? { "content-type": "application/json" } : {};
    const response = await fetch(url, {
      headers,
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error ?? `Request failed: ${response.status}`) as ApiError;
      error.payload = payload;
      throw error;
    }
    return payload as T;
  }

  async function refreshStatus() {
    const next = await api<TaskSnapshot>("/api/task/status");
    setSnapshot(next);
  }

  async function refreshIntegratedStatus() {
    const next = await api<IntegratedTaskSnapshot>("/api/integrated-task/status");
    setIntegratedSnapshot(next);
    if (next.subtasks.length > 0) {
      setParsedIntegratedSubtasks(next.subtasks);
    }
  }

  async function refreshStatusQuietly() {
    try {
      await refreshStatus();
    } catch {
      // Keep polling non-blocking; the manual refresh button reports errors.
    }
  }

  async function refreshIntegratedStatusQuietly() {
    try {
      await refreshIntegratedStatus();
    } catch {
      // Keep polling non-blocking; direct actions report errors.
    }
  }

  async function refreshStatusFromButton() {
    setBusy(true);
    setMessage("");
    try {
      await refreshStatus();
      setMessage(t("status_refreshed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function refreshSettings() {
    const next = await api<SettingsResponse>("/api/settings");
    setSettings(next);
  }

  async function refreshHistory() {
    const next = await api<{ rows: HistoryRow[] }>("/api/history?limit=10000");
    setHistory(next.rows);
  }

  async function refreshIntegratedHistory() {
    const next = await api<{ rows: IntegratedHistoryEntry[] }>("/api/integrated-history?limit=10000");
    setIntegratedHistory(next.rows);
  }

  async function waitForTerminalStatus(timeoutMs = 30000): Promise<TaskSnapshot> {
    const startedAt = Date.now();
    let latest = snapshot;

    while (Date.now() - startedAt < timeoutMs) {
      await sleep(1000);
      latest = await api<TaskSnapshot>("/api/task/status");
      setSnapshot(latest);
      if (latest.task) {
        setParsedTask(latest.task);
      }

      if (["completed", "failed", "cancelled", "idle"].includes(latest.status)) {
        return latest;
      }
    }

    return latest;
  }

  function applyErrorSnapshot(error: unknown) {
    const payload = (error as ApiError).payload;
    if (payload?.snapshot) {
      setSnapshot(payload.snapshot);
      setParsedTask(payload.snapshot.task);
    }
  }

  function applyIntegratedErrorSnapshot(error: unknown) {
    const payload = (error as ApiError).payload as { snapshot?: IntegratedTaskSnapshot } | undefined;
    if (payload?.snapshot) {
      setIntegratedSnapshot(payload.snapshot);
      setParsedIntegratedSubtasks(payload.snapshot.subtasks);
    }
  }

  async function parseTask() {
    setBusy(true);
    setMessage("");
    const currentTaskTitle = buildTaskTitle(taskDateInput, tokenSymbol, recipientCountInput);
    setTaskTitle(currentTaskTitle);
    try {
      const result = await api<{ task: ResolvedTask }>("/api/task/parse", {
        method: "POST",
        body: JSON.stringify({ taskTitle: currentTaskTitle })
      });
      setParsedTask(result.task);
      setMessage("Task parsed.");
      await refreshStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function startTask() {
    setBusy(true);
    setMessage("");
    const currentTaskTitle = buildTaskTitle(taskDateInput, tokenSymbol, recipientCountInput);
    setTaskTitle(currentTaskTitle);
    try {
      const next = await api<TaskSnapshot>("/api/task/start", {
        method: "POST",
        body: JSON.stringify({ taskTitle: currentTaskTitle, autoClickAirdropPage: autoClickSingleTaskAirdropPage })
      });
      setSnapshot(next);
      setParsedTask(next.task);
      setMessage(
        autoClickSingleTaskAirdropPage
          ? "Task started. The page airdrop button will be clicked after generated addresses are ready."
          : "Task started. Check the airdrop page, then start the airdrop manually."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      await refreshStatusQuietly();
    } finally {
      setBusy(false);
    }
  }

  async function endTask() {
    setBusy(true);
    setMessage(t("end_requested"));
    try {
      const next = await api<TaskSnapshot>("/api/task/end", {
        method: "POST",
        body: JSON.stringify({})
      });
      setSnapshot(next);
      setParsedTask(next.task);
      const settled = next.status === "completed" ? next : await waitForTerminalStatus();
      setSnapshot(settled);
      setParsedTask(settled.task);
      setMessage(settled.status === "completed" ? t("task_completed") : t("settling"));
      if (settled.status === "completed") {
        await refreshHistory();
      }
    } catch (error) {
      applyErrorSnapshot(error);
      setMessage(error instanceof Error ? error.message : String(error));
      await refreshStatusQuietly();
    } finally {
      setBusy(false);
    }
  }

  async function cancelTask() {
    if (!window.confirm("Cancel current task without writing a report?")) {
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const next = await api<TaskSnapshot>("/api/task/cancel", {
        method: "POST",
        body: JSON.stringify({})
      });
      setSnapshot(next);
      setParsedTask(next.task);
      setMessage(t("cancel_requested"));
    } catch (error) {
      applyErrorSnapshot(error);
      setMessage(error instanceof Error ? error.message : String(error));
      await refreshStatusQuietly();
    } finally {
      setBusy(false);
    }
  }

  async function parseIntegratedQueue(taskTitles: string[]) {
    setBusy(true);
    setIntegratedMessage("");
    try {
      const result = await api<{ subtasks: IntegratedSubTaskSnapshot[] }>("/api/integrated-task/parse", {
        method: "POST",
        body: JSON.stringify({ taskTitles })
      });
      setParsedIntegratedSubtasks(result.subtasks);
      setIntegratedMessage("Queue parsed.");
      await refreshIntegratedStatusQuietly();
    } catch (error) {
      setIntegratedMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function startIntegratedQueue(queueTitle: string, taskTitles: string[], autoClickAirdropPage: boolean) {
    setBusy(true);
    setIntegratedMessage("");
    try {
      const next = await api<IntegratedTaskSnapshot>("/api/integrated-task/start", {
        method: "POST",
        body: JSON.stringify({ queueTitle, taskTitles, autoClickAirdropPage })
      });
      setIntegratedSnapshot(next);
      setParsedIntegratedSubtasks(next.subtasks);
      setIntegratedMessage(t("queue_started"));
    } catch (error) {
      applyIntegratedErrorSnapshot(error);
      setIntegratedMessage(error instanceof Error ? error.message : String(error));
      await refreshIntegratedStatusQuietly();
    } finally {
      setBusy(false);
    }
  }

  async function cancelIntegratedQueue() {
    if (!window.confirm("Cancel current integrated task?")) {
      return;
    }

    setBusy(true);
    setIntegratedMessage("");
    try {
      const next = await api<IntegratedTaskSnapshot>("/api/integrated-task/cancel", {
        method: "POST",
        body: JSON.stringify({})
      });
      setIntegratedSnapshot(next);
      setParsedIntegratedSubtasks(next.subtasks);
      setIntegratedMessage(t("queue_cancelled"));
    } catch (error) {
      applyIntegratedErrorSnapshot(error);
      setIntegratedMessage(error instanceof Error ? error.message : String(error));
      await refreshIntegratedStatusQuietly();
    } finally {
      setBusy(false);
    }
  }

  async function forceEndIntegratedQueue() {
    if (!window.confirm("End the current integrated task and settle immediately? Remaining sub tasks will be skipped.")) {
      return;
    }

    setBusy(true);
    setIntegratedMessage("");
    try {
      const next = await api<IntegratedTaskSnapshot>("/api/integrated-task/force-end", {
        method: "POST",
        body: JSON.stringify({})
      });
      setIntegratedSnapshot(next);
      setParsedIntegratedSubtasks(next.subtasks);
      setIntegratedMessage(t("queue_force_ended"));
      await refreshIntegratedHistory();
      await refreshHistory();
    } catch (error) {
      applyIntegratedErrorSnapshot(error);
      setIntegratedMessage(error instanceof Error ? error.message : String(error));
      await refreshIntegratedStatusQuietly();
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(payload: { config: RuntimeSettingsDraft; tokens: Record<string, { contract: string; amount_per_address: string }> }) {
    setBusy(true);
    setMessage("");
    try {
      const next = await api<SettingsResponse>("/api/settings", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setSettings(next);
      setMessage(t("saved"));
      await refreshStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <h1>Anubis Airdrop Helper</h1>
          <p>{t("local_dashboard")}</p>
        </div>
        <nav>
          {(["home", "integrated", "settings", "history"] as Tab[]).map((item) => (
            <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
              {t(item)}
            </button>
          ))}
        </nav>
        <div className="toolbar-stack">
          <label>
            {t("language")}
            <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
              <option value="bilingual">{t("bilingual")}</option>
              <option value="zh-TW">{t("traditional_chinese")}</option>
              <option value="en">{t("english")}</option>
            </select>
          </label>
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? t("theme_light") : t("theme_dark")}
          </button>
        </div>
      </aside>

      <section className="workspace">
        {tab === "home" && (
          <Home
            taskTitle={taskTitle}
            taskDateInput={taskDateInput}
            setTaskDateInput={setTaskDateInput}
            tokenSymbol={tokenSymbol}
            setTokenSymbol={setTokenSymbol}
            recipientCountInput={recipientCountInput}
            setRecipientCountInput={setRecipientCountInput}
            autoClickAirdropPage={autoClickSingleTaskAirdropPage}
            setAutoClickAirdropPage={setAutoClickSingleTaskAirdropPage}
            tokenOptions={Object.keys(settings?.tokens ?? {})}
            parsedTask={parsedTask}
            snapshot={snapshot}
            message={message}
            busy={busy}
            onParse={parseTask}
            onStart={startTask}
            onEnd={endTask}
            onCancel={cancelTask}
            onRefreshStatus={refreshStatusFromButton}
            onRefreshHistory={refreshHistory}
            t={t}
          />
        )}
        {tab === "integrated" && (
          <IntegratedTasks
            tokenOptions={Object.keys(settings?.tokens ?? {})}
            snapshot={integratedSnapshot}
            parsedSubtasks={parsedIntegratedSubtasks}
            message={integratedMessage}
            autoClickDefault={settings?.config.auto_click_start_after_address_generated !== false}
            busy={busy}
            onParse={parseIntegratedQueue}
            onStart={startIntegratedQueue}
            onForceEnd={forceEndIntegratedQueue}
            onCancel={cancelIntegratedQueue}
            t={t}
          />
        )}
        {tab === "settings" && <Settings settings={settings} busy={busy} onRefresh={refreshSettings} onSave={saveSettings} t={t} />}
        {tab === "history" && (
          <History
            rows={history}
            integratedRows={integratedHistory}
            onRefresh={async () => {
              await refreshHistory();
              await refreshIntegratedHistory();
            }}
            t={t}
          />
        )}
      </section>
    </main>
  );
}

function Home(props: {
  taskTitle: string;
  taskDateInput: string;
  setTaskDateInput: (value: string) => void;
  tokenSymbol: string;
  setTokenSymbol: (value: string) => void;
  recipientCountInput: string;
  setRecipientCountInput: (value: string) => void;
  autoClickAirdropPage: boolean;
  setAutoClickAirdropPage: (value: boolean) => void;
  tokenOptions: string[];
  parsedTask: ResolvedTask | null;
  snapshot: TaskSnapshot;
  message: string;
  busy: boolean;
  onParse: () => void;
  onStart: () => void;
  onEnd: () => void;
  onCancel: () => void;
  onRefreshStatus: () => void;
  onRefreshHistory: () => void;
  t: (key: string) => string;
}) {
  const task = props.parsedTask ?? props.snapshot.task;
  const explorer = props.snapshot.explorer_verification;

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <h2>{props.t("home")}</h2>
        </div>
        <div className="task-form-grid">
          <label className="field-stack">
            <span>{props.t("task_date_select")}</span>
            <input type="date" value={props.taskDateInput} onChange={(event) => props.setTaskDateInput(event.target.value)} />
          </label>
          <label className="field-stack">
            <span>{props.t("token_select")}</span>
            <select value={props.tokenSymbol} onChange={(event) => props.setTokenSymbol(event.target.value)}>
              {props.tokenOptions.map((symbol) => (
                <option key={symbol} value={symbol}>{symbol}</option>
              ))}
            </select>
          </label>
          <label className="field-stack">
            <span>{props.t("recipient_count_input")}</span>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              value={props.recipientCountInput}
              onChange={(event) => props.setRecipientCountInput(event.target.value.replace(/\D/g, ""))}
            />
          </label>
          <label className="field-stack generated-title-field">
            <span>{props.t("generated_task_title")}</span>
            <input value={props.taskTitle} readOnly />
          </label>
        </div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={props.autoClickAirdropPage}
            onChange={(event) => props.setAutoClickAirdropPage(event.target.checked)}
          />
          <span>{props.t("auto_click_airdrop_page")}</span>
        </label>
        <div className="task-action-row">
          <div className="button-row">
            <button onClick={props.onParse} disabled={props.busy}>{props.t("parse_task")}</button>
            <button onClick={props.onStart} disabled={props.busy || ["starting", "waiting_for_user", "fetching_explorer_data"].includes(props.snapshot.status)}>
              {props.t("start_task")}
            </button>
            <button onClick={props.onEnd} disabled={!["starting", "waiting_for_user"].includes(props.snapshot.status)}>
              {props.t("end_task")}
            </button>
          </div>
          <div className="button-row">
            <button onClick={props.onRefreshStatus} disabled={props.busy}>{props.t("refresh_status")}</button>
            <button
              onClick={props.onCancel}
              disabled={!["waiting_for_user", "fetching_explorer_data", "starting"].includes(props.snapshot.status)}
            >
              {props.t("cancel_task")}
            </button>
          </div>
        </div>
        {props.message && <p className="message-line">{props.message}</p>}
      </section>

      <section className="panel grid-2">
        <InfoTable
          title={props.t("task_summary")}
          rows={[
            ["task_title", task?.task_title],
            ["task_date", task?.task_date],
            ["token_symbol", task?.token_symbol],
            ["token_contract", task?.token_contract],
            ["recipient_count", task?.recipient_count],
            ["amount_per_address", task?.amount_per_address],
            ["expected_total_airdrop_amount", task?.expected_total_airdrop_amount]
          ]}
        />
        <InfoTable
          title={props.t("runtime_monitor")}
          rows={[
            ["MetaMask confirmations clicked", props.snapshot.wallet_confirmations],
            ["started_at", props.snapshot.started_at],
            ["finished_at", props.snapshot.finished_at],
            ["report_path", props.snapshot.report_path],
            ["error_message", props.snapshot.error_message]
          ]}
        />
      </section>

      <section className="panel status-panel">
        <span>{props.t("status")}</span>
        <span className={`status-pill ${props.snapshot.status}`}>{props.snapshot.status}</span>
      </section>

      <section className="panel grid-2">
        <InfoTable
          title={props.t("gas")}
          rows={[
            ["native_before", props.snapshot.native_before],
            ["native_after", props.snapshot.native_after],
            ["native_gas_cost_total", props.snapshot.native_gas_cost_total]
          ]}
        />
        <InfoTable
          title={props.t("explorer_verification")}
          rows={[
            ["token_balance_before", explorer?.token_balance_before],
            ["token_balance_after", explorer?.token_balance_after],
            ["token_balance_delta", explorer?.token_balance_delta],
            ["holders_before", explorer?.holders_before],
            ["holders_after", explorer?.holders_after],
            ["holders_delta", explorer?.holders_delta],
            ["holders_wait_status", explorer?.holders_wait_status],
            ["explorer_check_status", explorer?.explorer_check_status]
          ]}
        />
      </section>

      <RuntimeLogs rows={latestLogs(props.snapshot.logs, 120)} t={props.t} />
    </div>
  );
}

function IntegratedTasks(props: {
  tokenOptions: string[];
  snapshot: IntegratedTaskSnapshot;
  parsedSubtasks: IntegratedSubTaskSnapshot[];
  message: string;
  autoClickDefault: boolean;
  busy: boolean;
  onParse: (taskTitles: string[]) => void;
  onStart: (queueTitle: string, taskTitles: string[], autoClickAirdropPage: boolean) => void;
  onForceEnd: () => void;
  onCancel: () => void;
  t: (key: string) => string;
}) {
  const [queueTitle, setQueueTitle] = useState(() => buildDailyQueueTitle(defaultDateInput()));
  const [dateInput, setDateInput] = useState(defaultDateInput());
  const [autoClickAirdropPage, setAutoClickAirdropPage] = useState(true);
  const [draftRows, setDraftRows] = useState<IntegratedDraftRow[]>(loadIntegratedDraftRows);
  const activeStatuses = ["running", "waiting_for_user", "settling"];
  const isActive = activeStatuses.includes(props.snapshot.status);
  const taskTitles = draftRows
    .map((row) => buildTaskTitle(dateInput, row.token_symbol, row.recipient_count))
    .filter((title) => !title.endsWith("__") && !title.includes("__"));
  const activeTaskSnapshot = props.snapshot.active_task_snapshot;

  useEffect(() => {
    if (!isActive) {
      setAutoClickAirdropPage(props.autoClickDefault);
    }
  }, [props.autoClickDefault, isActive]);

  useEffect(() => {
    const autoQueueTitle = buildDailyQueueTitle(dateInput);
    setQueueTitle((current) => current.trim() === "" || isAutoDailyQueueTitle(current) ? autoQueueTitle : current);
  }, [dateInput]);

  useEffect(() => {
    saveIntegratedDraftRows(draftRows);
  }, [draftRows]);

  useEffect(() => {
    if (props.tokenOptions.length === 0) {
      return;
    }

    setDraftRows((current) =>
      current.map((row) => ({
        ...row,
        token_symbol: row.token_symbol || props.tokenOptions[0]
      }))
    );
  }, [props.tokenOptions]);

  function updateRow(id: string, field: keyof Omit<IntegratedDraftRow, "id">, value: string) {
    setDraftRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }

  function addSubtask() {
    setDraftRows((current) => [
      ...current,
      {
        id: `row-${Date.now()}`,
        token_symbol: props.tokenOptions[0] ?? "",
        recipient_count: "16000"
      }
    ]);
  }

  function removeSubtask(id: string) {
    setDraftRows((current) => current.length <= 1 ? current : current.filter((row) => row.id !== id));
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <h2>{props.t("integrated")}</h2>
          <div className="button-row">
            <button onClick={addSubtask} disabled={props.busy || isActive}>{props.t("add_subtask")}</button>
            <button onClick={() => props.onParse(taskTitles)} disabled={props.busy || isActive}>{props.t("parse_queue")}</button>
            <button onClick={() => props.onStart(queueTitle, taskTitles, autoClickAirdropPage)} disabled={props.busy || isActive}>{props.t("start_queue")}</button>
            <button onClick={props.onForceEnd} disabled={props.busy || !isActive}>{props.t("force_end_queue")}</button>
            <button onClick={props.onCancel} disabled={props.busy || !isActive}>{props.t("cancel_queue")}</button>
          </div>
        </div>
        <div className="task-form-grid integrated-form-grid">
          <label className="field-stack">
            <span>{props.t("queue_title")}</span>
            <input value={queueTitle} onChange={(event) => setQueueTitle(event.target.value)} placeholder="MMDD_daily_airdrop" />
          </label>
          <label className="field-stack">
            <span>{props.t("task_date_select")}</span>
            <input type="date" value={dateInput} onChange={(event) => setDateInput(event.target.value)} />
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={autoClickAirdropPage}
              onChange={(event) => setAutoClickAirdropPage(event.target.checked)}
              disabled={isActive}
            />
            <span>{props.t("auto_click_airdrop_page")}</span>
          </label>
        </div>
        <div className="table-wrap subtask-draft-table">
          <table>
            <thead>
              <tr>
                <th>{props.t("token")}</th>
                <th>{props.t("recipients")}</th>
                <th>{props.t("task")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {draftRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <select value={row.token_symbol} onChange={(event) => updateRow(row.id, "token_symbol", event.target.value)} disabled={isActive}>
                      {props.tokenOptions.map((symbol) => (
                        <option key={symbol} value={symbol}>{symbol}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={row.recipient_count}
                      onChange={(event) => updateRow(row.id, "recipient_count", event.target.value.replace(/\D/g, ""))}
                      disabled={isActive}
                    />
                  </td>
                  <td className="mono">{buildTaskTitle(dateInput, row.token_symbol, row.recipient_count)}</td>
                  <td>
                    <button onClick={() => removeSubtask(row.id)} disabled={props.busy || isActive || draftRows.length <= 1}>
                      {props.t("remove")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {props.message && <p className="message-line">{props.message}</p>}
      </section>

      <section className="panel status-panel">
        <span>{props.t("status")}</span>
        <span className={`status-pill ${props.snapshot.status}`}>{props.snapshot.status}</span>
      </section>

      <section className="panel grid-2">
        <InfoTable
          title={props.t("current_task")}
          rows={[
            ["queue_title", props.snapshot.queue_title],
            ["current_index", props.snapshot.total_count ? `${props.snapshot.current_index + 1}/${props.snapshot.total_count}` : ""],
            ["task_title", props.snapshot.current_task?.task_title],
            ["token_symbol", props.snapshot.current_task?.token_symbol],
            ["recipient_count", props.snapshot.current_task?.recipient_count],
            ["error_message", props.snapshot.error_message]
          ]}
        />
        <InfoTable
          title={props.t("runtime_monitor")}
          rows={[
            ["single_task_status", activeTaskSnapshot?.status],
            ["wallet_confirmations", activeTaskSnapshot?.wallet_confirmations],
            ["native_before", activeTaskSnapshot?.native_before],
            ["native_after", activeTaskSnapshot?.native_after],
            ["report_path", activeTaskSnapshot?.report_path]
          ]}
        />
      </section>

      <section className="panel">
        <div className="section-heading">
          <h3>{props.t("sub_tasks")}</h3>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>{props.t("task")}</th>
                <th>{props.t("token")}</th>
                <th>{props.t("recipients")}</th>
                <th>{props.t("status")}</th>
                <th>Gas</th>
                <th>{props.t("token_balance_after")}</th>
                <th>{props.t("holders_total_after")}</th>
                <th>Explorer</th>
              </tr>
            </thead>
            <tbody>
              {(props.parsedSubtasks.length > 0 ? props.parsedSubtasks : props.snapshot.subtasks).map((subtask) => (
                <tr key={`${subtask.index}-${subtask.task.task_title}`}>
                  <td>{subtask.index + 1}</td>
                  <td>{subtask.task.task_title}</td>
                  <td>{subtask.task.token_symbol}</td>
                  <td>{subtask.task.recipient_count}</td>
                  <td>{subtask.status}</td>
                  <td>{subtask.native_gas_cost_total}</td>
                  <td>{subtask.token_balance_after}</td>
                  <td>{subtask.holders_after}</td>
                  <td>{subtask.explorer_check_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <RuntimeLogs
        rows={mergeLatestLogs(props.snapshot.logs, activeTaskSnapshot?.logs ?? [], 160)}
        t={props.t}
      />
    </div>
  );
}

function Settings(props: {
  settings: SettingsResponse | null;
  busy: boolean;
  onRefresh: () => void;
  onSave: (payload: { config: RuntimeSettingsDraft; tokens: Record<string, { contract: string; amount_per_address: string }> }) => Promise<void>;
  t: (key: string) => string;
}) {
  const [runtimeDraft, setRuntimeDraft] = useState<RuntimeSettingsDraft>(emptyRuntimeSettingsDraft());
  const [tokenDrafts, setTokenDrafts] = useState<TokenDraft[]>([]);
  const [settingsMessage, setSettingsMessage] = useState("");

  useEffect(() => {
    if (!props.settings) {
      return;
    }

    const config = props.settings.config;
    setRuntimeDraft({
      wallet_address: String(config.wallet_address ?? ""),
      browser_mode: String(config.browser_mode ?? ""),
      chrome_debug_url: String(config.chrome_debug_url ?? ""),
      auto_click_start_after_address_generated: config.auto_click_start_after_address_generated === false ? "false" : "true",
      explorer_base_url: String(config.explorer_base_url ?? ""),
      explorer_retry_count: String(config.explorer_retry_count ?? ""),
      explorer_retry_interval_ms: String(config.explorer_retry_interval_ms ?? ""),
      explorer_holders_wait_interval_ms: String(config.explorer_holders_wait_interval_ms ?? ""),
      explorer_holders_wait_timeout_ms: String(config.explorer_holders_wait_timeout_ms ?? "")
    });

    setTokenDrafts(
      Object.entries(props.settings.tokens ?? {}).map(([symbol, token]) => ({
        id: `${symbol}-${token.contract}`,
        symbol,
        contract: token.contract,
        amount_per_address: token.amount_per_address
      }))
    );
  }, [props.settings]);

  function setRuntimeField(field: keyof RuntimeSettingsDraft, value: string) {
    setRuntimeDraft((current) => ({
      ...current,
      [field]: value
    }));
  }

  function setTokenField(id: string, field: keyof Omit<TokenDraft, "id">, value: string) {
    setTokenDrafts((current) => current.map((token) => (token.id === id ? { ...token, [field]: value } : token)));
  }

  function addToken() {
    setTokenDrafts((current) => [
      ...current,
      {
        id: `new-${Date.now()}`,
        symbol: "",
        contract: "",
        amount_per_address: ""
      }
    ]);
  }

  function removeToken(id: string) {
    const target = tokenDrafts.find((token) => token.id === id);
    if (target?.symbol && !window.confirm(`Remove token ${target.symbol}?`)) {
      return;
    }
    setTokenDrafts((current) => current.filter((token) => token.id !== id));
  }

  async function save() {
    setSettingsMessage("");
    const tokens: Record<string, { contract: string; amount_per_address: string }> = {};

    for (const token of tokenDrafts) {
      const symbol = token.symbol.trim();
      if (!symbol && !token.contract.trim() && !token.amount_per_address.trim()) {
        continue;
      }

      tokens[symbol] = {
        contract: token.contract.trim(),
        amount_per_address: token.amount_per_address.trim()
      };
    }

    try {
      await props.onSave({
        config: runtimeDraft,
        tokens
      });
      setSettingsMessage(props.t("saved"));
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <h2>{props.t("settings")}</h2>
          <div className="button-row">
            <button onClick={props.onRefresh} disabled={props.busy}>{props.t("refresh")}</button>
            <button onClick={save} disabled={props.busy}>{props.t("save_settings")}</button>
          </div>
        </div>
        <p className="message-line">{props.t("edit_warning")}</p>
        {settingsMessage && <p className="message-line">{settingsMessage}</p>}
        <h3>{props.t("runtime_settings")}</h3>
        <div className="settings-grid">
          {Object.entries(runtimeDraft).map(([field, value]) => (
            <label key={field} className="field-stack">
              <span>{field}</span>
              {field === "auto_click_start_after_address_generated" ? (
                <input
                  type="checkbox"
                  checked={value === "true"}
                  onChange={(event) => setRuntimeField(field as keyof RuntimeSettingsDraft, event.target.checked ? "true" : "false")}
                />
              ) : (
                <input value={value} onChange={(event) => setRuntimeField(field as keyof RuntimeSettingsDraft, event.target.value)} />
              )}
            </label>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h3>{props.t("token_registry")}</h3>
          <button onClick={addToken} disabled={props.busy}>{props.t("add_token")}</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{props.t("symbol")}</th>
                <th>{props.t("contract")}</th>
                <th>{props.t("amount_per_address")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tokenDrafts.map((token) => (
                <tr key={token.id}>
                  <td>
                    <input value={token.symbol} onChange={(event) => setTokenField(token.id, "symbol", event.target.value)} />
                  </td>
                  <td>
                    <input className="mono" value={token.contract} onChange={(event) => setTokenField(token.id, "contract", event.target.value)} />
                  </td>
                  <td>
                    <input value={token.amount_per_address} onChange={(event) => setTokenField(token.id, "amount_per_address", event.target.value)} />
                  </td>
                  <td>
                    <button onClick={() => removeToken(token.id)} disabled={props.busy}>{props.t("remove")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function History(props: {
  rows: HistoryRow[];
  integratedRows: IntegratedHistoryEntry[];
  onRefresh: () => void | Promise<void>;
  t: (key: string) => string;
}) {
  const [view, setView] = useState<"single" | "integrated">("single");
  const [selectedDate, setSelectedDate] = useState("all");
  const [selectedQueueId, setSelectedQueueId] = useState("");
  const singleDateOptions = getHistoryDates(props.rows.map(getSingleHistoryDate));
  const integratedDateOptions = getHistoryDates(props.integratedRows.map(getIntegratedHistoryDate));
  const dateOptions = view === "single" ? singleDateOptions : integratedDateOptions;
  const filteredSingleRows = selectedDate === "all"
    ? props.rows
    : props.rows.filter((row) => getSingleHistoryDate(row) === selectedDate);
  const filteredIntegratedRows = selectedDate === "all"
    ? props.integratedRows
    : props.integratedRows.filter((row) => getIntegratedHistoryDate(row) === selectedDate);
  const selectedRun = filteredIntegratedRows.find((row) => row.queue_id === selectedQueueId) ?? filteredIntegratedRows[0] ?? null;
  const runsByDate = groupIntegratedRunsByDate(filteredIntegratedRows);

  useEffect(() => {
    if (selectedDate !== "all" && !dateOptions.includes(selectedDate)) {
      setSelectedDate("all");
      return;
    }

    if (!filteredIntegratedRows.some((row) => row.queue_id === selectedQueueId)) {
      setSelectedQueueId(filteredIntegratedRows[0]?.queue_id ?? "");
    }
  }, [dateOptions, filteredIntegratedRows, selectedDate, selectedQueueId]);

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <h2>{props.t("history")}</h2>
          <div className="button-row">
            <label className="inline-field">
              <span>{props.t("history_view")}</span>
              <select value={view} onChange={(event) => setView(event.target.value as "single" | "integrated")}>
                <option value="single">{props.t("single_task_history")}</option>
                <option value="integrated">{props.t("integrated_task_history")}</option>
              </select>
            </label>
            <label className="inline-field">
              <span>{props.t("history_date")}</span>
              <select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>
                <option value="all">{props.t("all_dates")}</option>
                {dateOptions.map((date) => (
                  <option key={date} value={date}>{date}</option>
                ))}
              </select>
            </label>
            <button onClick={props.onRefresh}>{props.t("refresh")}</button>
          </div>
        </div>

        {view === "single" && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{props.t("task")}</th>
                  <th>{props.t("date")}</th>
                  <th>{props.t("token")}</th>
                  <th>{props.t("recipients")}</th>
                  <th>{props.t("expected")}</th>
                  <th>Gas</th>
                  <th>{props.t("holders_before")}</th>
                  <th>{props.t("holders_after")}</th>
                  <th>{props.t("holders_delta")}</th>
                  <th>{props.t("holders_wait_status")}</th>
                  <th>{props.t("status")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredSingleRows.map((row, index) => (
                  <tr key={`${row.report_file}-${index}`}>
                    <td>{row.task_title || row.session_label}</td>
                    <td>{getSingleHistoryDate(row)}</td>
                    <td>{row.token_symbol}</td>
                    <td>{row.recipient_count}</td>
                    <td>{row.expected_total_airdrop_amount}</td>
                    <td>{row.native_gas_cost_by_balance}</td>
                    <td>{row.holders_before}</td>
                    <td>{row.holders_after}</td>
                    <td>{row.holders_delta || row.holders_count_delta}</td>
                    <td>{row.holders_wait_status}</td>
                    <td>{row.explorer_check_status || row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {view === "integrated" && (
          <div className="history-grid">
            <div className="table-wrap">
              <h3>{props.t("integrated_runs")}</h3>
              <table className="compact-table">
                <thead>
                  <tr>
                    <th>{props.t("queue_title")}</th>
                    <th>{props.t("sub_tasks")}</th>
                    <th>{props.t("status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {runsByDate.map(({ runs }) => (
                    runs.map((run) => (
                      <tr
                        key={run.queue_id}
                        className={selectedRun?.queue_id === run.queue_id ? "selected-row" : ""}
                        onClick={() => setSelectedQueueId(run.queue_id)}
                      >
                        <td>{run.queue_title}</td>
                        <td>{run.completed_count}/{run.total_count}</td>
                        <td>{run.status}</td>
                      </tr>
                    ))
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-wrap">
              <h3>{props.t("run_detail")}</h3>
              <table className="compact-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{props.t("task")}</th>
                    <th>{props.t("token")}</th>
                    <th>{props.t("recipients")}</th>
                    <th>{props.t("status")}</th>
                    <th>Gas</th>
                    <th>{props.t("token_balance_after")}</th>
                    <th>{props.t("holders_total_after")}</th>
                    <th>Explorer</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedRun?.subtasks ?? []).map((subtask) => (
                    <tr key={`${selectedRun?.queue_id}-${subtask.index}`}>
                      <td>{subtask.index + 1}</td>
                      <td>{subtask.task.task_title}</td>
                      <td>{subtask.task.token_symbol}</td>
                      <td>{subtask.task.recipient_count}</td>
                      <td>{subtask.status}</td>
                      <td>{subtask.native_gas_cost_total}</td>
                      <td>{subtask.token_balance_after}</td>
                      <td>{subtask.holders_after}</td>
                      <td>{subtask.explorer_check_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function RuntimeLogs(props: { rows: string[]; t: (key: string) => string }) {
  return (
    <section className="panel">
      <h2>{props.t("logs")}</h2>
      <pre className="log-box">{props.rows.join("\n") || "No logs yet."}</pre>
    </section>
  );
}

function formatLabel(key: string, language: Language): string {
  const label = labels[key];
  if (!label) {
    return key;
  }

  if (language === "zh-TW") {
    return label.zh;
  }

  if (language === "en") {
    return label.en;
  }

  return `${label.zh} / ${label.en}`;
}

function latestLogs(rows: string[], limit: number): string[] {
  return rows.slice(-limit).reverse();
}

function mergeLatestLogs(primary: string[], secondary: string[], limit: number): string[] {
  return [...new Set([...primary, ...secondary])]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit);
}

function emptyRuntimeSettingsDraft(): RuntimeSettingsDraft {
  return {
    wallet_address: "",
    browser_mode: "",
    chrome_debug_url: "",
    auto_click_start_after_address_generated: "true",
    explorer_base_url: "",
    explorer_retry_count: "",
    explorer_retry_interval_ms: "",
    explorer_holders_wait_interval_ms: "",
    explorer_holders_wait_timeout_ms: ""
  };
}

function defaultDateInput(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function taskDateFromInput(dateInput: string): string {
  const normalized = dateInput || defaultDateInput();
  const [, , month = "", day = ""] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized) ?? [];
  return `${month}${day}`;
}

function buildTaskTitle(dateInput: string, tokenSymbol: string, recipientCount: string): string {
  return `${taskDateFromInput(dateInput)}_${tokenSymbol.trim()}_${recipientCount.trim()}`;
}

function buildDailyQueueTitle(dateInput: string): string {
  return `${taskDateFromInput(dateInput)}_daily_airdrop`;
}

function isAutoDailyQueueTitle(value: string): boolean {
  return /^\d{4}_daily_airdrop$/.test(value.trim());
}

function defaultIntegratedDraftRows(): IntegratedDraftRow[] {
  return [
    {
      id: `row-${Date.now()}`,
      token_symbol: "",
      recipient_count: "16000"
    }
  ];
}

function loadIntegratedDraftRows(): IntegratedDraftRow[] {
  try {
    const raw = localStorage.getItem(INTEGRATED_DRAFT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Array<Partial<IntegratedDraftRow>> : [];
    const rows = parsed
      .filter((row) => typeof row.token_symbol === "string" && typeof row.recipient_count === "string")
      .map((row, index) => ({
        id: `row-${Date.now()}-${index}`,
        token_symbol: row.token_symbol ?? "",
        recipient_count: (row.recipient_count ?? "").replace(/\D/g, "") || "16000"
      }));
    return rows.length > 0 ? rows : defaultIntegratedDraftRows();
  } catch {
    return defaultIntegratedDraftRows();
  }
}

function saveIntegratedDraftRows(rows: IntegratedDraftRow[]): void {
  const serializableRows = rows.map((row) => ({
    token_symbol: row.token_symbol,
    recipient_count: row.recipient_count
  }));
  localStorage.setItem(INTEGRATED_DRAFT_STORAGE_KEY, JSON.stringify(serializableRows));
}

function groupIntegratedRunsByDate(rows: IntegratedHistoryEntry[]): Array<{ date: string; runs: IntegratedHistoryEntry[] }> {
  const groups = new Map<string, IntegratedHistoryEntry[]>();
  for (const row of rows) {
    const date = getIntegratedHistoryDate(row);
    groups.set(date, [...(groups.get(date) ?? []), row]);
  }
  return [...groups.entries()].map(([date, runs]) => ({ date, runs }));
}

function getHistoryDates(dates: string[]): string[] {
  return [...new Set(dates.filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));
}

function getSingleHistoryDate(row: HistoryRow): string {
  return normalizeHistoryDate(row.date)
    || normalizeHistoryDate(row.finished_at)
    || normalizeHistoryDate(row.started_at)
    || normalizeHistoryDate(row.report_file)
    || "unknown";
}

function getIntegratedHistoryDate(row: IntegratedHistoryEntry): string {
  return normalizeHistoryDate(row.date)
    || normalizeHistoryDate(row.finished_at)
    || normalizeHistoryDate(row.started_at)
    || "unknown";
}

function normalizeHistoryDate(value: string | undefined): string {
  if (!value) {
    return "";
  }

  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function InfoTable(props: { title: string; rows: Array<[string, unknown]> }) {
  return (
    <div>
      <h3>{props.title}</h3>
      <dl className="info-list">
        {props.rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{String(value ?? "")}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
