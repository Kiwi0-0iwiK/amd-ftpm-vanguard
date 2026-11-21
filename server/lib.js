// 後端共用：驗證、去識別化、Turnstile、流量限制、統計
// 判定規則在 site/lib/result.js（網頁與伺服器共用）；統計時一律用目前的規則重算，不用存下來的結論
import FTPM from '../site/lib/result.js';

const { deriveVerdict, RULE } = FTPM;
// 原則：只存網頁上「預覽」給使用者看過的欄位；伺服器自己重新挑欄位，不相信送來的其他東西。

export const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : null);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const bool = (v) => v === true;
const VERDICTS = ['MATCH', 'POSSIBLE', 'NOMATCH', 'NODATA'];
const OTHER_RE = /^[\w .\-()/]{1,60}, \d{1,6}$/;

// 送來的分享內容 → 要存的紀錄；不合格就丟 Error
export function normalize(p) {
  if (!p || typeof p !== 'object') throw new Error('bad_payload');
  if (p.v !== 1 && p.v !== 2) throw new Error('bad_version');
  if (typeof p.id !== 'string' || !/^[0-9a-f]{16}$/.test(p.id)) throw new Error('bad_id');
  if (!VERDICTS.includes(p.verdict)) throw new Error('bad_verdict');
  const offsets = Array.isArray(p.offsets) ? p.offsets.filter((x) => typeof x === 'number' && x >= 0 && x <= 1800).slice(0, 500).map((x) => Math.round(x * 10) / 10) : [];
  const others = {};
  if (p.others && typeof p.others === 'object') {
    for (const [k, n] of Object.entries(p.others).slice(0, 50)) {
      if (OTHER_RE.test(k) && Number.isInteger(n) && n > 0 && n <= 1000) others[k] = n;
    }
  }
  // 依 Vanguard 版本（key 是 vgk 的建置時間 UTC）
  const vgk = {};
  if (p.vgk && typeof p.vgk === 'object') {
    for (const [k, g] of Object.entries(p.vgk).slice(0, 50)) {
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(k) || !g || typeof g !== 'object') continue;
      const e = int(g.eligible, 1, 100000); const f = int(g.failed, 0, 100000);
      if (e === null || f === null || f > e) continue;
      const offs = Array.isArray(g.offsets) ? g.offsets.filter((x) => typeof x === 'number' && x >= 0 && x <= 1800).slice(0, 500).map((x) => Math.round(x * 10) / 10) : [];
      vgk[k] = { eligible: e, failed: f, offsets: offs };
    }
  }
  const ordinals = {};
  if (p.ordinals && typeof p.ordinals === 'object') {
    for (const [k, n] of Object.entries(p.ordinals).slice(0, 50)) {
      if (/^\d{1,6}$/.test(k) && Number.isInteger(n) && n > 0 && n <= 100000) ordinals[k] = n;
    }
  }
  const rec = {
    v: p.v,
    sv: typeof p.sv === 'string' && /^\d{4}\.\d\d\.\d\d$/.test(p.sv) ? p.sv : null,
    verdictReported: p.verdict,
    days: int(p.days, 1, 365),
    created: typeof p.created === 'string' && /^\d{4}-\d\d-\d\d$/.test(p.created) ? p.created : null,
    cpu: str(p.cpu, 100), board: str(p.board, 100), bios: str(p.bios, 40),
    biosDate: typeof p.biosDate === 'string' && /^\d{4}-\d\d-\d\d$/.test(p.biosDate) ? p.biosDate : null,
    os: str(p.os, 80), tpm: str(p.tpm, 60),
    amd: bool(p.amd), ftpm: p.ftpm === true ? true : p.ftpm === false ? false : null, vanguard: bool(p.vanguard), admin: bool(p.admin),
    eligible: int(p.eligible, 0, 100000),
    loads: int(p.loads, 0, 100000), tpm17: int(p.tpm17, 0, 1000000), tpm14: int(p.tpm14, 0, 1000000),
    outside: int(p.outside, 0, 100000), sessions: int(p.sessions, 0, 100000), failed: int(p.failed, 0, 100000),
    tpmNow: str(p.tpmNow, 30), lang: ['zh-TW', 'zh-CN', 'en'].includes(p.lang) ? p.lang : null,
    offsets, others, ordinals, vgk,
  };
  if (rec.loads === null || rec.sessions === null || rec.failed === null) throw new Error('bad_counts');
  if (rec.failed > rec.sessions || offsets.length > rec.sessions) throw new Error('inconsistent');
  rec.verdict = deriveVerdict(rec);
  rec.rule = RULE;
  return rec;
}

export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return { ok: false, error: 'not_configured' };
  if (typeof token !== 'string' || !token || token.length > 4096) return { ok: false, error: 'no_token' };
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const d = await r.json().catch(() => ({}));
  return d.success ? { ok: true } : { ok: false, error: 'turnstile_failed' };
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 同一個來源每天最多 limit 次寫入；IP 只存「日期＋IP＋固定字串」的雜湊
export async function rateLimit(env, ip, limit = 30) {
  const day = new Date().toISOString().slice(0, 10);
  const iph = (await sha256hex(`${day}|${ip || 'none'}|amd-ftpm-vanguard-rl`)).slice(0, 24);
  const row = await env.DB.prepare('INSERT INTO rl (day, iph, n) VALUES (?1, ?2, 1) ON CONFLICT(day, iph) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(day, iph).first();
  // 順手清掉兩天前的紀錄
  await env.DB.prepare('DELETE FROM rl WHERE day < ?1').bind(new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)).run();
  return (row?.n ?? 0) <= limit;
}

// /api/stats 的快取：key 帶著資料庫裡的版本號；有人分享或刪除就把版本號 +1，
// 舊的快取自然不會再被用到（避免「讀取中的舊結果在分享之後才寫回快取」的競態）
export const statsVersion = async (env) =>
  (await env.DB.prepare("SELECT v FROM meta WHERE k = 'stats_version'").first())?.v ?? 0;
export const statsCacheKey = (request, ver) => new Request(`${new URL(request.url).origin}/api/stats?v=${ver}`, { method: 'GET' });
export const bumpStats = (env) =>
  env.DB.prepare("INSERT INTO meta (k, v) VALUES ('stats_version', 1) ON CONFLICT(k) DO UPDATE SET v = v + 1").run();

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round(((s[s.length / 2 - 1] + s[s.length / 2]) / 2) * 10) / 10;
};

// 依 Vanguard 版本加總：幾台電腦、能判斷的場次、出錯場次、出錯秒數中位數
function byVgkAgg(recs) {
  const m = new Map();
  for (const r of recs) {
    for (const [k, g] of Object.entries(r.vgk || {})) {
      const a = m.get(k) || { key: k, pcs: 0, eligible: 0, failed: 0, offs: [] };
      a.pcs++; a.eligible += g.eligible; a.failed += g.failed; a.offs.push(...(g.offsets || []));
      m.set(k, a);
    }
  }
  return [...m.values()].map(({ offs, ...a }) => ({ ...a, median: median(offs) })).sort((a, b) => b.key.localeCompare(a.key)).slice(0, 30);
}

// 所有紀錄 → 公開的統計（只有加總，不輸出任何單筆紀錄）
export function aggregate(rows) {
  // 每筆都用目前的規則重算判定：規則改了，舊資料自動跟著新規則，不用重新上傳
  const recs = rows.map((r) => { try { const d = JSON.parse(r.data); return { ...d, updated: r.updated, verdict: deriveVerdict(d) }; } catch { return null; } }).filter(Boolean);
  const byVerdict = { MATCH: 0, POSSIBLE: 0, NOMATCH: 0, NODATA: 0 };
  const group = (keyFn) => {
    const m = new Map();
    for (const r of recs) {
      const k = keyFn(r) || '(unknown)';
      const g = m.get(k) || { key: k, n: 0, match: 0, meds: [] };
      g.n++; if (r.verdict === 'MATCH') g.match++;
      const md = median(r.offsets || []); if (md !== null) g.meds.push(md);
      m.set(k, g);
    }
    return [...m.values()].map(({ meds, ...g }) => ({ ...g, median: median(meds) })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  };
  const bins = {};
  const others = new Map();
  const perPcMedian = [];
  for (const r of recs) {
    byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
    if (r.verdict === 'MATCH' || r.verdict === 'POSSIBLE') {
      const md = median(r.offsets || []);
      if (md !== null) perPcMedian.push(md);
      for (const o of r.offsets || []) {
        const b = o >= 300 ? 300 : Math.floor(o / 5) * 5;   // 300 = 「300 秒以上」
        bins[b] = (bins[b] || 0) + 1;
      }
    }
    for (const k of Object.keys(r.others || {})) others.set(k, (others.get(k) || 0) + 1);
  }
  const vendor = (b) => (b || '').replace(/\b(INC\.?|CO\.?,?\s*LTD\.?|CORPORATION|CORP\.?|TECHNOLOGY|INTERNATIONAL)\b/gi, '').trim().split(/\s+/)[0];
  return {
    updated: new Date().toISOString(),
    rule: RULE,
    total: recs.length,
    amd: recs.filter((r) => r.amd).length,
    ftpm: recs.filter((r) => r.ftpm === true).length,
    ftpmUnknown: recs.filter((r) => r.ftpm !== true && r.ftpm !== false).length,
    byVerdict,
    medianOffset: median(perPcMedian),
    offsetBins: Object.entries(bins).map(([k, n]) => [Number(k), n]).sort((a, b) => a[0] - b[0]),
    byTpm: group((r) => r.tpm).slice(0, 20),
    byVendor: group((r) => vendor(r.board)).slice(0, 15),
    byBoard: group((r) => r.board).slice(0, 20),
    byCpu: group((r) => r.cpu).slice(0, 20),
    byBios: group((r) => (r.board && r.bios ? `${r.board} / ${r.bios}` : null)).slice(0, 20),
    byScript: group((r) => r.sv || (r.v === 1 ? 'v1 (2026.11.19)' : null)),
    byVgk: byVgkAgg(recs),
    vgkUnknown: recs.filter((r) => !r.vgk || !Object.keys(r.vgk).length).length,
    others: [...others.entries()].map(([key, pcs]) => ({ key, pcs })).sort((a, b) => b.pcs - a.pcs).slice(0, 20),
  };
}
