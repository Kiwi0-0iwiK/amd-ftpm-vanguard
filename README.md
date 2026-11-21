# AMD fTPM × Vanguard

**Live site: https://amd-ftpm-vanguard.pages.dev** (繁體中文 / 简体中文 / English)

About 110 seconds after a Riot game starts and its Vanguard anti-cheat driver (`vgk`) loads, the AMD firmware TPM (fTPM) on this PC fails a command (Windows System log, TPM event 17 / 14). On the original PC, an idle on-board Wi-Fi card (Realtek RTL8922AE) went down with it every time (Code 43 until a cold boot). The Wi-Fi card is collateral damage; **the fTPM failure is the actual problem**, and on other PCs it may hit something else, or nothing visible at all.

This repository contains the investigation site, the check script that lets other AMD players test their own PC, and the small backend that collects anonymous results.

> 中文說明：開 Riot 遊戲、Vanguard 載入約 110 秒後，AMD fTPM 指令會失敗；原本那台電腦上閒置的內建 WiFi 網卡會跟著被拖垮。這個 repo 是調查網站、給其他 AMD 玩家用的檢查腳本，以及收集匿名結果的後端。開發細節（繁中）在 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## Check your own PC

Only relevant on **AMD Ryzen with the built-in fTPM** and a Riot game that uses Vanguard (VALORANT, League of Legends, TFT, 2XKO). Intel PTT is a different firmware TPM and was not investigated.

1. Download [`check-amd-ftpm-vanguard.bat`](site/downloads/check-amd-ftpm-vanguard.bat) (double-click) or [`.ps1`](site/downloads/check-amd-ftpm-vanguard.ps1) (terminal).
2. Run it. Administrator rights are not needed.
3. It prints a verdict and writes `ftpm-check-result.txt` next to itself. Drop that file on the site to see charts; sharing is optional.

What the script does, all read-only:

- Finds every Vanguard driver load in the System event log (FilterManager event 6, `DeviceName = vgk`) and the matching unload (event 1).
- For each load, looks for the first TPM event 17 before the unload (up to 30 minutes). **It does not assume 110 seconds**; the delay differs between PCs.
- Lists other errors logged in the same ±3 seconds (other hardware that may have failed at that moment).
- Reads the TPM manufacturer and firmware version (WMI, or `TPM2_GetCapability` through TBS when not elevated), and sends one harmless `TPM2_GetRandom` to see whether the TPM still answers.
- Verdict (rule 2): **MATCH** if the TPM failed after load in at least 2 sessions and in at least half of the sessions long enough to tell (a failure, or 10+ minutes open).

It changes no settings and sends nothing. The output contains no computer name or user name.

## Anonymous sharing

On the site, a result file can be shared after the visitor reviews the exact payload, ticks consent and passes Cloudflare Turnstile.

- **Sent**: CPU, motherboard, BIOS, TPM and Windows versions, counts, the seconds-after-load of each failure, what else failed in the same second, and an anonymous ID (first 16 hex of SHA-256 over a fixed salt + hardware IDs; not reversible, only used so one PC counts once).
- **Not sent**: computer name, user name, the date and time of each game.
- IPs are only stored as a salted daily hash for two days, for rate limiting (30 writes per source per day).
- Anyone can withdraw their entry with the same result file.
- Only aggregates are public: `GET /api/stats` (add `?download=1` for a JSON file).

## Layout

```
site/                 static site (Cloudflare Pages)
  index.html, app.js, style.css
  i18n/               zh-TW (base), zh-CN, en
  lib/result.js       result-file parsing, share payload, verdict rule — shared by the page, the server and the tests
  downloads/          the check script (.ps1 is the source; .bat is generated)
  data/               timeline.js (investigation data), sample output, config (Turnstile site key)
functions/api/        submit / delete / stats (Cloudflare Pages Functions)
server/lib.js         validation, de-identification, Turnstile, rate limit, aggregation
schema.sql            D1 tables
scripts/              export-events.ps1, build-data.py, build-downloads.py, build-offline.py, prepare-images.py
data/milestones.json  the investigation timeline text (zh-TW original)
tests/                fixtures for every result-file version + node tests/run.mjs
docs/DEVELOPMENT.md   developer notes (Traditional Chinese)
```

## Versions

- Result file format `v`: `1` (2026-11-19), `2` (2026-11-21: no fixed delay, real session end, `eligible`, TPM info without admin).
- Script version `sv`: a date, bumped whenever detection or output changes.
  - `2026.11.21`: first v2 script.
  - `2026.11.22`: records the Vanguard driver build for every session (`vgk`, the build time from FilterManager event 6); shared as a per-build breakdown, shown as "By Vanguard version" in the statistics.
- Verdict rule `RULE` in `site/lib/result.js`. The server never trusts the verdict written in a file: statistics always recompute it from the stored facts with the current rule, so old submissions follow rule changes without re-uploading.
- Every format version keeps a fixture in `tests/fixtures/`; old result files must keep parsing.

## Build, test, deploy

```powershell
python scripts/build-downloads.py     # .bat + SHA-256 from the .ps1
python scripts/build-data.py          # site/data/timeline.js from exported events + data/milestones.json
python scripts/build-offline.py       # dist/ single-file offline copy
node tests/run.mjs                    # run before every deploy

npx wrangler d1 execute amd-ftpm-vanguard --local --file schema.sql
npx wrangler pages dev --port 8788    # site + API + local D1 (Turnstile test keys on localhost)

npx wrangler pages deploy --project-name amd-ftpm-vanguard --branch main --commit-dirty=true
```

The Turnstile secret is set with `npx wrangler pages secret put TURNSTILE_SECRET --project-name amd-ftpm-vanguard` and is never stored in this repository.

## Third-party

- [Apache ECharts](https://echarts.apache.org/) 5.6.0, bundled as `site/vendor/echarts.min.js` (Apache License 2.0).
- Fonts from Google Fonts (Noto Sans TC/SC, Inter, JetBrains Mono; SIL Open Font License).

## License

MIT for the code in this repository (see [LICENSE](LICENSE)). The investigation write-up and screenshots document one person's PC; computer names and account names in screenshots are masked.
