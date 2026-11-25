/* 玩家版首頁（index.html）：簡短說明 → 1 分鐘檢查 → 看結果 → 匿名分享。
 * 文字：window.I18N[lang].home（另外借用 an／sh 的錯誤訊息與隱私說明）
 * 結果檔解析與分享內容：lib/result.js（和調查頁 app.js、伺服器共用）
 * 完整的調查紀錄（時間軸、圖表）在 investigation.html，由 app.js 負責。
 */
(() => {
  'use strict';
  const LANGS = ['zh-TW', 'zh-CN', 'en'];
  const GOAL = 100;
  // 回報的電腦少於這個數字時不顯示百分比：「2 台裡 2 台」寫成「100%」會讓人以為很確定（調查頁 app.js 用同一個門檻）
  const MIN_PCT = 10;
  const HOME_IDS = ['hero', 'top', 'what', 'why', 'test', 'analyze', 'fix', 'faq', 'more'];
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 無痕模式 */ } },
  };

  // 以前首頁就是調查頁；舊連結的錨點（#story 之類）在這頁不存在時，直接停在首頁最上面
  // （decodeURIComponent 遇到壞掉的 %xx 會丟錯；整頁的文字都是這支程式填的，不能讓它中斷）
  const hashId = (() => { try { return decodeURIComponent(location.hash.slice(1)); } catch { return ''; } })();
  if (location.hash && !HOME_IDS.includes(hashId)) {
    history.replaceState(null, '', location.pathname + location.search);
    scrollTo(0, 0);
  }

  // ---------- language ----------
  function pickLang() {
    const q = new URLSearchParams(location.search).get('lang');
    if (LANGS.includes(q)) return q;
    const s = store.get('lang');
    if (LANGS.includes(s)) return s;
    const n = (navigator.language || '').toLowerCase();
    if (/^zh-(cn|sg|hans)/.test(n)) return 'zh-CN';
    if (n.startsWith('zh')) return 'zh-TW';
    return 'en';
  }
  let lang = pickLang();
  let L = window.I18N[lang];
  let H = L.home;
  const get = (path, obj = L) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

  // ---------- theme ----------
  const root = document.documentElement;
  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  const themeBtn = $('#theme-btn');
  const syncThemeBtn = () => { themeBtn.textContent = isDark() ? L.ui.toLight : L.ui.toDark; };
  if (store.get('theme')) root.dataset.theme = store.get('theme');
  themeBtn.addEventListener('click', () => {
    root.dataset.theme = isDark() ? 'light' : 'dark';
    store.set('theme', root.dataset.theme);
    syncThemeBtn();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!root.dataset.theme) syncThemeBtn(); });

  function applyStatic() {
    root.lang = L.meta.htmlLang;
    document.title = H.title;
    $('meta[name="description"]').setAttribute('content', H.description);
    $$('[data-i]').forEach((el) => {
      const v = get(el.dataset.i);
      if (typeof v === 'string') el.innerHTML = v;
    });
    // data-i-label：翻譯過的 aria-label（圖表、可捲動的框、品牌名）
    $$('[data-i-label]').forEach((el) => {
      const v = get(el.dataset.iLabel);
      if (typeof v === 'string') el.setAttribute('aria-label', v.replace(/<[^>]+>/g, ''));
    });
    syncThemeBtn();
    $('#lang-switch').innerHTML = LANGS.map((k) => `<button type="button" data-lang="${k}" class="${k === lang ? 'on' : ''}" title="${window.I18N[k].meta.name}">${window.I18N[k].meta.label}</button>`).join('');
    // 換語言時，連到調查頁的連結也帶著語言
    $$('a[href^="investigation.html"]').forEach((a) => {
      const [path, hash] = a.getAttribute('href').split('#');
      a.setAttribute('href', `${path.split('?')[0]}?lang=${lang}${hash ? `#${hash}` : ''}`);
    });
  }
  $('#lang-switch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b || b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    L = window.I18N[lang];
    H = L.home;
    store.set('lang', lang);
    const u = new URL(location.href);
    u.searchParams.set('lang', lang);
    history.replaceState(null, '', u);
    renderAll();
  });

  // ---------- 固定內容 ----------
  function renderContent() {
    $('#h-flow').innerHTML = H.hero.flow.map((t, i) => `<span class="h-node n${i}">${esc(t)}</span>`).join('<span class="h-arr">→</span>');
    $('#h-impact').innerHTML = H.what.items.map(([lvl, t, d]) =>
      `<div class="h-card lv-${lvl}"><span class="h-badge">${esc(H.what.badges[lvl])}</span><strong>${esc(t)}</strong><p>${esc(d)}</p></div>`).join('');
    $('#h-steps').innerHTML = H.test.steps.map(([t, d], i) => `<li><span class="h-num">${i + 1}</span><div><strong>${esc(t)}</strong><p>${d}</p></div></li>`).join('');
    // 第 2 步的警告視窗截圖：中文介面用繁中系統的截圖，英文用英文系統的
    const shot = $('#h-shot-img');
    const en = lang === 'en';
    shot.src = `img/run-warning-${en ? 'en' : 'zh'}.webp`;
    shot.height = en ? 344 : 329;
    shot.alt = H.test.shotCap;
    $('#h-safe-list').innerHTML = H.test.safe.map((x) => `<li>${x}</li>`).join('');
    $('#h-fix').innerHTML = H.fix.items.map(([t, d]) => `<div class="h-fixitem"><strong>${esc(t)}</strong><p>${esc(d)}</p></div>`).join('');
    $('#h-faq').innerHTML = H.faq.items.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('');
  }

  // ---------- 大家的結果（即時數字） ----------
  const OFFLINE = location.protocol === 'file:';
  let stats = null;
  async function loadStats(force) {
    if (OFFLINE) { stats = { error: true }; renderStats(); return; }
    try {
      const r = await fetch(`/api/stats${force ? `?t=${Date.now()}` : ''}`, { cache: force ? 'no-store' : 'default' });
      if (!r.ok) throw new Error(String(r.status));
      stats = await r.json();
    } catch { stats = { error: true }; }
    renderStats();
  }
  function renderStats() {
    const live = $('#h-live');
    const total = stats && !stats.error ? (stats.total || 0) : null;
    const match = total ? (stats.byVerdict && stats.byVerdict.MATCH) || 0 : 0;
    live.hidden = total === null;
    if (total !== null) live.innerHTML = total ? H.live.n(total, match) : esc(H.live.none);
    const T = H.why.tiles;
    const pct = total >= MIN_PCT ? ` · ${Math.round((match / total) * 100)}%` : '';
    $('#h-tiles').innerHTML = [
      [total ?? '—', T.total],
      [total ? `${match}<small>/ ${total}</small>` : '—', `${T.match}${pct}`],
      [(stats && stats.medianOffset) ?? '—', T.median],
    ].map(([n, l]) => `<div class="tile"><div class="num">${n}</div><div class="lbl">${esc(l)}</div></div>`).join('');
    $('#h-goal').hidden = total === null;
    if (total !== null) {
      $('#h-bar-fill').style.width = `${Math.max(2, Math.min(100, (total / GOAL) * 100))}%`;
      $('#h-goal-txt').textContent = H.why.goal(total, GOAL);
    }
  }

  // ---------- 看結果 ----------
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const SITEKEY = isLocalHost ? '1x00000000000000000000AA' : ((window.SITE_CONFIG || {}).turnstileSiteKey || '');
  let mine = null;
  let tsToken = '';
  let tsWidget = null;

  const readFile = (f) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return showErr('big');
    const r = new FileReader();
    r.onload = () => {
      try { mine = window.FTPM.parseResult(String(r.result)); showErr(null); renderMine(); $('#an-out').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      catch (e) { mine = null; $('#an-out').hidden = true; showErr(e.message === 'version' ? 'version' : 'parse'); }
    };
    r.readAsText(f, 'utf-8');
  };
  function showErr(k) { const el = $('#an-err'); el.hidden = !k; el.textContent = k ? L.an.err[k] : ''; }
  const drop = $('#drop');
  const fileIn = $('#file-in');
  // 讀完把選擇清掉：重新跑腳本後再選同一個檔名，change 事件才會再觸發
  fileIn.addEventListener('change', () => { readFile(fileIn.files[0]); fileIn.value = ''; });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => readFile(e.dataTransfer.files[0]));

  // 「同一秒還出錯的東西」用一般人看得懂的名字
  const friendly = (key) => {
    const k = String(key).toLowerCase();
    const hit = Object.keys(H.an.known).find((p) => k.startsWith(p));
    return hit ? H.an.named(H.an.known[hit], key) : key;
  };

  function renderMine() {
    if (!mine) return;
    const d = mine;
    const A = L.an;
    const fails = d.sessions.filter((s) => typeof s.off === 'number');
    const md = window.FTPM.medianOf(fails.map((s) => s.off));   // 和結果檔裡腳本印的中位數一致
    const med = md === null ? null : Math.round(md);
    const e = Number.isInteger(d.eligible) ? d.eligible : d.sessions.length;
    // 用目前的規則重算，和分享後統計裡算的一樣（不直接用檔案裡寫的 verdict）
    const v = window.FTPM.verdictOf(d);
    const [title, body] = H.an.res[v];
    $('#h-verdict').className = `h-verdict v-${v.toLowerCase()}`;
    $('#h-verdict').innerHTML = `<code>${v}</code><strong>${esc(title)}</strong><p>${esc(body({ f: fails.length, e, med, loads: d.loads }))}</p>`;

    const others = {};
    fails.forEach((s) => (s.others || []).forEach((o) => { others[o] = (others[o] || 0) + 1; }));
    const oRows = Object.entries(others).sort((a, b) => b[1] - a[1]);
    const shortN = d.sessions.filter((s) => s.off === null && typeof s.dur === 'number' && s.dur < 10).length;
    $('#h-extra').innerHTML =
      (oRows.length ? `<p class="h-others"><b>${esc(H.an.others)}</b> ${oRows.map(([k, n]) => `${esc(friendly(k))} × ${n}`).join(esc(H.an.sep))}</p>` : '') +
      (shortN ? `<p class="small">${esc(A.shortDesc(shortN))}</p>` : '') +
      (!d.amd ? `<p class="an-warn">${esc(A.notAmd)}</p>` : '');

    const sys = [[A.cpu, d.cpu], [A.board, d.board], [A.bios, `${d.bios || '—'}${d.biosDate ? ` (${d.biosDate})` : ''}`], [A.tpm, d.tpm || A.noAdmin], [A.os, d.os], [A.tpmNow, d.tpmNow],
      [A.loads, d.loads], [A.fails, fails.length], [A.median, med ?? '—'], [A.outside, d.outside]];
    const vg = Object.entries(window.FTPM.byVgk(d.sessions)).sort((a, b) => b[0].localeCompare(a[0]));
    $('#h-detail').innerHTML = `<h4>${esc(A.sysH)}</h4><table class="kv">${sys.map(([k, val]) => `<tr><th>${esc(k)}</th><td>${esc(val ?? '—')}</td></tr>`).join('')}</table>` +
      (vg.length ? `<h4>${esc(A.vgkH)}</h4><table class="kv">${vg.map(([k, g]) => `<tr><th><code>${esc(k.replace('T', ' ').replace('Z', ''))}</code></th><td>${esc(A.failedOf(g.failed, g.eligible))}</td></tr>`).join('')}</table>` : '');

    $('#sh-h').textContent = v === 'NOMATCH' ? H.sh.hNo : H.sh.h;
    $('#an-out').hidden = false;
    renderShare();
  }

  // ---------- 分享 ----------
  function shMsg(k, extra = '') { const el = $('#sh-msg'); el.textContent = k ? `${L.sh.msg[k] || k}${extra}` : ''; el.dataset.kind = k || ''; }
  function syncSend() { $('#sh-send').disabled = !(mine && $('#sh-ok').checked && tsToken); }
  function renderShare() {
    if (!mine) return;
    $('#sh-json').textContent = JSON.stringify(window.FTPM.buildShare(mine, lang), null, 2);
    if (OFFLINE) { $('#share').classList.add('off'); shMsg('offline'); return; }
    if (!SITEKEY) { $('#share').classList.add('off'); shMsg('soon'); return; }
    loadTurnstile();
    syncSend();
  }
  $('#sh-ok').addEventListener('change', syncSend);
  function loadTurnstile() {
    const render = () => {
      if (tsWidget !== null || !window.turnstile) return;
      tsWidget = window.turnstile.render('#ts-box', {
        sitekey: SITEKEY, theme: isDark() ? 'dark' : 'light', language: lang === 'en' ? 'en' : lang.toLowerCase(),
        callback: (t) => { tsToken = t; syncSend(); },
        'expired-callback': () => { tsToken = ''; syncSend(); },
        'error-callback': () => { tsToken = ''; syncSend(); shMsg('ts'); },
      });
    };
    if (window.turnstile) return render();
    if (document.getElementById('ts-script')) return;
    window.onTsLoad = render;
    const s = document.createElement('script');
    s.id = 'ts-script';
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTsLoad';
    s.async = true;
    document.head.appendChild(s);
  }
  const resetTs = () => { tsToken = ''; if (window.turnstile && tsWidget !== null) window.turnstile.reset(tsWidget); syncSend(); };
  async function post(path, body) {
    const r = await fetch(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `http_${r.status}`);
    return d;
  }
  $('#sh-send').addEventListener('click', async () => {
    $('#sh-send').disabled = true;
    shMsg('sending');
    try {
      await post('submit', { token: tsToken, payload: window.FTPM.buildShare(mine, lang) });
      shMsg('sent');
      loadStats(true);
    } catch (e) { shMsg(L.sh.msg[e.message] ? e.message : 'fail', L.sh.msg[e.message] ? '' : ` (${e.message})`); }
    resetTs();
  });
  $('#sh-del').addEventListener('click', async () => {
    if (!mine || OFFLINE || !SITEKEY) return;
    if (!tsToken) { shMsg('needTs'); return; }
    if (!confirm(L.sh.confirmDel)) return;
    shMsg('sending');
    try {
      const d = await post('delete', { token: tsToken, id: mine.id });
      shMsg(d.deleted ? 'deleted' : 'notFound');
      loadStats(true);
    } catch (e) { shMsg(L.sh.msg[e.message] ? e.message : 'fail', L.sh.msg[e.message] ? '' : ` (${e.message})`); }
    resetTs();
  });

  // ---------- 傳給朋友 ----------
  $('#h-sharelink').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}`;
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title: H.title, url }); return; } catch { /* 取消就改用複製 */ }
    }
    try { await navigator.clipboard.writeText(url); } catch { prompt('URL', url); return; }
    const b = $('#h-sharelink');
    b.textContent = H.fix.copied;
    setTimeout(() => { b.textContent = H.fix.share; }, 2000);
  });

  function renderAll() {
    applyStatic();
    renderContent();
    renderStats();
    if (mine) renderMine();
  }
  renderAll();
  loadStats(false);
})();
