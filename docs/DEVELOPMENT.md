# 開發筆記（繁體中文）

> 給維護者看的細節：資料流程、格式版本、部署、踩過的坑。一般說明請看根目錄的 README。

開 Riot 遊戲（Vanguard 載入）約 110 秒後 AMD fTPM 指令失敗，連帶拖垮桌機 Realtek 8922AE WiFi（代碼 43）的調查紀錄，做成有互動圖表的網頁。主軸是「真正壞的是 fTPM，WiFi 是連帶受害」，給一般玩家看可能受影響的東西，並提供檢查腳本。三種語言（繁體中文、简体中文、English），深色／淺色都能切換。

- **網站**：https://amd-ftpm-vanguard.pages.dev （Cloudflare Pages，公開）
- **離線版**：`dist/wifi-8922ae-timeline.html`，一個檔案、雙擊就能開，不需要網路（1.6 MB）
- **原始碼**：`site/` 整個資料夾

**實測範圍**：只在 VALORANT 實測過。英雄聯盟、聯盟戰棋（PC）、2XKO 用的是同一個 Vanguard，網站上標明「理論上會一樣，但還沒測試」。網站文字一律寫「Riot 遊戲」，只有描述實際測試時才寫 Valorant。


## 結果檔格式 v2（2026-11-21）

第二位玩家（同 CPU、ROG STRIX B850-F、BIOS 1022、fTPM 6.32.0.6）的結果顯示出錯秒數會因電腦而異（104～156 秒、中位數 115.7 秒；這台 105～125 秒、中位數約 111 秒），所以腳本改成不預設秒數：

- **找錯誤的範圍**：vgk 載入後到卸載為止（最多 30 分鐘），找第一個 TPM 事件 17。
- **場次結束**：用 vgk 卸載事件（FilterManager 1）判斷，不再用「下一次載入」，以免出現 25 小時的假場次。
- **判定**：MATCH = 至少 2 場載入後出錯，而且佔「能判斷的場次」一半以上（能判斷＝有出錯，或開了 10 分鐘以上）。結果會列出這台的最短／中位數／最長秒數。
- **TPM 資訊**：先用 WMI（要系統管理員），讀不到就用 TBS 送 TPM2_GetCapability 讀製造商與韌體版本（一般使用者也行，已用 `runas /trustlevel:0x20000` 驗證）。兩者都讀不到時 `ftpm` 是 `null`（不知道），不是 `false`。
- 新欄位：`tpmSrc`（wmi／tbs）、`eligible`、每場的 `dur`（實際長度）與 `ended`（有沒有卸載事件）。網頁和伺服器同時接受 v1 與 v2；舊的 v1 檔若 `tpm` 是空的，分享時 `ftpm` 改送 `null`。
- 統計多了每個 fTPM 版本／主機板的「出錯時間中位數」，出錯秒數分布最後一格是「300 秒以上」。

## 腳本 2026.11.22：記錄 Vanguard 版本

每一場多記 `vgk`：FilterManager 事件 6 的 `DeviceTime`，也就是 vgk.sys 的建置時間（UTC），可以拿來分辨 Vanguard 版本。分享時由 `site/lib/result.js` 的 `byVgk` 整理成「每個版本：能判斷的場次、出錯場次、出錯秒數」，只有版本、沒有遊玩時間；統計的「依 Vanguard 版本」表顯示每版的電腦數、出錯率、中位數，用來看哪一版之後出錯率下降。格式版本維持 v2。

2026-11-21 Riot 推了建置時間 2026-11-21T01:40:06Z 的新版，這台載入後仍在 +118.7 秒出錯。

## 結果檔、看自己的結果、匿名分享（2026-11-19 加入）

- **檢查腳本**跑完會在旁邊寫 `ftpm-check-result.txt`：上面是給人看的摘要，下面 `-----BEGIN FTPM-CHECK-----` 到 `-----END FTPM-CHECK-----` 之間是 JSON（`v: 1`）。從 .bat 執行時會自動打開資料夾並選取這個檔。
- **看懂你的結果**（「自己檢查」區塊最下面）：把結果檔拖進網頁，全部在瀏覽器裡解析、畫圖，不會上傳。
- **匿名分享**：先顯示「會送出的內容」→ 勾選同意 → Turnstile 人機驗證 → `POST /api/submit`。送出的內容拿掉每場遊戲的時間，只留秒數和「同一秒還出錯的東西」的計數。
  - 匿名代碼 `id` = SHA-256（`amd-ftpm-vanguard|` + 主機 UUID + 主機板序號 + CPU ProcessorId）前 16 碼：無法反推，同一台電腦重新分享會覆蓋舊資料。
  - 伺服器（`server/lib.js` 的 `normalize`）自己重新挑欄位、檢查格式與範圍，不存送來的其他東西。
  - IP 只以「日期＋IP＋祕密鹽」的雜湊存兩天，每天每個來源最多 30 次寫入。鹽是祕密 `RL_SALT`（還沒設定時借用 `TURNSTILE_SECRET`）；原始碼公開，只用固定字串的話所有 IPv4 試一遍就能反推。
  - 請求本文邊讀邊數大小（`readJson`）：`/api/submit` 最多 32 KB、`/api/delete` 最多 8 KB，沒帶 content-length 的分塊傳送也擋得住。
  - 出錯場次比「能判斷的場次」（eligible）多的分享直接拒絕（`inconsistent`）。
  - `POST /api/delete` 用同一個 `id` 刪除。
- **大家的結果**（`#stats`）：`GET /api/stats` 只回傳加總（總數、符合比例、出錯秒數分布、依 fTPM 版本／主機板、同一秒還出錯的東西），`?download=1` 下載 JSON。伺服器端快取的 key 帶著資料庫裡的版本號，每次分享／刪除 +1，統計馬上更新。
- 離線版沒有後端：可以看自己的結果，但不能分享、看不到大家的結果。

| 檔案 | 用途 |
|---|---|
| `wrangler.toml` | Pages 設定、D1 綁定（`DB` → 資料庫 `amd-ftpm-vanguard`） |
| `schema.sql` | 資料表：`results`、`rl`（流量限制）、`meta`（統計版本號） |
| `functions/api/submit.js`、`delete.js`、`stats.js` | 三個 API（Cloudflare Pages Functions） |
| `server/lib.js` | 驗證、去識別化、Turnstile、流量限制、統計 |
| `site/data/config.js` | Turnstile 的網站金鑰（公開）；空字串＝分享功能未開放 |
| `.dev.vars` | 本機測試用的 Turnstile 測試祕密（Cloudflare 公開的測試值），不進版本控制 |

**Turnstile 設定**：網站金鑰寫在 `site/data/config.js`；祕密金鑰用 `npx wrangler pages secret put TURNSTILE_SECRET --project-name amd-ftpm-vanguard` 設定（由帳號擁有者自己貼，不要寫進任何檔案），設定後要重新部署一次才會生效。本機（localhost）會自動改用 Cloudflare 的測試金鑰。

**流量限制的鹽**：`npx wrangler pages secret put RL_SALT --project-name amd-ftpm-vanguard`，貼一串夠長的隨機字串（同樣不要寫進任何檔案）。換鹽只會讓當天的流量計數重新開始。

**本機測試整套（網站＋API＋本機資料庫）**：

```powershell
npx wrangler d1 execute amd-ftpm-vanguard --local --file schema.sql
npx wrangler pages dev --port 8788
```

**改了資料表**：先 `--local` 測，再 `npx wrangler d1 execute amd-ftpm-vanguard --remote --file schema.sql`（`schema.sql` 都是 `IF NOT EXISTS`，重跑沒關係）。

## 網頁內容

網站分成兩頁（2026-11-24 起）：

- **首頁 `index.html`（玩家版，`home.js`＋`i18n/home.js`）**：給沒有技術背景、被朋友傳連結過來的人。順序是：一句話＋「1 分鐘檢查」按鈕＋即時回報數 → 安全晶片是什麼、壞了會怎樣（已確認／有可能／未證實分開標）→ 為什麼你的檢查有用（即時統計＋目標 100 台的進度條）→ 三步驟檢查（下載 .bat、「開啟檔案 - 安全性警告」按「執行」並附截圖、拖回網頁）＋「可以放心跑」→ 白話結論＋分享（一個勾選＋人機驗證；細節、撤回收在摺疊裡）→ 我有這個問題怎麼辦 → 常見問題 → 完整調查紀錄入口。不用 vgk、事件 17 這類詞。舊網址的錨點（例如 `#story`）在首頁不存在時，就停在首頁最上面。
- **調查頁 `investigation.html`（`app.js`）**：原本的完整調查紀錄，內容不變，選單最前面多一個「← 首頁」。離線版就是這一頁。
- 兩頁共用 `style.css`、`lib/result.js`、三個語言檔、`/api/*`。
- **連結預覽**：兩頁都有 Open Graph／Twitter 卡片，圖是 `site/og.png`（`python scripts/make-og.py` 產生，需要 Pillow 和 Windows 的微軟正黑體）。爬蟲不跑 JavaScript，所以預覽一律是繁體中文。

以下是調查頁的內容。

**開場（捲動式介紹）**：滿版標題，往下捲是七個步驟，右邊的示意圖跟著變化：症狀 → 懷疑驅動 → 110 秒的規律（計時器）→ TPM 先壞 → 連線中的網卡撐得住 → 我的繞法 → 不只是 WiFi（fTPM 可能拖下水的東西）。結尾按鈕直接跳到檢查腳本。

**完整報告**：

| 區塊 | 內容 |
|---|---|
| 結論 | 觸發順序、四個會跳動的數字、目前的繞法 |
| 影響範圍 | fTPM 出錯可能拖下水的東西，依證據分四類：本案例實測、依賴 TPM 的 Windows 功能、AMD 已知問題、有人回報未證實（USB 鍵鼠）；附來源連結 |
| 事件總覽 | 泳道圖：遊戲場次、TPM 錯誤、網卡掛掉、WiFi 連線、開機；可縮放，點場次放大 |
| 110 秒 | 每場遊戲對齊 vgk 載入時間，以及 WiFi 狀態 × 結果的 2×2 表 |
| 毫秒順序 | 整體（毫秒）和放大 TPM（微秒）兩種模式；12 筆 TPM 事件其實是 6 組 14→17 |
| 調查歷程 | 四個階段、30 個里程碑，可以跳到圖表對應的時間點 |
| 假設檢驗 | 10 個懷疑過的方向和證據 |
| 自己檢查 | 先決條件（只限 AMD）、下載 `.bat`（雙擊執行）或 `.ps1`、SmartScreen 提示怎麼處理、範例輸出、結果判讀、拖結果檔進來看圖表、匿名分享 |
| 大家的結果 | 匿名分享的加總統計，可下載 JSON |
| 截圖、資料 | 給 Riot 的畫面（已遮蔽）、所有場次的表格 |

圖表和區塊在捲到畫面上時才播放動畫；系統設定「減少動態效果」時全部關閉。

## 資料夾

```
wifi-8922ae-timeline/
├── scripts/
│   ├── export-events.ps1    匯出 Windows 事件記錄（唯讀，100 奈秒精度）→ data/raw/events-*.json
│   ├── build-data.py        合併事件＋guard 紀錄＋里程碑 → site/data/timeline.js（去識別化）
│   ├── prepare-images.py    截圖裁切、遮蔽、轉 WebP → site/img/
│   ├── build-downloads.py   從 .ps1 產生可雙擊的 .bat，算 SHA-256 → site/data/downloads.js
│   ├── build-offline.py     把調查頁打包成單一 HTML → dist/
│   ├── stamp-assets.py      在 site/*.html 的 .js／.css 後面加內容指紋（?v=）
│   ├── make-og.py           連結預覽圖 → site/og.png
│   └── make-run-warning.py  雙擊 .bat 時的「開啟檔案 - 安全性警告」截圖加框 → site/img/run-warning-*.webp（首頁第 2 步）
├── data/
│   ├── milestones.json      調查歷程、場次註記、假設（繁中原文，改這裡）
│   ├── sample-output.txt    檢查腳本的範例輸出（節錄）
│   └── raw/                 原始匯出與截圖（含個資，不進版本控制）
├── site/                    網站版
│   ├── index.html  home.js  玩家版首頁
│   ├── investigation.html  app.js  完整調查紀錄
│   ├── style.css  og.png    兩頁共用的樣式、連結預覽圖
│   ├── i18n/                zh-TW.js（介面文字）、zh-CN.js、en.js（介面＋調查內容的翻譯）、home.js（首頁三語文字）
│   ├── data/                timeline.js、sample.js
│   ├── downloads/           check-amd-ftpm-vanguard.ps1（改這個）、.bat（產生的）
│   ├── img/  vendor/        截圖、ECharts
│   └── _headers             Cloudflare Pages 的 HTTP 標頭
└── dist/                    離線版
```

## 改文字

- **調查內容**（里程碑、假設、場次註記、繞法）：繁中改 `data/milestones.json` 然後跑 `build-data.py`；英文和簡中改 `site/i18n/en.js`、`zh-CN.js` 的 `content`（用里程碑的時間 `t` 當 key）。
- **介面文字**：三個語言檔的其他欄位。HTML 裡的 `data-i="路徑"` 對應語言檔的路徑。
- **首頁文字**：`site/i18n/home.js`（三種語言在同一個檔）。`node tests/run.mjs` 會檢查三種語言的欄位是否一致。
- 改完記得重跑 `build-offline.py`，離線版才會更新。

## 更新資料

系統事件記錄只有 20 MB，舊事件會被覆蓋，所以要定期匯出。每次匯出都會另存一份，`build-data.py` 會合併去重，舊事件不會因為被覆蓋就從網頁上消失。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\export-events.ps1
python scripts\build-data.py
python scripts\build-offline.py
```

截圖有變動時才需要跑 `python scripts\prepare-images.py`（需要 `pip install --user pillow`）。改了檢查腳本就跑 `python scripts\build-downloads.py`，重新產生 .bat 和雜湊值。

## 本機預覽

```powershell
python -m http.server 8765 --directory site
```

打開 http://localhost:8765 。網址加 `?lang=en` 或 `?lang=zh-CN` 可以直接指定語言。

## 部署到 Cloudflare Pages

專案 `amd-ftpm-vanguard` 已在 2026-11-19 建立並上線。之後每次更新：

```powershell
npx wrangler pages deploy --project-name amd-ftpm-vanguard --branch main --commit-dirty=true
```

在專案資料夾執行（會讀 `wrangler.toml`，上傳 `site/` 和 `functions/`）。`--commit-dirty=true` 是因為這個資料夾不是 git repo，不加的話 wrangler 會一直警告。

建立專案時踩到的坑（只有第一次需要）：wrangler 4.165 預設會把 `pages project create` 轉到新的 Cloudflare Workers 平台，轉交失敗、什麼都沒建立。要加 `--force` 才會直接建在 Pages 上（網址才是 `.pages.dev`）：

```powershell
npx wrangler login
npx wrangler pages project create amd-ftpm-vanguard --production-branch main --force
```

`site/_headers` 會讓下載的檔案一律用 `Content-Disposition: attachment`，另外加上 `nosniff`、`X-Frame-Options: DENY`、只含 `frame-ancestors`／`object-src`／`base-uri` 的 CSP、`Permissions-Policy`（相機、麥克風、定位全關）和 `Cross-Origin-Opener-Policy: same-origin-allow-popups`。`script-src` 還沒限制（Turnstile 和 `<head>` 裡的主題小 script 要另外給 hash，要在瀏覽器裡測過再加）。

## 用到的工具

| 工具 | 版本 | 用途 |
|---|---|---|
| [Apache ECharts](https://echarts.apache.org/) | 5.6.0（`site/vendor/echarts.min.js`，從 jsDelivr 下載，SHA-256 `bf4a2235…7b1`） | 所有圖表 |
| Wrangler（Cloudflare CLI） | 4.165.0（`npx` 執行，不用安裝） | 部署 |
| Pillow | pip 最新版 | 截圖處理 |
| PowerShell 5.1 / Python 3.14 / Node 22 | 系統內建 | 匯出、建置、部署 |

## 注意

- `.ps1` 檔要存成 **UTF-8 with BOM**，否則 Windows PowerShell 5.1 會把中文讀錯，導致語法錯誤。
- 圖表時間一律是台北時間：資料存成「台北牆上時間當 UTC」的毫秒數，ECharts 開 `useUTC`，在任何時區打開都一樣。
- 事件記錄的時間精度是 100 奈秒；`build-data.py` 的 `us()` 自己解析小數，因為 Python 的 `fromisoformat` 只到微秒。
- 場次的 WiFi 狀態是從 WLAN 記錄推出來的；停用裝置這種記錄裡看不出來的實驗條件，寫在 `data/milestones.json` 的 `sessionNotes`。
- grid 子元素要加 `min-width: 0`（或欄位寫 `minmax(0, 1fr)`），否則一行很長的指令或不換行的表格會把整頁撐出橫向捲軸。
- 橘色分兩個：圖表與線條用 `--c-tpm`，**文字**用 `--c-tpm-text`（淺色模式 `#eb6834` 當文字對比只有 2.9:1）。淺色的 `--text-3` 也調深到 `#67665f`，小字才過 4.5:1。
- 統計的百分比：電腦數少於 10 台（`home.js`、`app.js` 的 `MIN_PCT`）只顯示「幾台中幾台」，不換算百分比；Vanguard 版本表的分母是場次，照常顯示。
- SVG 元素不要用含 `transform` 的 CSS 動畫：CSS 的 transform 會蓋掉 SVG 的 `transform="translate(…)"` 屬性，元素全部擠到原點。只動 opacity。
- 站內錨點跳轉要「捲完再對齊一次」：延遲載入的縮圖會在捲動途中把版面往下推。
- .bat 是 cmd／PowerShell 雙語檔（開頭 `<# :` 那段），必須存成沒有 BOM 的 UTF-8、CRLF 換行；已在中文路徑下測過。
