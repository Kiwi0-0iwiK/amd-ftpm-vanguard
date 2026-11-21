/* WiFi 消失調查 — 網頁邏輯（v2：多語言、開場動畫）
 * 資料：window.TIMELINE（data/timeline.js，由 scripts/build-data.py 產生）
 * 文字：window.I18N（i18n/*.js）；調查內容的原文是繁體中文，其他語言用 I18N[lang].content 覆蓋
 * 時間：所有毫秒數都是「台北牆上時間當 UTC」，圖表開 useUTC，顯示一律是台北時間。
 */
(() => {
  'use strict';
  const D = window.TIMELINE;
  const S = D.stats;
  const LANGS = ['zh-TW', 'zh-CN', 'en'];
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const imgSrc = (n) => (window.TIMELINE_IMAGES && window.TIMELINE_IMAGES[n]) || `img/${n}.webp`;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 無痕模式 */ } },
  };

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
  const get = (path, obj = L) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  const fill = (str, vars) => String(str).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
  const VARS = {
    lag: Math.abs(S.lagMedian ?? 0.4).toFixed(2).replace(/0$/, ''), sec: Math.floor(S.offsetMedian),
    connOk: S.connectedSurvived, connAll: S.connectedTotal, idleBad: S.idleBroke, idleAll: S.idleTotal,
  };
  const C = () => L.content || {};

  // ---------- time helpers (UTC getters = 台北時間) ----------
  const p2 = (n) => String(n).padStart(2, '0');
  const p3 = (n) => String(n).padStart(3, '0');
  const dt = (ms) => new Date(ms);
  const fDate = (ms) => L.fmt.date(dt(ms));
  const fHM = (ms) => `${p2(dt(ms).getUTCHours())}:${p2(dt(ms).getUTCMinutes())}`;
  const fHMS = (ms) => `${fHM(ms)}:${p2(dt(ms).getUTCSeconds())}`;
  const fHMSm = (ms) => `${fHMS(ms)}.${p3(dt(ms).getUTCMilliseconds())}`;
  const fFull = (ms) => `${fDate(ms)} ${fHMS(ms)}`;
  const DAY = 86400000;

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
    redrawCharts(false);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!root.dataset.theme) { syncThemeBtn(); redrawCharts(false); } });

  const css = () => {
    const cs = getComputedStyle(root);
    const v = (n) => cs.getPropertyValue(n).trim();
    return {
      text: v('--text'), text2: v('--text-2'), text3: v('--text-3'), grid: v('--grid'), surface: v('--surface'),
      surface2: v('--surface-2'), border: v('--border'), band: v('--band'),
      vgk: v('--c-vgk'), tpm: v('--c-tpm'), conn: v('--c-conn'), fail: v('--c-fail'), good: v('--c-good'), boot: v('--c-boot'),
      mono: v('--mono'), sans: v('--sans'),
    };
  };
  const tooltipBase = (K) => ({
    backgroundColor: K.surface, borderColor: K.border, borderWidth: 1, padding: [8, 12],
    textStyle: { color: K.text, fontFamily: K.sans, fontSize: 13 },
    extraCssText: 'box-shadow:0 6px 24px rgba(0,0,0,.18);border-radius:10px;max-width:340px;white-space:normal;',
  });
  const tip = (title, rows) => `<div style="font-weight:600;margin-bottom:4px">${title}</div>` +
    rows.map(([k, v]) => `<div style="display:flex;gap:14px;justify-content:space-between"><span style="opacity:.7">${k}</span><span style="text-align:right">${v}</span></div>`).join('');

  // ---------- content getters（翻譯優先，否則用原文） ----------
  const mText = (m) => (C().milestones && C().milestones[m.t]) || m;
  const pText = (p) => (C().phases && C().phases[p.id]) || p;
  const hText = (h, i) => (C().hypotheses && C().hypotheses[i]) || h;
  const noteOf = (s) => (s.noteKey ? ((C().notes && C().notes[s.noteKey]) || s.note) : '');
  const netOf = (n) => (L.nets && L.nets[n]) || n;

  // =================================================================== static text
  function applyStatic() {
    root.lang = L.meta.htmlLang;
    document.title = L.meta.title;
    $('meta[name="description"]').setAttribute('content', L.meta.description);
    $$('[data-i]').forEach((el) => {
      const v = get(el.dataset.i);
      if (typeof v === 'string') el.innerHTML = fill(v, VARS);
    });
    syncThemeBtn();
    $('#lang-switch').innerHTML = LANGS.map((k) => `<button type="button" data-lang="${k}" class="${k === lang ? 'on' : ''}" title="${window.I18N[k].meta.name}">${window.I18N[k].meta.label}</button>`).join('');
  }
  $('#lang-switch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b || b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    L = window.I18N[lang];
    store.set('lang', lang);
    const u = new URL(location.href);
    u.searchParams.set('lang', lang);
    history.replaceState(null, '', u);
    renderAll(false);
  });

  // =================================================================== intro (scrollytelling)
  const viz = $('#viz');
  let vizStep = 0;
  let timerRaf = 0;
  let timerVal = 0;
  const RING = 326.7;
  function setTimer(v) {
    timerVal = v;
    $('#tnum').textContent = Math.round(v);
    $('#ring').style.strokeDashoffset = String(RING * (1 - Math.min(v, 110) / 110));
  }
  function runTimer(to) {
    cancelAnimationFrame(timerRaf);
    if (reduceMotion) { setTimer(to); return; }
    const from = timerVal;
    const t0 = performance.now();
    const ms = Math.max(400, Math.abs(to - from) * 20);
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setTimer(from + (to - from) * e);
      if (k < 1) timerRaf = requestAnimationFrame(tick);
    };
    timerRaf = requestAnimationFrame(tick);
  }
  function setVizStep(n) {
    if (n === vizStep) return;
    vizStep = n;
    viz.setAttribute('class', `viz st-${n}`);
    $$('.step').forEach((s, i) => s.classList.toggle('on', i + 1 === n));
    runTimer(n >= 3 && n <= 6 ? 110 : n >= 7 ? timerVal : 0);
  }
  function renderSteps() {
    $('#steps').innerHTML = L.intro.steps.map((s, i) => `<article class="step${i + 1 === vizStep ? ' on' : ''}" data-step="${i + 1}">
        <span class="tag"><span class="num">0${i + 1}</span>${esc(s.tag)}</span>
        <h3>${esc(s.h)}</h3><p>${fill(s.p, VARS)}</p></article>`).join('');
    $('#viz-ok').textContent = `${S.connectedSurvived}/${S.connectedTotal}`;
    $('#viz-bad').textContent = `${S.idleBroke}/${S.idleTotal}`;
    $$('.step').forEach((s) => stepObs.observe(s));
  }
  const stepObs = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) setVizStep(+en.target.dataset.step); });
  }, { rootMargin: '-45% 0px -45% 0px' });
  // 捲回最上面時回到初始狀態
  new IntersectionObserver((en) => { if (en[0].isIntersecting) setVizStep(0); }, { rootMargin: '0px 0px -60% 0px' }).observe($('.intro-hero'));

  // 站內連結：延遲載入的圖片會在捲動途中把版面推開，捲完再對齊一次
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const el = document.getElementById(a.getAttribute('href').slice(1));
    if (!el) return;
    e.preventDefault();
    history.replaceState(null, '', `${location.search}#${el.id}`);
    const go = (behavior) => el.scrollIntoView({ behavior, block: 'start' });
    go(reduceMotion ? 'auto' : 'smooth');
    setTimeout(() => { if (Math.abs(el.getBoundingClientRect().top - 60) > 30) go('auto'); }, 900);
  });

  // 導覽列放不下時右側淡出（可以左右捲動），不要硬切文字
  const nav = $('#nav');
  const syncNav = () => nav.classList.toggle('clipped', nav.scrollWidth > nav.clientWidth + 1 && nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
  nav.addEventListener('scroll', syncNav, { passive: true });
  addEventListener('resize', syncNav);

  // progress bar
  const bar = $('#progress');
  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const h = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${h > 0 ? scrollY / h : 0})`;
      ticking = false;
    });
  }, { passive: true });

  // =================================================================== reveal + count-up
  const revealObs = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      revealObs.unobserve(en.target);
      if (en.target.classList.contains('hero')) countUp();
    });
  }, { rootMargin: '0px 0px -12% 0px' });
  $$('.reveal').forEach((el) => revealObs.observe(el));

  let counted = false;
  function countUp(force) {
    if (counted && !force) { $$('.cnt').forEach((c) => { c.textContent = (+c.dataset.to).toFixed(+c.dataset.dec); }); return; }
    counted = true;
    $$('.cnt').forEach((c) => {
      const to = +c.dataset.to;
      const dec = +c.dataset.dec;
      if (reduceMotion) { c.textContent = to.toFixed(dec); return; }
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 1200);
        c.textContent = (to * (1 - Math.pow(1 - k, 3))).toFixed(dec);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  // =================================================================== report: hero
  const conn = D.sessions.filter((s) => s.tpm && s.state === 'connected');
  const idle = D.sessions.filter((s) => s.tpm && ['disconnected', 'ap', 'off', 'disabled'].includes(s.state));
  function renderHero() {
    $('#report-h1').innerHTML = fill(L.report.h1, VARS);
    const ch = L.report.chain.map((x) => fill(x, VARS));
    const dots = ['var(--c-vgk)', null, 'var(--c-tpm)', null, 'var(--c-fail)'];
    $('#chain').innerHTML = ch.map((x, i) => (dots[i]
      ? `<span class="node" style="transition-delay:${i * 0.12}s"><i class="dot" style="background:${dots[i]}"></i>${esc(x)}</span>`
      : `<span class="arr" style="transition-delay:${i * 0.12}s">${esc(x)}</span>`)).join('');
    $('#tiles').innerHTML = L.report.tiles(S).map(([v, dec, unit, lbl]) =>
      `<div class="tile"><div class="num"><span class="cnt" data-to="${v}" data-dec="${dec}">${counted || reduceMotion ? (+v).toFixed(dec) : '0'}</span>${unit}</div><div class="lbl">${lbl}</div></div>`).join('');
    $('#workaround').innerHTML = (C().workaround || D.workaround).map((w) => `<li>${esc(w)}</li>`).join('');
  }

  function renderMatrix() {
    const count = (arr, o) => arr.filter((s) => s.outcome === o).length;
    const cell = (n, kind) => `<td class="${n ? kind : 'zero'}">${n}<small>${esc(L.timing.unit)}</small></td>`;
    $('#mx-c0').textContent = L.timing.matrixCols[0];
    $('#mx-c1').textContent = L.timing.matrixCols[1];
    $('#matrix').innerHTML =
      `<tr><th>${esc(L.timing.matrixRows[0])}</th>${cell(count(conn, 'survived'), 'ok')}${cell(count(conn, 'broke'), 'bad')}</tr>` +
      `<tr><th>${esc(L.timing.matrixRows[1])}</th>${cell(count(idle, 'survived'), 'ok')}${cell(count(idle, 'broke'), 'bad')}</tr>`;
    const excl = D.sessions.filter((s) => s.tpm && ['unknown', 'dead'].includes(s.state)).length;
    $('#matrix-note').textContent = L.timing.matrixNote(excl);
  }

  // =================================================================== charts
  const charts = {};
  const drawn = {};
  const DRAW = {};
  const mk = (id) => {
    if (charts[id]) charts[id].dispose();
    charts[id] = echarts.init(document.getElementById(id), null, { renderer: 'canvas' });
    return charts[id];
  };
  const chartObs = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const id = en.target.id;
      chartObs.unobserve(en.target);
      drawn[id] = true;
      DRAW[id](true);
    });
  }, { rootMargin: '0px 0px -10% 0px' });
  function redrawCharts(animate) { Object.keys(drawn).forEach((id) => DRAW[id](animate)); }
  let wasMobile = innerWidth < 600;
  addEventListener('resize', () => {
    if ((innerWidth < 600) !== wasMobile) { wasMobile = innerWidth < 600; redrawCharts(false); return; }
    Object.values(charts).forEach((c) => c.resize());
  });

  const T0 = D.meta.systemLogOldest;
  const T1 = D.meta.exported;
  let lanesRange = [T0, T1];

  // ---------- 事件泳道圖 ----------
  DRAW['chart-lanes'] = (animate) => {
    const K = css();
    const chart = mk('chart-lanes');
    const mobile = innerWidth < 600;
    const T = L.tip;
    const clip = (params, shape) => echarts.graphic.clipRectByRect(shape, {
      x: params.coordSys.x, y: params.coordSys.y, width: params.coordSys.width, height: params.coordSys.height,
    });
    const barItem = (color, hFrac) => (params, api) => {
      const lane = api.value(0);
      const a = api.coord([api.value(1), lane]);
      const b = api.coord([api.value(2), lane]);
      const h = api.size([0, 1])[1] * hFrac;
      const shape = clip(params, { x: a[0], y: a[1] - h / 2, width: Math.max(b[0] - a[0], 3), height: h });
      return shape && { type: 'rect', shape: { ...shape, r: 3 }, style: { fill: color } };
    };
    const sess = D.sessions.map((s, i) => [0, s.load, s.unload || s.load + 60000, i]);
    const connData = D.wlanConn.map((c, i) => [3, c.start, c.end || T1, i]);
    const apData = D.ap.map((c, i) => [3, c.start, c.end || T1, i]);

    chart.setOption({
      useUTC: true,
      animation: animate && !reduceMotion, animationDuration: 900, animationEasing: 'cubicOut',
      textStyle: { fontFamily: K.sans },
      grid: { left: mobile ? 74 : 104, right: 18, top: lanesMark ? 44 : 26, bottom: 64 },
      tooltip: { ...tooltipBase(K), trigger: 'item', confine: true },
      xAxis: {
        type: 'time', min: lanesRange[0], max: lanesRange[1],
        axisLine: { lineStyle: { color: K.border } }, axisTick: { show: false },
        axisLabel: {
          color: K.text3, hideOverlap: true,
          formatter: (v) => (dt(v).getUTCHours() === 0 && dt(v).getUTCMinutes() === 0 ? `{d|${fDate(v)}}` : fHM(v)),
          rich: { d: { color: K.text2, fontWeight: 600 } },
        },
        splitLine: { show: true, lineStyle: { color: K.grid } },
      },
      yAxis: {
        type: 'category', data: L.overview.lanes, inverse: true,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: K.text2, fontSize: mobile ? 11 : 12.5 },
        splitLine: { show: true, lineStyle: { color: K.grid } },
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'weakFilter', minValueSpan: 20000 },
        {
          type: 'slider', xAxisIndex: 0, filterMode: 'weakFilter', height: 22, bottom: 14,
          borderColor: K.border, fillerColor: K.band, backgroundColor: 'transparent',
          dataBackground: { lineStyle: { color: K.border }, areaStyle: { color: K.surface2 } },
          handleStyle: { color: K.surface, borderColor: K.text3 }, moveHandleStyle: { color: K.border },
          textStyle: { color: K.text3 }, labelFormatter: (v) => fFull(v),
        },
      ],
      series: [
        {
          name: 'game', type: 'custom', renderItem: barItem(K.vgk, 0.46), encode: { x: [1, 2], y: 0 }, data: sess,
          ...(lanesMark ? { markLine: {
            silent: true, symbol: 'none', animation: false,
            lineStyle: { color: K.tpm, type: 'dashed', width: 1.5 },
            // 標籤放在圖表上方、橫的，才不會蓋住這個時間點旁邊的事件
            label: { position: 'start', distance: 6, rotate: 0, formatter: lanesMark.label, color: K.text, fontSize: 12, fontWeight: 600, backgroundColor: K.surface, borderColor: K.tpm, borderWidth: 1, borderRadius: 4, padding: [3, 8] },
            data: [{ xAxis: lanesMark.t }],
          } } : {}),
          tooltip: {
            formatter: (p) => {
              const s = D.sessions[p.value[3]];
              const rows = [[T.load, fFull(s.load)], [T.unload, s.unload ? fHMS(s.unload) : '—']];
              if (s.offset != null) rows.push([T.tpm, L.fmt.sec(s.offset)], [T.wifiState, L.states[s.state] || '—'], [T.result, L.outcomes[s.outcome]]);
              else rows.push([T.tpm, T.tpmNone]);
              const n = noteOf(s);
              return tip(n ? esc(n) : T.game, rows) + `<div style="opacity:.6;margin-top:4px;font-size:12px">${T.clickZoom}</div>`;
            },
          },
        },
        {
          name: 'conn', type: 'custom', renderItem: barItem(K.conn, 0.34), encode: { x: [1, 2], y: 0 }, data: connData,
          tooltip: { formatter: (p) => { const c = D.wlanConn[p.value[3]]; return tip(T.connTitle, [[T.net, netOf(c.net)], [T.connAt, fFull(c.start)], [T.discAt, c.end ? fFull(c.end) : T.stillConn], [T.duration, L.fmt.dur(((c.end || T1) - c.start) / 1000)]]); } },
        },
        {
          name: 'ap', type: 'custom', renderItem: barItem(K.text3, 0.34), encode: { x: [1, 2], y: 0 }, data: apData,
          tooltip: { formatter: (p) => { const c = D.ap[p.value[3]]; return tip(T.apTitle, [[T.start, fFull(c.start)], [T.stop, c.end ? fFull(c.end) : '—']]); } },
        },
        {
          name: 'tpm', type: 'scatter', symbol: 'diamond', symbolSize: 11,
          data: D.tpmBursts.map((b, i) => ({
            value: [b.start, 1, i],
            itemStyle: b.inSession ? { color: K.tpm, borderColor: K.surface, borderWidth: 1.5 } : { color: 'transparent', borderColor: K.tpm, borderWidth: 2 },
          })),
          tooltip: {
            formatter: (p) => {
              const b = D.tpmBursts[p.value[2]];
              return tip(b.inSession ? T.tpmIn : T.tpmOut, [
                [T.time, `${fDate(b.start)} ${fHMSm(b.start)}`],
                ['ID', T.events(b.n, b.ids.join('／'))],
                ...(b.ordinal ? [[T.command, b.ordinal === '378' ? 'TPM2_GetCapability' : `ordinal ${b.ordinal}`]] : []),
                ...(b.inSession ? [] : [[T.likely, T.likelyVal]]),
              ]);
            },
          },
        },
        {
          name: 'fail', type: 'scatter', symbol: 'triangle', symbolSize: 13,
          itemStyle: { color: K.fail, borderColor: K.surface, borderWidth: 1.5 },
          data: D.wifiFails.map((w, i) => [w.start, 2, i]),
          tooltip: { formatter: (p) => { const w = D.wifiFails[p.value[2]]; return tip(T.failTitle, [[T.first, `${fDate(w.start)} ${fHMSm(w.start)}`], ['×', T.retries(w.n)], [T.result, T.failResult]]); } },
        },
        {
          name: 'boot', type: 'scatter', symbol: 'rect', symbolSize: [2, 14], itemStyle: { color: K.boot },
          data: D.boots.map((b) => [b, 4]),
          tooltip: { formatter: (p) => tip(T.boot, [[T.time, fFull(p.value[0])]]) },
        },
      ],
    });

    chart.on('click', (p) => {
      if (p.seriesName !== 'game') return;
      const s = D.sessions[p.value[3]];
      const end = s.tpm ? Math.max(s.tpm, s.wifi || 0) + 120000 : (s.unload || s.load + 60000) + 60000;
      zoomLanes(s.load - 60000, end);
    });
    chart.on('datazoom', () => {
      const o = chart.getOption().dataZoom[0];
      if (o.startValue != null) lanesRange = [o.startValue, o.endValue];
      $$('#lane-presets .chip').forEach((c) => c.classList.remove('on'));
    });
    if (lanesRange[0] !== T0 || lanesRange[1] !== T1) chart.dispatchAction({ type: 'dataZoom', startValue: lanesRange[0], endValue: lanesRange[1] });
  };

  let lanesMark = null;   // { t, label }：從調查歷程跳過來時標出的時間點
  function zoomLanes(a, b, presetEl, mark) {
    lanesRange = [Math.max(a, T0), Math.min(b, T1)];
    lanesMark = mark || null;
    if (!drawn['chart-lanes']) { drawn['chart-lanes'] = true; chartObs.unobserve($('#chart-lanes')); }
    DRAW['chart-lanes'](false);   // 重畫才會套用標記；DRAW 結尾會縮放到 lanesRange
    $$('#lane-presets .chip').forEach((c) => c.classList.toggle('on', c === presetEl));
  }
  $$('#lane-presets .chip').forEach((c) => c.addEventListener('click', () => {
    const r = c.dataset.range;
    if (r === 'all') zoomLanes(T0, T1, c);
    if (r === 'peak') zoomLanes(Date.UTC(2026, 10, 6, 10, 0), Date.UTC(2026, 10, 7, 12, 0), c);
    if (r === 'week') zoomLanes(T1 - 7 * DAY, T1, c);
  }));

  // ---------- 110 秒對齊圖 ----------
  const withTpm = D.sessions.filter((s) => s.tpm);
  const XMAX = 172;
  DRAW['chart-offset'] = (animate) => {
    const K = css();
    const chart = mk('chart-offset');
    const mobile = innerWidth < 600;
    const T = L.tip;
    const labels = withTpm.map((s) => `${fDate(s.load)} ${fHM(s.load)}`);
    const sym = { broke: 'triangle', survived: 'circle', already_down: 'circle' };
    const data = withTpm.map((s, i) => {
      const over = s.offset > XMAX - 4;
      const n = noteOf(s);
      const st = s.outcome === 'already_down'
        ? { color: 'transparent', borderColor: K.boot, borderWidth: 2 }
        : { color: s.outcome === 'broke' ? K.fail : K.good, borderColor: K.surface, borderWidth: 1.5 };
      return {
        value: [over ? XMAX - 3 : s.offset, i], symbol: sym[s.outcome], symbolSize: s.outcome === 'broke' ? 12 : 10,
        itemStyle: st,
        label: over ? { show: true, position: 'left', formatter: `${L.fmt.dur(s.offset)} →`, color: K.text2, fontSize: 11 }
          : (n ? { show: !mobile, position: 'right', formatter: n.length > 22 ? n.slice(0, 21) + '…' : n, color: K.text3, fontSize: 11 } : { show: false }),
      };
    });
    chart.setOption({
      animation: animate && !reduceMotion, animationDuration: 700,
      animationDelay: (i) => i * 22, animationEasing: 'backOut',
      textStyle: { fontFamily: K.sans },
      grid: { left: lang === 'en' ? 96 : 86, right: 12, top: 30, bottom: 36 },
      tooltip: {
        ...tooltipBase(K), trigger: 'item', confine: true,
        formatter: (p) => {
          const s = withTpm[p.value[1]];
          const rows = [[T.load, fFull(s.load)], [T.tpm, L.fmt.sec(s.offset)], [T.wifiState, L.states[s.state]], [T.result, L.outcomes[s.outcome]]];
          if (s.lag != null) rows.push([T.lag, s.lag >= 0 ? T.later(s.lag) : T.earlier(Math.abs(s.lag))]);
          const n = noteOf(s);
          return tip(n ? esc(n) : labels[p.value[1]], rows);
        },
      },
      xAxis: {
        type: 'value', min: 100, max: XMAX, interval: 10, position: 'top',
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: K.text3, formatter: (v) => (v >= XMAX - 2 ? '' : v) },
        splitLine: { lineStyle: { color: K.grid } },
      },
      yAxis: {
        type: 'category', data: labels, inverse: true,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: K.text2, fontSize: 11.5, fontFamily: K.mono },
        splitLine: { show: false },
      },
      series: [{
        type: 'scatter', data,
        markArea: {
          silent: true, itemStyle: { color: K.band },
          label: { show: true, position: 'insideBottom', color: K.text3, fontSize: 11, formatter: L.timing.band },
          data: [[{ xAxis: 105 }, { xAxis: 125 }]],
        },
        markLine: {
          silent: true, symbol: 'none', lineStyle: { color: K.text3, type: 'dashed', width: 1 },
          label: { color: K.text3, fontSize: 11, formatter: L.timing.median(S.offsetMedian) },
          data: [{ xAxis: S.offsetMedian }],
        },
      }],
    });
  };

  // ---------- 毫秒／微秒順序 ----------
  const zooms = D.zooms.filter((z) => Math.abs(z.wifi - z.tpm) < 10000);
  const sel = $('#ms-sel');
  let msMode = 'ms';
  let msIdx = Math.max(0, zooms.findIndex((z) => dt(z.tpm).getUTCDate() === 7 && fHM(z.tpm) === '01:14'));
  function renderMsSelect() {
    sel.innerHTML = zooms.map((z, i) => `<option value="${i}">${esc(L.ms.option(fDate(z.tpm), fHMS(z.tpm), z.wifi >= z.tpm, Math.abs((z.wifi - z.tpm) / 1000).toFixed(2)))}</option>`).join('');
    sel.value = String(msIdx);
  }
  sel.addEventListener('change', () => { msIdx = +sel.value; if (drawn['chart-ms']) DRAW['chart-ms'](true); });
  $('#ms-mode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.dataset.mode === msMode) return;
    msMode = b.dataset.mode;
    $$('#ms-mode button').forEach((x) => x.classList.toggle('on', x === b));
    if (drawn['chart-ms']) DRAW['chart-ms'](true);
  });

  DRAW['chart-ms'] = (animate) => {
    const K = css();
    const chart = mk('chart-ms');
    const z = zooms[msIdx];
    const tpmEv = z.events.filter((e) => e.k === 'tpm').sort((a, b) => a.dt - b.dt);
    const wifiEv = z.events.filter((e) => e.k !== 'tpm');
    const lastUs = tpmEv[tpmEv.length - 1].dt;
    const lag = (z.wifi - z.tpm) / 1000;
    const T = L.tip;
    const base = {
      animation: animate && !reduceMotion, animationDuration: 600, animationDelay: (i) => i * 60, animationEasing: 'cubicOut',
      textStyle: { fontFamily: K.sans },
      tooltip: { ...tooltipBase(K), trigger: 'item', confine: true },
    };
    const yAxis = (cats) => ({
      type: 'category', data: cats, inverse: true,
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: K.text2 },
      splitLine: { show: true, lineStyle: { color: K.grid } },
    });
    const evTitle = (id) => (id === 14 ? T.ev14 : id === 17 ? T.ev17 : T.ev5002);

    if (msMode === 'ms') {
      const xs = [0, lastUs / 1000, ...wifiEv.map((e) => e.dt / 1000)];
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);
      const pad = Math.max(150, (hi - lo) * 0.14);
      chart.setOption({
        ...base,
        grid: { left: lang === 'en' ? 96 : 92, right: 28, top: 34, bottom: 46 },
        xAxis: {
          type: 'value', min: Math.floor((lo - pad) / 100) * 100, max: Math.ceil((hi + pad) / 100) * 100,
          name: L.ms.axisMs, nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: K.text3, fontSize: 11 },
          axisLine: { lineStyle: { color: K.border } }, axisTick: { show: false },
          axisLabel: { color: K.text3, formatter: (v) => (v > 0 ? `+${v}` : v) },
          splitLine: { lineStyle: { color: K.grid } },
        },
        yAxis: yAxis(L.ms.lanes),
        series: [
          {
            type: 'scatter', symbol: 'diamond', symbolSize: 18,
            itemStyle: { color: K.tpm, borderColor: K.surface, borderWidth: 2 },
            label: { show: true, position: 'top', distance: 8, color: K.text2, fontSize: 12, formatter: L.ms.burst(tpmEv.length, Math.round(lastUs)) },
            data: [[0, 0]],
            tooltip: { formatter: () => tip(L.ms.lanes[0], [[T.time, `${fHMSm(z.tpm)}`], ['ID', T.events(tpmEv.length, '14／17')], [T.rel, `0 – ${Math.round(lastUs)} μs`]]) },
            markLine: {
              silent: true, symbol: 'none', lineStyle: { color: K.text3, type: 'dashed' },
              label: { position: 'start', color: K.text2, fontSize: 11, formatter: (p) => (p.value === 0 ? L.ms.markTpm : L.ms.markWifi) },
              data: [{ xAxis: 0 }, { xAxis: Math.round(wifiEv[0].dt / 1000) }],
            },
          },
          {
            type: 'scatter', symbol: 'triangle', symbolSize: 16,
            itemStyle: { color: K.fail, borderColor: K.surface, borderWidth: 2 },
            data: wifiEv.map((e) => [e.dt / 1000, 1, e.id, e.t]),
            tooltip: { formatter: (p) => tip(evTitle(p.value[2]), [[T.time, fHMSm(p.value[3])], [T.rel, `${p.value[0] >= 0 ? '+' : ''}${p.value[0].toFixed(1)} ms`]]) },
          },
        ],
      });
      const span = Math.round(lastUs);
      $('#ms-caption').textContent = L.ms.caption({ date: fDate(z.tpm), at: ((z.tpm - z.load) / 1000).toFixed(1), n: tpmEv.length, us: span, lag });
    } else {
      const e14 = tpmEv.filter((e) => e.id === 14);
      const e17 = tpmEv.filter((e) => e.id === 17);
      const pts = (arr, lane) => arr.map((e, i) => ({ value: [e.dt, lane, e.id, i + 1] }));
      chart.setOption({
        ...base,
        grid: { left: lang === 'en' ? 96 : 92, right: 28, top: 34, bottom: 46 },
        xAxis: {
          type: 'value', min: -20, max: Math.ceil((lastUs + 30) / 50) * 50,
          name: L.ms.axisUs, nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: K.text3, fontSize: 11 },
          axisLine: { lineStyle: { color: K.border } }, axisTick: { show: false },
          axisLabel: { color: K.text3, formatter: (v) => (v > 0 ? `+${v}` : v) },
          splitLine: { lineStyle: { color: K.grid } },
        },
        yAxis: yAxis(L.ms.lanesUs),
        series: [14, 17].map((id, lane) => ({
          type: 'scatter', symbol: 'diamond', symbolSize: 15,
          itemStyle: lane === 0 ? { color: 'transparent', borderColor: K.tpm, borderWidth: 2.5 } : { color: K.tpm, borderColor: K.surface, borderWidth: 1.5 },
          label: lane === 0 ? { show: true, position: 'top', distance: 8, color: K.text3, fontSize: 11, formatter: (p) => L.ms.pair(p.value[3]) } : { show: false },
          data: pts(id === 14 ? e14 : e17, lane),
          tooltip: { formatter: (p) => tip(evTitle(p.value[2]), [[T.rel, `+${p.value[0].toFixed(1)} μs`], ['#', L.ms.pair(p.value[3])]]) },
        })),
      });
      const inner = e14.map((e, i) => (e17[i] ? e17[i].dt - e.dt : 0));
      const gaps = e14.slice(1).map((e, i) => e.dt - e14[i].dt);
      const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
      $('#ms-caption').textContent = L.ms.captionUs({
        pairs: e14.length, inner: `${Math.min(...inner).toFixed(1)}–${Math.max(...inner).toFixed(1)}`, gap: Math.round(avg(gaps)),
      });
    }
  };

  // =================================================================== story / hyp / test / gallery / table / footer
  function renderStory() {
    const box = $('#story-list');
    box.innerHTML = '';
    const W = 45 * 60000;
    const near = (t, x) => x >= t - W && x <= t + W;
    // 前後 45 分鐘內有遊戲、TPM 錯誤或網卡故障才值得跳過去看
    const hasNearby = (m) => (m.zoom ? zooms.some((z) => Math.abs(z.tpm - m.zoom) < 5000)
      : m.ms >= T0 && m.ms <= T1 && (D.sessions.some((s) => near(m.ms, s.load)) || D.tpmBursts.some((b) => near(m.ms, b.start)) || D.wifiFails.some((w) => near(m.ms, w.start))));
    D.phases.forEach((ph) => {
      const P = pText(ph);
      const items = D.milestones.filter((m) => m.phase === ph.id);
      const ol = items.map((m) => {
        const M = mText(m);
        const [vl, vc] = [L.story.verdicts[m.verdict], { fail: 'b-fail', pass: 'b-pass', key: 'b-key', info: 'b-info' }[m.verdict]];
        const hasTime = /T\d\d:\d\d/.test(m.t);
        const when = `${fDate(m.ms)}${hasTime ? ' ' + fHM(m.ms) : ''}`;
        const tags = (m.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
        const jump = hasNearby(m) ? `<button class="linkbtn" type="button" data-jump="${m.zoom || m.ms}" data-ms="${m.zoom ? 1 : 0}" data-title="${esc(M.title)}">${m.zoom ? L.story.jumpMs : L.story.jump}</button>` : '';
        return `<li class="v-${m.verdict}"><div class="mcard">
            <div class="mhead"><span class="mtime">${when}</span><span class="mtitle">${esc(M.title)}</span><span class="badge ${vc}">${vl}</span></div>
            <p class="mbody">${esc(M.body)}</p>
            ${tags || jump ? `<div class="mfoot">${tags}${jump}</div>` : ''}
            ${m.img ? `<img class="thumb" loading="lazy" src="${imgSrc(m.img)}" alt="${esc(M.title)}" data-cap="${esc(M.title)}">` : ''}
          </div></li>`;
      }).join('');
      box.insertAdjacentHTML('beforeend', `<div class="phase"><div class="phase-head"><h3>${esc(P.title)}</h3><span>${esc(P.sub)}</span></div><ol class="story">${ol}</ol></div>`);
    });
  }
  // 平滑捲動到某個元素；捲完沒到位（被其他捲動打斷、或延遲載入的圖片推開版面）就直接對齊
  function goTo(el, block = 'start') {
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block });
    setTimeout(() => {
      const r = el.getBoundingClientRect();
      const want = block === 'center' ? (innerHeight - r.height) / 2 : 60;
      if (Math.abs(r.top - want) > 40) el.scrollIntoView({ behavior: 'auto', block });
    }, 1000);
  }

  // 「回到調查歷程」：跳到圖表後出現在畫面底部，按了回到剛才那張卡片；捲回去看到那張卡片時自動消失
  const backPill = document.createElement('button');
  backPill.type = 'button'; backPill.className = 'back-pill'; backPill.hidden = true;
  document.body.appendChild(backPill);
  let backTo = null;
  // 那張卡片「先離開畫面、再回到畫面」才收起按鈕（不靠計時，捲動慢的時候也不會誤判）
  let backArmed = false;
  const backObs = new IntersectionObserver((en) => {
    const e = en[en.length - 1];
    if (!e) return;
    if (!e.isIntersecting) backArmed = true;
    else if (backArmed) hideBack();
  }, { threshold: 0.6 });
  function hideBack() { backPill.hidden = true; backObs.disconnect(); }
  function showBack(li) {
    backTo = li; backPill.textContent = L.story.back; backPill.hidden = false; backObs.disconnect();
    backArmed = false;
    backObs.observe(li);
  }
  backPill.addEventListener('click', () => {
    if (backTo) { goTo(backTo, 'center'); backTo.classList.add('flash'); setTimeout(() => backTo && backTo.classList.remove('flash'), 1600); }
    hideBack();
  });

  $('#story-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-jump]');
    if (!b) return;
    const t = +b.dataset.jump;
    showBack(b.closest('li'));
    if (b.dataset.ms === '1') {
      const i = zooms.findIndex((z) => Math.abs(z.tpm - t) < 5000);
      if (i >= 0) { msIdx = i; sel.value = String(i); if (drawn['chart-ms']) DRAW['chart-ms'](true); }
      goTo($('#ms'));
      return;
    }
    zoomLanes(t - 45 * 60000, t + 45 * 60000, null, { t, label: `${fHM(t)}  ${b.dataset.title}` });
    goTo($('#overview'));
  });

  function renderHyp() {
    $('#hyp-list').innerHTML = D.hypotheses.map((h, i) => {
      const H = hText(h, i);
      const [vl, vc] = h.verdict === 'pass' ? [L.hyp.pass, 'b-pass'] : [L.hyp.fail, 'b-fail'];
      return `<div class="h ${h.verdict}"><div class="row"><strong>${esc(H.name)}</strong><span class="badge ${vc}">${vl}</span></div><p>${esc(H.evidence)}</p></div>`;
    }).join('');
  }

  function colorTerm(txt) {
    return esc(txt).split('\n').map((ln) => {
      if (/^===/.test(ln)) return `<span class="hd">${ln}</span>`;
      if (/MATCH|符合/.test(ln)) return `<span class="bad">${ln}</span>`;
      if (/normally|正常回應/.test(ln)) return `<span class="ok">${ln}</span>`;
      if (/TPM failed|outside a Vanguard|不在 Vanguard/.test(ln)) return `<span class="warn">${ln}</span>`;
      if (/no TPM failure|game closed|too short|^\s*…/.test(ln)) return `<span class="dim">${ln}</span>`;
      return ln;
    }).join('\n');
  }
  function renderTest() {
    const T = L.test;
    $('#test-what').innerHTML = T.what.map((x) => `<li>${x}</li>`).join('');
    $('#test-safe').innerHTML = T.safe.map((x) => `<li>${x}</li>`).join('');
    $('#test-how').innerHTML = T.how.map((x) => `<li>${x}</li>`).join('');
    $('#test-pre').innerHTML = T.pre.map((x) => `<li>${x}</li>`).join('');
    $('#test-how-bat').innerHTML = T.howBat.map((x) => `<li>${x}</li>`).join('');
    $('#sample').innerHTML = colorTerm(window.SAMPLE_OUTPUT || '');
    const cls = ['match', 'possible', 'nomatch', 'nodata'];
    $('#test-results').innerHTML = T.results.map(([code, name, d], i) => `<div class="r ${cls[i]}"><code>${code}</code><strong>${esc(name)}</strong><p>${esc(d)}</p></div>`).join('');
    const DL = window.DOWNLOADS || {};
    if (DL.bat) $('#hash-bat').textContent = DL.bat.sha256;
    if (DL.ps1) $('#hash-ps1').textContent = DL.ps1.sha256;
    // 離線版：下載連結換成內嵌的 data: URL
    if (window.TIMELINE_FILES) {
      $('#dl-bat').href = window.TIMELINE_FILES.bat;
      $('#dl-ps1').href = window.TIMELINE_FILES.ps1;
    }
  }

  // ---------- 影響範圍 ----------
  const SOURCES = {
    amd: 'https://www.tomshardware.com/news/amd-issues-fix-and-workaround-for-ftpm-stuttering-issues',
    riot: 'https://support.riotgames.com/en-us/riot/client/tpm-20-guide',
    mstpm: 'https://learn.microsoft.com/en-us/windows/security/hardware-security/tpm/how-windows-uses-the-tpm',
    mslog: 'https://learn.microsoft.com/en-us/troubleshoot/windows-client/windows-security/tpm-device-driver-error-log',
    input: 'https://www.ginx.tv/en/valorant/valorant-s-anti-cheat-is-now-disabling-input-devices-users-report',
  };
  function renderImpact() {
    const I = L.impact;
    const src = (k) => (k ? ` <a href="${SOURCES[k]}" target="_blank" rel="noopener">${esc(I.srcLabel[k])} ↗</a>` : '');
    $('#impact-list').innerHTML = I.groups.map((g) => `<div class="grp">
        <div class="grp-head"><span class="lvl ${g.lvl}">${esc(g.badge)}</span><h3>${esc(g.title)}</h3></div>
        <p class="gd">${esc(g.desc)}</p>
        <ul>${g.items.map(([name, text, s]) => `<li><strong>${esc(name)}</strong><span>${fill(text, VARS)}</span>${src(s)}</li>`).join('')}</ul>
      </div>`).join('');
    $('#impact-sources').innerHTML = `${esc(I.srcTitle)} ` + Object.keys(SOURCES).map((k) => `<a href="${SOURCES[k]}" target="_blank" rel="noopener">${esc(I.srcLabel[k])}</a>`).join(' · ');
  }
  $('#cmd-copy').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    try { await navigator.clipboard.writeText($('#cmd-text').textContent); } catch {
      const r = document.createRange(); r.selectNodeContents($('#cmd-text')); getSelection().removeAllRanges(); getSelection().addRange(r);
    }
    b.textContent = L.test.copied; b.classList.add('done');
    setTimeout(() => { b.textContent = L.test.copy; b.classList.remove('done'); }, 1600);
  });

  const SHOTS = ['eventviewer-tpm', 'event17-details', 'tpm-failed', 'tpm-before', 'tpm-after', 'msinfo32', 'bios-1681'];
  function renderGallery() {
    $('#gallery').innerHTML = SHOTS.map((n) => {
      const [t, c] = L.shots.items[n];
      return `<figure data-img="${n}" data-cap="${esc(t)}"><img loading="lazy" src="${imgSrc(n)}" alt="${esc(t)}"><figcaption><b>${esc(t)}</b>${esc(c)}</figcaption></figure>`;
    }).join('');
  }
  const lb = $('#lightbox');
  const openLb = (src, cap) => { lb.querySelector('img').src = src; lb.querySelector('p').textContent = cap; lb.showModal(); };
  document.addEventListener('click', (e) => {
    const f = e.target.closest('#gallery figure');
    if (f) return openLb(imgSrc(f.dataset.img), f.dataset.cap);
    const t = e.target.closest('img.thumb');
    if (t) openLb(t.src, t.dataset.cap);
  });
  lb.addEventListener('click', () => lb.close());

  function renderTable() {
    $('#data-summary').textContent = L.data.summary(D.sessions.length);
    $('#session-table').innerHTML = `<thead><tr>${L.data.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>` +
      D.sessions.map((s) => `<tr><td>${fFull(s.load)}</td><td>${s.unload ? fHMS(s.unload) : '—'}</td><td>${s.offset != null ? L.fmt.sec(s.offset) : '—'}</td>` +
        `<td>${s.state ? esc(L.states[s.state]) : '—'}</td><td>${esc(L.outcomes[s.outcome])}</td><td class="note">${esc(noteOf(s))}</td></tr>`).join('') + '</tbody>';
  }
  function renderFooter() {
    $('#footer').innerHTML = L.footer({ sys: fFull(D.meta.systemLogOldest), wlan: fFull(D.meta.wlanLogOldest), exp: fFull(D.meta.exported) });
  }

  // =================================================================== 看自己的結果 / 匿名分享 / 大家的結果
  const OFFLINE = location.protocol === 'file:' || !!window.TIMELINE_FILES;
  const API = '/api';
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const SITEKEY = isLocalHost ? '1x00000000000000000000AA' : ((window.SITE_CONFIG || {}).turnstileSiteKey || '');
  let mine = null;        // 解析後的結果檔
  let tsToken = '';
  let tsWidget = null;
  let stats = null;

  // 結果檔解析、分享內容、判定規則都在 lib/result.js（伺服器和測試共用同一份）
  const { parseResult } = window.FTPM;
  const buildShare = (d) => window.FTPM.buildShare(d, lang);

  const drop = $('#drop');
  const fileIn = $('#file-in');
  const readFile = (f) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return showErr('big');
    const r = new FileReader();
    r.onload = () => {
      try { mine = parseResult(String(r.result)); showErr(null); renderMine(); } catch (e) { mine = null; $('#an-out').hidden = true; showErr(e.message === 'version' ? 'version' : 'parse'); }
    };
    r.readAsText(f, 'utf-8');
  };
  function showErr(k) { const el = $('#an-err'); el.hidden = !k; el.textContent = k ? L.an.err[k] : ''; }
  fileIn.addEventListener('change', () => readFile(fileIn.files[0]));
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => readFile(e.dataTransfer.files[0]));

  function renderMine() {
    if (!mine) return;
    const A = L.an;
    const d = mine;
    const fails = d.sessions.filter((s) => typeof s.off === 'number');
    const offs = fails.map((s) => s.off).sort((a, b) => a - b);
    const med = offs.length ? offs[Math.floor(offs.length / 2)] : null;
    const vcls = { MATCH: 'match', POSSIBLE: 'possible', NOMATCH: 'nomatch', NODATA: 'nodata' }[d.verdict];
    const vtxt = (L.test.results[{ MATCH: 0, POSSIBLE: 1, NOMATCH: 2, NODATA: 3 }[d.verdict]] || [])[1] || d.verdict;
    $('#an-head').innerHTML = `<div class="r ${vcls} an-verdict"><code>${d.verdict}</code><strong>${esc(vtxt)}</strong></div>` +
      [[d.loads, A.loads], [fails.length, A.fails], [med !== null ? med : '—', A.median], [d.outside, A.outside]]
        .map(([n, l]) => `<div class="tile"><div class="num">${esc(n)}</div><div class="lbl">${esc(l)}</div></div>`).join('');
    const others = {};
    fails.forEach((s) => (s.others || []).forEach((o) => { others[o] = (others[o] || 0) + 1; }));
    const oRows = Object.entries(others).sort((a, b) => b[1] - a[1]);
    const sys = [[A.cpu, d.cpu], [A.board, d.board], [A.bios, `${d.bios || '—'}${d.biosDate ? ` (${d.biosDate})` : ''}`], [A.tpm, d.tpm || A.noAdmin], [A.os, d.os], [A.tpmNow, d.tpmNow]];
    $('#an-side').innerHTML = `<h4>${esc(A.sysH)}</h4><table class="kv">${sys.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v ?? '—')}</td></tr>`).join('')}</table>` +
      `<h4>${esc(A.othersH)}</h4>` + (oRows.length ? `<table class="kv">${oRows.map(([k, n]) => `<tr><th><code>${esc(k)}</code></th><td>${esc(A.times(n))}</td></tr>`).join('')}</table>` : `<p class="small top0">${esc(A.noOthers)}</p>`) +
      (() => {
        const vg = Object.entries(window.FTPM.byVgk(d.sessions)).sort((a, b) => b[0].localeCompare(a[0]));
        return `<h4>${esc(A.vgkH)}</h4>` + (vg.length
          ? `<table class="kv">${vg.map(([k, g]) => `<tr><th><code>${esc(k.replace('T', ' ').replace('Z', ''))}</code></th><td>${esc(A.failedOf(g.failed, g.eligible))}</td></tr>`).join('')}</table>`
          : `<p class="small top0">${esc(A.noVgk)}</p>`);
      })() +
      (() => {
        // 只載入幾秒就卸載的（開 Riot Client 啟動器、更新時的短暫載入）：說明這是正常的
        const n = d.sessions.filter((s) => s.off === null && typeof s.dur === 'number' && s.dur < 10).length;
        return n ? `<h4>${esc(A.shortH)}</h4><p class="small top0">${esc(A.shortDesc(n))}</p>` : '';
      })() +
      (!d.amd ? `<p class="an-warn">${esc(A.notAmd)}</p>` : '');
    $('#an-out').hidden = false;
    drawn['chart-mine'] = true;
    DRAW['chart-mine'](true);
    renderShare();
  }

  DRAW['chart-mine'] = (animate) => {
    if (!mine) return;
    const K = css();
    const chart = mk('chart-mine');
    const rows = mine.sessions.filter((s) => typeof s.off === 'number');
    const XMAX = Math.min(600, Math.max(180, ...rows.map((s) => Math.ceil(s.off / 10) * 10 + 10)));
    $('#chart-mine').style.height = `${Math.max(180, 26 * rows.length + 70)}px`;
    chart.resize();
    chart.setOption({
      animation: animate && !reduceMotion, animationDuration: 600, animationDelay: (i) => i * 20,
      textStyle: { fontFamily: K.sans },
      grid: { left: 112, right: 16, top: 30, bottom: 20 },
      tooltip: { ...tooltipBase(K), trigger: 'item', confine: true, formatter: (p) => { const s = rows[p.value[1]]; return tip(s.t, [[L.tip.tpm, L.fmt.sec(s.off)], ...(s.vgk ? [[L.an.vgkH, esc(s.vgk.replace('T', ' ').replace('Z', ''))]] : []), ...(s.others.length ? [[L.an.othersH, s.others.map(esc).join('<br>')]] : [])]); } },
      xAxis: { type: 'value', min: 0, max: XMAX, position: 'top', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: K.text3 }, splitLine: { lineStyle: { color: K.grid } } },
      yAxis: { type: 'category', inverse: true, data: rows.map((s) => s.t.slice(5)), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: K.text2, fontFamily: K.mono, fontSize: 11 } },
      series: [{
        type: 'scatter',
        data: rows.map((s, i) => ({ value: [Math.min(s.off, XMAX - 2), i], label: s.off > XMAX - 2 ? { show: true, position: 'left', formatter: `${Math.round(s.off)} s →`, color: K.text2, fontSize: 11 } : { show: false }, symbol: s.others.length ? 'triangle' : 'diamond', symbolSize: s.others.length ? 13 : 11, itemStyle: { color: s.others.length ? K.fail : K.tpm, borderColor: K.surface, borderWidth: 1.5 } })),
        markArea: { silent: true, itemStyle: { color: K.band }, label: { show: true, position: 'insideBottom', color: K.text3, fontSize: 11, formatter: L.timing.band }, data: [[{ xAxis: 105 }, { xAxis: 125 }]] },
      }],
    });
  };

  // ---------- 分享 ----------
  function shMsg(k, extra = '') { const el = $('#sh-msg'); el.textContent = k ? `${L.sh.msg[k] || k}${extra}` : ''; el.dataset.kind = k || ''; }
  function syncSend() { $('#sh-send').disabled = !(mine && $('#sh-ok').checked && tsToken); }
  function renderShare() {
    if (!mine) return;
    $('#sh-json').textContent = JSON.stringify(buildShare(mine), null, 2);
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
    const r = await fetch(`${API}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `http_${r.status}`);
    return d;
  }
  $('#sh-send').addEventListener('click', async () => {
    const b = $('#sh-send');
    b.disabled = true;
    shMsg('sending');
    try {
      await post('submit', { token: tsToken, payload: buildShare(mine) });
      shMsg('sent');
      loadStats(true);
    } catch (e) { shMsg(L.sh.msg[e.message] ? e.message : 'fail', L.sh.msg[e.message] ? '' : ` (${e.message})`); }
    resetTs();
  });
  $('#sh-del').addEventListener('click', async () => {
    if (!mine) return;
    if (OFFLINE || !SITEKEY) return;
    if (!tsToken) { shMsg('needTs'); return; }
    if (!confirm(L.sh.confirmDel)) return;
    shMsg('sending');
    try {
      const d = await post('delete', { token: tsToken, id: mine.id });
      shMsg(d.deleted ? 'deleted' : 'notFound');
      loadStats(true);
    } catch (e) { shMsg(L.sh.msg[e.message] ? e.message : 'fail', ` (${e.message})`); }
    resetTs();
  });

  // ---------- 大家的結果 ----------
  async function loadStats(force) {
    if (OFFLINE) { renderStats(); return; }
    try {
      const r = await fetch(`${API}/stats${force ? `?t=${Date.now()}` : ''}`, { cache: force ? 'no-store' : 'default' });
      if (!r.ok) throw new Error(String(r.status));
      stats = await r.json();
    } catch { stats = { error: true }; }
    renderStats();
  }
  function renderStats() {
    const T = L.st;
    const empty = $('#st-empty');
    const body = $('#st-body');
    if (OFFLINE || !stats || stats.error || !stats.total) {
      body.hidden = true;
      empty.hidden = false;
      empty.innerHTML = `<p>${OFFLINE ? T.offline : !stats ? T.loading : stats.error ? T.error : T.empty}</p>` +
        (!OFFLINE && stats && !stats.error ? `<a class="btn btn-sm" href="#analyze">${esc(T.beFirst)} →</a>` : '');
      return;
    }
    empty.hidden = true;
    body.hidden = false;
    const S2 = stats;
    const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
    $('#st-tiles').innerHTML = [
      [S2.total, T.total],
      [S2.byVerdict.MATCH, T.match(pct(S2.byVerdict.MATCH, S2.total))],
      [S2.ftpm, T.ftpm],
      [S2.medianOffset ?? '—', T.median],
    ].map(([n, l]) => `<div class="tile"><div class="num">${esc(n)}</div><div class="lbl">${esc(l)}</div></div>`).join('');
    const table = (rows, cols) => `<thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>`;
    $('#st-others').innerHTML = S2.others.length
      ? table(S2.others.map((o) => `<tr><td><code>${esc(o.key)}</code></td><td>${o.pcs}</td></tr>`), [T.colEvent, T.colPcs])
      : `<tbody><tr><td class="note">${esc(T.noOthers)}</td></tr></tbody>`;
    const g = (arr) => arr.map((x) => `<tr><td>${esc(x.key)}</td><td>${x.n}</td><td>${x.match} (${pct(x.match, x.n)})</td><td>${x.median ?? '—'}</td></tr>`);
    $('#st-tpm').innerHTML = table(g(S2.byTpm), [T.colTpm, T.colPcs, T.colMatch, T.colMedian]);
    $('#st-board').innerHTML = table(g(S2.byBoard), [T.colBoard, T.colPcs, T.colMatch, T.colMedian]);
    const vg = S2.byVgk || [];
    $('#st-vgk').innerHTML = vg.length
      ? table(vg.map((x) => `<tr><td><code>${esc(x.key.replace('T', ' ').replace('Z', ''))}</code></td><td>${x.pcs}</td><td>${x.failed} / ${x.eligible} (${pct(x.failed, x.eligible)})</td><td>${x.median ?? '—'}</td></tr>`), [T.colVgk, T.colPcs, T.colRate, T.colMedian])
      : `<tbody><tr><td class="note">${esc(T.noVgk)}</td></tr></tbody>`;
    $('#st-vgk-note').textContent = S2.vgkUnknown ? T.vgkUnknown(S2.vgkUnknown) : '';
    $('#st-updated').textContent = T.updated(new Date(S2.updated).toLocaleString(L.meta.htmlLang));
    drawn['chart-hist'] = true;
    DRAW['chart-hist'](true);
  }
  DRAW['chart-hist'] = (animate) => {
    if (!stats || !stats.offsetBins || !stats.offsetBins.length) return;
    const K = css();
    const chart = mk('chart-hist');
    const bins = stats.offsetBins;
    chart.setOption({
      animation: animate && !reduceMotion,
      textStyle: { fontFamily: K.sans },
      grid: { left: 40, right: 12, top: 16, bottom: 36 },
      tooltip: { ...tooltipBase(K), trigger: 'item', formatter: (p) => tip(Number(p.name) >= 300 ? '300+ s' : `${p.name}–${Number(p.name) + 5} s`, [[L.st.colFails, p.value]]) },
      xAxis: { type: 'category', data: bins.map((b) => (b[0] >= 300 ? '300+' : b[0])), name: L.st.histX, nameLocation: 'middle', nameGap: 24, nameTextStyle: { color: K.text3, fontSize: 11 }, axisLabel: { color: K.text3 }, axisLine: { lineStyle: { color: K.border } }, axisTick: { show: false } },
      yAxis: { type: 'value', minInterval: 1, axisLabel: { color: K.text3 }, splitLine: { lineStyle: { color: K.grid } } },
      series: [{ type: 'bar', data: bins.map((b) => b[1]), itemStyle: { color: K.tpm, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 28 }],
    });
  };
  new IntersectionObserver((en, obs) => { if (en[0].isIntersecting) { obs.disconnect(); loadStats(false); } }, { rootMargin: '200px' }).observe($('#stats'));

  function renderCommunity() {
    if (mine) renderMine();
    renderStats();
  }

  // =================================================================== render all
  function renderAll(first) {
    applyStatic();
    requestAnimationFrame(syncNav);
    renderSteps();
    renderHero();
    renderMatrix();
    renderMsSelect();
    renderStory();
    renderHyp();
    renderTest();
    renderImpact();
    renderCommunity();
    renderGallery();
    renderTable();
    renderFooter();
    if (first) {
      ['chart-lanes', 'chart-offset', 'chart-ms'].forEach((id) => chartObs.observe(document.getElementById(id)));
      if (reduceMotion) $$('.reveal').forEach((el) => el.classList.add('in'));
    } else {
      redrawCharts(false);
      if (counted) countUp();
    }
  }
  renderAll(true);
})();
