/* result.js — 檢查腳本結果檔的共用邏輯（網頁、伺服器、測試共用同一份）
 *
 * - parseResult(text)      結果檔文字 → 物件（v1、v2 都接受）
 * - buildShare(d, lang)    結果 → 匿名分享內容（拿掉每場的時間，只留秒數與計數）
 * - deriveVerdict(facts)   用目前的規則重新判定；伺服器不相信檔案裡寫的結論
 *
 * 版本：
 * - 格式版本 v（結果檔 JSON 結構）：1 = 2026-11-19 第一版，2 = 2026-11-21（不預設秒數、記 eligible 與實際場次長度）
 * - 腳本版本 sv（日期字串，例如 2026.11.21）：只改判定或文字、沒改結構時，只升這個
 * - 判定規則 RULE：規則改了就 +1，伺服器會用新規則重算所有舊資料
 *
 * 瀏覽器：<script src="lib/result.js"> 之後用 window.FTPM；Node／Pages Functions：import 或 require。
 */
(function (root) {
  'use strict';

  const RULE = 2;
  const FORMATS = [1, 2];

  function parseResult(text) {
    const m = /-----BEGIN FTPM-CHECK-----\s*([\s\S]*?)\s*-----END FTPM-CHECK-----/.exec(String(text));
    if (!m) throw new Error('nomarker');
    const d = JSON.parse(m[1]);
    if (!FORMATS.includes(d.v) || !Array.isArray(d.sessions)) throw new Error('version');
    return d;
  }

  // 判定規則 2：至少 2 場載入後出錯，而且佔「能判斷的場次」一半以上（能判斷＝有出錯，或開了 10 分鐘以上）
  // v1 沒有 eligible，只能用場次數近似（v1 的場次數包含很短的場次，所以偏嚴）
  function deriveVerdict(f) {
    const failed = f.failed || 0;
    const eligible = Number.isInteger(f.eligible) ? f.eligible : (f.sessions || 0);
    if (failed >= 2 && eligible > 0 && failed / eligible >= 0.5) return 'MATCH';
    if (failed >= 1) return 'POSSIBLE';
    if (eligible >= 2) return 'NOMATCH';
    return 'NODATA';
  }

  function buildShare(d, lang) {
    const fails = d.sessions.filter((s) => typeof s.off === 'number');
    const others = {};
    fails.forEach((s) => (s.others || []).forEach((o) => { others[o] = (others[o] || 0) + 1; }));
    return {
      v: d.v, sv: typeof d.sv === 'string' ? d.sv : null, id: d.id, created: d.created, days: d.days, admin: !!d.admin,
      eligible: Number.isInteger(d.eligible) ? d.eligible : null,
      cpu: d.cpu, board: d.board, bios: d.bios, biosDate: d.biosDate, os: d.os, tpm: d.tpm,
      // v1 讀不到 TPM 時會寫 ftpm:false，其實是「不知道」
      amd: !!d.amd, ftpm: typeof d.ftpm === 'boolean' && (d.v >= 2 || d.tpm) ? d.ftpm : null, vanguard: !!d.vanguard,
      loads: d.loads, tpm17: d.tpm17, tpm14: d.tpm14, outside: d.outside, tpmNow: d.tpmNow, verdict: d.verdict,
      ordinals: d.ordinals || {}, sessions: d.sessions.length, failed: fails.length,
      offsets: fails.map((s) => s.off), others, lang: lang || null,
    };
  }

  const api = { RULE, FORMATS, parseResult, buildShare, deriveVerdict };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FTPM = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
