# Airdrop Operations Helper 發展歷史

最後更新：2026-06-02

本文件用於回顧本地輔助程序從單任務工具逐步演進為 Dashboard + 集成任務隊列工具的過程。

為避免外部公開時暴露敏感信息，本文不記錄具體公鏈名稱、空投頁 URL、Explorer URL、RPC、錢包地址或 Token 合約地址。

## 1. 初始集成任務規劃

### 提問 / 需求

希望在不破壞原有單任務流程的前提下，新增「集成任務」模式：

- 多個原本的單任務作為子任務。
- 子任務按順序自動執行。
- 每個子任務完成後自動結算。
- 程序填入代幣地址、每地址數量、接收地址數後，自動點擊「生成隨機地址」。
- 人工只保留錢包密碼輸入和必要審查。

### 修改內容

- 設計 integrated task / queue / subtask 架構。
- 保留 Home 單任務模式。
- 在上層新增集成任務 runner。
- 規劃子任務狀態、歷史記錄、Dashboard 顯示、CSV 結算復用方式。

## 2. 第一版集成任務實作

### 提問 / 需求

確認方向後，開始按設計修改程序。

### 修改內容

- 新增 Integrated Task Dashboard 分頁。
- 支援建立隊列、添加多個子任務、解析任務標題。
- 集成任務開始後逐個調用原單任務流程。
- 新增集成任務狀態、子任務列表、隊列控制按鈕。
- 初步接入集成任務歷史記錄。

## 3. 子任務切換與頁面復用

### 提問 / 需求

測試兩個子任務時，第一輪後第二輪沒有自動進行，且第一個子任務顯示 failed。希望：

- 第一輪完成後不要關閉空投頁。
- 清空第一輪數據並填入第二輪數據。
- 重新生成隨機地址。
- 集成任務完全結束後才關閉頁面。

### 修改內容

- 集成任務中復用同一個 browser/page session。
- 子任務結算時保留頁面給下一個子任務。
- 下一個子任務重新填表、重新生成地址。
- 集成任務最後一個子任務完成後才關閉頁面。

## 4. 集成任務歷史視圖

### 提問 / 需求

希望知道為什麼完成的集成子任務沒有出現在 History 裡，並希望 History 可以像語言切換一樣切換查看：

- 單任務歷史。
- 集成任務歷史。
- 按日期查看某天做了幾次集成任務。
- 點開某次集成任務查看具體子任務。

### 修改內容

- 新增 integrated task history store。
- History 增加單任務 / 集成任務視圖切換。
- 集成任務歷史按批次展示。
- 支援查看某次集成任務的子任務明細。

## 5. 第一個子任務未觸發錢包 watcher

### 提問 / 需求

集成任務第一個子任務開始後，空投頁已打開並填入，但錢包彈窗沒有自動點擊。判斷可能是 integrated runner 沒有正確啟動原本單任務的 wallet watcher。

### 修改內容

- 檢查單任務 `DashboardTaskRunner.startTask()` watcher 啟動流程。
- 確保集成任務每個子任務也走同一段 watcher 啟動邏輯。
- 在子任務開始時加入 watcher started 類日誌。
- 確認 watcher 綁定到正確 browser context / CDP。

## 6. 地址生成與手動點擊後 watcher 未接管

### 提問 / 需求

空投頁打開後正在生成隨機地址，期間人工輸入錢包密碼；地址生成完成後人工點擊「授權並空投」，但程序沒有自動點擊錢包流程。

### 修改內容

- 調整 watcher 啟動時機，確保在頁面填表和生成地址前就已啟動。
- 讓 watcher 持續監聽，等待人工或程序觸發頁面開始按鈕後的錢包彈窗。

## 7. 子任務完成但前端顯示 failed

### 提問 / 需求

測試中第一個子任務實際完成空投，但前端顯示 failed，且沒有結算，也沒有推進到第二個子任務。

### 修改內容

- 修復集成任務過早判定失敗問題。
- 子任務完成後調用單任務結算流程。
- 將 gas、token balance、holders、狀態寫回子任務快照。
- 完成後自動推進到下一個子任務。
- 集成任務子任務欄增加已完成子任務的統計數據。

## 8. 子任務間隔、Gas/Holders、自動點擊頁面開始

### 提問 / 需求

測試合格後提出優化：

- 子任務之間間隔太久，需要減少等待。
- 集成任務中 tx 不需要重點統計，但 Gas 和 Holders 應準確。
- 希望地址生成後自動點擊頁面上的「授權並空投」按鈕，進一步自動化。

### 修改內容

- 優化子任務完成後等待與推進流程。
- 集成任務子任務重點展示 gas / holders。
- 新增 `auto_click_start_after_address_generated` 配置和 Dashboard checkbox。
- 在地址生成完成後可自動點擊頁面級開始 / 授權並空投按鈕。

## 9. 地址生成等待邏輯

### 提問 / 需求

生成地址耗時和接收地址數成正比，不應使用固定 30 秒 timeout。期望根據實際生成數量判斷完成：

```text
點擊生成隨機地址
持續檢查已生成地址數量
達到 recipient_count 才進入下一步
```

### 修改內容

- 移除固定 30 秒點擊/等待判斷。
- `clickGenerateRandomAddresses()` 使用無固定短 timeout 的點擊方式。
- `waitForGeneratedAddresses()` 輪詢頁面已生成地址數量。
- 達到本次 recipient_count 才判定地址生成完成。
- 地址計數改為只統計 EVM 地址，避免 tx hash 被誤判成地址。

## 10. page.evaluate ReferenceError 修復

### 提問 / 需求

優化地址生成等待後出現：

```text
page.evaluate: ReferenceError: __name is not defined
```

### 修改內容

- 移除傳入 `page.evaluate()` 的嵌套 helper function。
- 將地址統計邏輯改為可在瀏覽器上下文獨立執行。
- 修復 Playwright evaluate 序列化導致的 ReferenceError。

## 11. 任務刷新後無法結束 / 歷史缺失

### 提問 / 需求

某次單任務無法結束，刷新頁面後 History 也查不到本次操作。

### 修改內容

- 強化任務結束 / 結算流程。
- 確保結算時即使部分 tx / explorer 數據異常，也盡量寫入 CSV。
- 後續加入「結束集成任務並立即結算」作為卡住時的恢復入口。

## 12. 自動點擊頁面授權並空投未生效

### 提問 / 需求

勾選 Dashboard 的「地址生成完成後自動點擊開始 / 授權並空投」後，程序仍未點擊 DApp 頁面按鈕。

### 修改內容

- 檢查前端 checkbox state、settings config、API body、runner 讀取流程。
- 確保單任務和集成任務 start API 都傳入 `autoClickAirdropPage`。
- `dashboardTaskRunner` 在地址生成後調用 `clickAuthorizeAndAirdrop()`。
- 加強按鈕 selector，支持多種中英文按鈕文案。
- 日誌輸出匹配到的按鈕文字和點擊結果。

## 13. 子任務 completed 但仍顯示 failed

### 提問 / 需求

集成任務中子任務完成，但仍顯示 failed。

### 修改內容

- 修復 tx 等待與結算競態。
- settlement 返回非終態時增加重試。
- active task settlement 期間阻止下一個任務過早開始。
- 子任務只有結算結果真正 failed 時才標記 failed。

## 14. 結束集成任務並立即結算

### 提問 / 需求

希望在集成任務頁新增「結束集成任務並立即結算」。

### 修改內容

- 新增 `forceEndQueue()`。
- 新增 `/api/integrated-task/force-end`。
- 前端新增「結束集成任務並立即結算」按鈕。
- 當前子任務立即進入 force settlement。
- 後續未執行子任務標記 skipped。
- 保存 integrated history。

## 15. 最後一次錢包授權 / 確認停止問題

### 提問 / 需求

集成任務最後一次插件錢包授權和確認交易按鈕會停止。

### 修改內容

- wallet watcher 回報每一次錢包動作，不只回報 confirm count。
- 任務結算前等待 wallet watcher idle 窗口。
- 避免最後一個彈窗剛出現就停止 watcher。

## 16. 頁面點擊後無實際觸發的重試

### 提問 / 需求

日誌顯示 `page airdrop button clicked`，但實際仍需人工點擊頁面按鈕。

### 修改內容

- 自動點擊頁面按鈕後新增「觸發確認」：
  - wallet page detected
  - wallet button clicked
  - tx count increased
- 15 秒內沒有觸發信號時最多重試 3 次。
- wallet watcher 增加錢包頁偵測回調。
- 日誌輸出 `page airdrop click trigger confirmed` 或 retry 原因。

## 17. 大地址數任務完成後等待卡住

### 提問 / 需求

第三個子任務 20000 地址空投頁面已顯示完成，但 helper 卡住未結束集成任務。

### 修改內容

- 發現原因：頁面完成但 helper 只解析到部分 tx hash，未達預期 tx 閾值。
- 新增 `getAirdropProgress()`，讀取：
  - txCount
  - completion text
- 等待條件改為：
  - tx hash 數達標；或
  - 頁面出現完成文字且 wallet confirm 數達標。
- force-end / cancel 可以中斷等待，不再卡住。
- 當前卡住任務通過 force-end 成功結算並寫入歷史。

## 18. 集成任務子任務欄位優化

### 提問 / 需求

集成任務子任務欄目不需要顯示預計總量，希望看到該代幣餘額，holders 變化改成任務完成後持幣者總數。

### 修改內容

- 子任務快照新增：
  - `token_balance_after`
  - `holders_after`
- 子任務表格移除 expected total。
- 顯示完成後代幣餘額和任務完成後持幣者總數。
- History 集成任務明細同步調整。

## 19. History 日期篩選

### 提問 / 需求

希望 History 內單任務 / 集成任務都可以按日期篩選。

### 修改內容

- History 新增日期篩選下拉。
- 單任務從 date / finished_at / started_at / report_file 提取日期。
- 集成任務從 date / finished_at / started_at 提取日期。
- 切換視圖時日期選項同步切換。
- 歷史拉取上限提高，避免只篩到最近少量記錄。

## 20. 集成任務批次日期欄移除

### 提問 / 需求

既然集成任務已可日期篩選，集成任務批次表不需要單獨列日期欄。

### 修改內容

- 移除集成任務批次表的日期欄。
- 批次表只保留：
  - 隊列名稱
  - 子任務數
  - 狀態

## 21. Checkbox 排版優化

### 提問 / 需求

集成任務裡的「自動點擊頁面授權並空投」按鈕希望和文字同一行。

### 修改內容

- 集成任務 checkbox 結構改成和 Home 一致。
- CSS 增加 flex 排版。
- 確保 checkbox 和文字橫向排列。

## 22. 默認勾選自動點擊

### 提問 / 需求

首頁和集成任務的「自動點擊頁面授權並空投」希望默認勾選。

### 修改內容

- Home checkbox 初始值改為 true。
- Integrated Task checkbox 初始值改為 true。
- API 和 runner 在沒有明確配置時默認 auto click true。
- Settings 若明確保存 false，仍可關閉。

## 23. 集成任務設定保存與隊列名稱自動填充

### 提問 / 需求

希望：

- 集成任務自動保存上一次子任務設定。
- 隊列名稱自動按當天日期填入 `MMDD_daily_airdrop`。

### 修改內容

- 子任務 token 和 recipient_count 保存到瀏覽器本地存儲。
- 刷新 Dashboard 後恢復上一次集成任務草稿。
- 隊列名稱按日期自動生成。
- 日期改變時，如果隊列名稱仍是自動格式，會同步更新。

## 24. 日誌合併到首頁與集成任務

### 提問 / 需求

希望不再需要額外點擊「日誌」頁查看任務日誌；單任務和集成任務運行時直接在頁面內看到日誌。

### 修改內容

- 移除側邊欄獨立 Logs tab。
- Home 頁底部嵌入單任務 runtime logs。
- Integrated Task 頁底部嵌入集成隊列 log + 當前子任務 log。
- 保留最近關鍵日誌，倒序顯示，便於運行中查看最新狀態。

## 25. 文檔與 GitHub 準備

### 提問 / 需求

希望整理程序發展歷史、完善 README，並了解如何上傳 GitHub、如何啟動 3002。

### 修改內容

- 新增本文件作為發展歷史記錄。
- 重寫 README 為公開版，不暴露公鏈名稱、空投頁 URL、Explorer、RPC、錢包地址或 Token 合約。
- 準備 `.gitignore`，避免本地配置、報表、截圖、瀏覽器 profile 和依賴被提交。

## 核心演進總結

程序從最初的單任務錢包彈窗輔助工具，逐步演進為：

- 本地 Dashboard。
- 單任務與集成任務雙模式。
- 多子任務順序執行。
- 地址生成完成檢測。
- 頁面級自動開始。
- 錢包彈窗自動處理。
- 子任務自動結算。
- Gas / Token balance / Holders 核心統計。
- 單任務與集成任務 History。
- 內嵌 runtime logs。
- 卡住時可立即結算的恢復能力。

後續審閱時，建議優先查看：

1. `src/dashboardTaskRunner.ts`：單任務核心流程。
2. `src/integratedTaskRunner.ts`：集成任務隊列流程。
3. `src/distributionPage.ts`：頁面填表、地址生成、頁面按鈕與完成狀態檢測。
4. `src/walletWatcher.ts`：錢包彈窗自動點擊。
5. `dashboard/src/App.tsx`：Dashboard UI、History、Settings、Logs。
