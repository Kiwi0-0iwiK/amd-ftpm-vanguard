// 部署前跑：node tests/run.mjs
// 用固定的結果檔（tests/fixtures，各個格式版本都有）確認：解析、分享內容、伺服器驗證、判定重算、統計都正確。
// 之後改了腳本或規則，新增一個對應的 fixture，舊的不要刪：舊版結果檔也必須一直讀得懂。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const FTPM = createRequire(import.meta.url)(join(root, 'site/lib/result.js'));
const { normalize, aggregate, readJson } = await import(pathToFileURL(join(root, 'server/lib.js')));

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };
const fixture = (name) => FTPM.parseResult(readFileSync(join(here, 'fixtures', name), 'utf8'));
const store = (d) => { const r = normalize(FTPM.buildShare(d, 'zh-TW')); return { updated: '2026-01-01T00:00:00Z', verdict: r.verdict, data: JSON.stringify(r) }; };

console.log('result.js');
test('parse rejects text without the data block', () => assert.throws(() => FTPM.parseResult('hello'), /nomarker/));
test('parse rejects unknown format versions', () => assert.throws(() => FTPM.parseResult('-----BEGIN FTPM-CHECK-----\n{"v":9,"sessions":[]}\n-----END FTPM-CHECK-----'), /version/));
for (const f of readdirSync(join(here, 'fixtures'))) test(`parse ${f}`, () => assert.ok(fixture(f).sessions.length > 0));
test('parse cleans a hand-edited (malicious) result file before the page puts it into HTML', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const d = FTPM.parseResult(`-----BEGIN FTPM-CHECK-----\n${JSON.stringify({
    v: 2, verdict: evil, sessions: [
      { t: evil, off: 110, dur: 300, others: [evil, { x: 1 }, 5], vgk: { toString: 1 } },
      { t: 12345, off: '<b>', dur: 'long', others: 'nope', vgk: 7 },
      null, 'str', [1],
    ],
  })}\n-----END FTPM-CHECK-----`);
  assert.equal(d.verdict, 'NODATA');
  assert.equal(d.sessions.length, 2);
  assert.deepEqual(d.sessions[0].others, [evil]);              // 字串留著（畫面跳脫），其他型別丟掉
  assert.equal(d.sessions[0].vgk, null);
  assert.deepEqual([d.sessions[1].t, d.sessions[1].off, d.sessions[1].dur, d.sessions[1].vgk], ['', null, null, null]);
  assert.deepEqual(d.sessions[1].others, []);
  for (const v of FTPM.VERDICTS) assert.equal(FTPM.parseResult(`-----BEGIN FTPM-CHECK-----{"v":2,"verdict":"${v}","sessions":[]}-----END FTPM-CHECK-----`).verdict, v);
});
test('the investigation page escapes result-file fields it puts into HTML', () => {
  const app = readFileSync(join(root, 'site/app.js'), 'utf8');
  assert.equal(app.includes('${d.verdict}'), false, 'raw verdict in a template');
  assert.match(app, /tip\(esc\(s\.t\)/);
  assert.match(app, /s\.others\.map\(esc\)/);
});
test('share drops per-session times', () => {
  const s = FTPM.buildShare(fixture('v2.txt'), 'en');
  assert.equal(JSON.stringify(s).includes('2026-11-0'), false);
  assert.equal(s.offsets.length, s.failed);
});
test('v1 without TPM info shares ftpm as unknown (null), not false', () => assert.equal(FTPM.buildShare(fixture('v1-noadmin.txt')).ftpm, null));
test('v1 with TPM info keeps ftpm true', () => assert.equal(FTPM.buildShare(fixture('v1-admin.txt')).ftpm, true));
test('rule: 2+ failures and at least half of eligible sessions = MATCH', () => assert.equal(FTPM.deriveVerdict({ failed: 2, eligible: 4 }), 'MATCH'));
test('rule: 1 failure = POSSIBLE', () => assert.equal(FTPM.deriveVerdict({ failed: 1, eligible: 10 }), 'POSSIBLE'));
test('rule: failures in under half of eligible sessions = POSSIBLE', () => assert.equal(FTPM.deriveVerdict({ failed: 2, eligible: 5 }), 'POSSIBLE'));
test('rule: no failures, 2+ eligible = NOMATCH', () => assert.equal(FTPM.deriveVerdict({ failed: 0, eligible: 2 }), 'NOMATCH'));
test('share groups sessions by Vanguard build (2026.11.22+)', () => {
  const s = FTPM.buildShare(fixture('v2-vgk.txt'));
  const builds = Object.keys(s.vgk);
  assert.ok(builds.length >= 2);
  assert.ok(builds.every((k) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(k)));
  const sum = (f) => Object.values(s.vgk).reduce((n, g) => n + g[f], 0);
  assert.equal(sum('failed'), s.failed);   // 每一場出錯都算進某一版
  assert.equal(sum('eligible'), fixture('v2-vgk.txt').eligible);
});
test('older result files share an empty Vanguard breakdown', () => assert.deepEqual(FTPM.buildShare(fixture('v2.txt')).vgk, {}));
test('page verdict uses the current rule, not the one written in the file', () => {
  assert.equal(FTPM.verdictOf(fixture('v2-claims-match.txt')), 'POSSIBLE');
  assert.equal(FTPM.verdictOf(fixture('v2.txt')), 'MATCH');
});
test('page median matches the script (lower middle for an even count)', () => {
  assert.equal(FTPM.medianOf([125, 105, 118, 111]), 111);
  assert.equal(FTPM.medianOf([120, 110, 130]), 120);
  assert.equal(FTPM.medianOf([]), null);
});
test('short sessions without a failure are not counted for a build', () => {
  const g = FTPM.byVgk([{ vgk: 'X', off: null, dur: 30 }, { vgk: 'X', off: null, dur: 900 }, { vgk: 'X', off: 110, dur: 200 }]);
  assert.deepEqual(g.X, { eligible: 2, failed: 1, offsets: [110] });
});

console.log('server');
test('normalize recomputes the verdict instead of trusting the file', () => {
  const r = normalize(FTPM.buildShare(fixture('v2-claims-match.txt')));
  assert.equal(r.verdictReported, 'MATCH');
  assert.equal(r.verdict, 'POSSIBLE');
  assert.equal(r.rule, FTPM.RULE);
});
test('normalize keeps the script version', () => assert.equal(normalize(FTPM.buildShare(fixture('v2.txt'))).sv, '2026.11.21'));
test('normalize rejects a bad id', () => assert.throws(() => normalize({ ...FTPM.buildShare(fixture('v2.txt')), id: 'nope' }), /bad_id/));
test('normalize drops malformed Vanguard builds', () => {
  const p = FTPM.buildShare(fixture('v2-vgk.txt'));
  const r = normalize({ ...p, vgk: { ...p.vgk, 'not-a-date': { eligible: 1, failed: 0, offsets: [] }, '2026-01-01T00:00:00Z': { eligible: 1, failed: 5, offsets: [] } } });
  assert.equal(Object.keys(r.vgk).length, Object.keys(p.vgk).length);
});
test('normalize drops impossible offsets', () => {
  const p = FTPM.buildShare(fixture('v2.txt'));
  assert.equal(normalize({ ...p, offsets: [-5, 120, 99999] }).offsets.join(), '120');
});

test('normalize rejects more failures than eligible sessions', () => {
  const p = FTPM.buildShare(fixture('v2.txt'));
  assert.throws(() => normalize({ ...p, eligible: p.failed - 1 }), /inconsistent/);
});
{
  // 請求本文的大小上限：沒有 content-length 的分塊傳送也要擋
  const atest = async (name, fn) => { await fn(); passed++; console.log(`  ok  ${name}`); };
  const post = (body, headers = {}) => new Request('https://example.test/api/submit', { method: 'POST', body, headers, duplex: 'half' });
  const stream = (bytes) => new ReadableStream({ start(c) { for (let i = 0; i < bytes; i += 1024) c.enqueue(new Uint8Array(Math.min(1024, bytes - i)).fill(32)); c.close(); } });
  await atest('readJson parses a small body', async () => assert.deepEqual(await readJson(post('{"a":1}')), { a: 1 }));
  await atest('readJson rejects a large content-length', async () => assert.rejects(readJson(post('{}', { 'content-length': '999999' }), 100), /too_large/));
  await atest('readJson stops a chunked body without content-length', async () => assert.rejects(readJson(post(stream(50000)), 32768), /too_large/));
  await atest('readJson reports bad JSON', async () => assert.rejects(readJson(post('{oops')), /bad_json/));
}

console.log('aggregate');
const rows = readdirSync(join(here, 'fixtures')).map((f) => store(fixture(f)));
const a = aggregate(rows);
test('counts every fixture once', () => assert.equal(a.total, rows.length));
test('verdicts are recomputed with the current rule', () => assert.deepEqual(a.byVerdict, { MATCH: 4, POSSIBLE: 1, NOMATCH: 1, NODATA: 0 }));
test('unknown fTPM is not counted as "no fTPM"', () => { assert.equal(a.ftpmUnknown, 1); assert.equal(a.ftpm, rows.length - 1); });
test('groups by script version', () => {
  const m = Object.fromEntries(a.byScript.map((g) => [g.key, g.n]));
  assert.equal(m['v1 (2026.11.19)'], 2);
  assert.equal(m['2026.11.21'], 3);
  assert.equal(m['2026.11.22'], 1);
});
test('aggregates by Vanguard build; older files count as unknown', () => {
  assert.ok(a.byVgk.length >= 2);
  assert.equal(a.vgkUnknown, rows.length - 1);
  for (const g of a.byVgk) assert.ok(g.failed <= g.eligible && g.pcs === 1);
});
test('histogram has a 300+ bucket instead of dropping long delays', () => {
  const b = aggregate([store({ ...fixture('v2.txt'), sessions: [{ t: 'x', off: 950, dur: 1800, ended: true, others: [] }, { t: 'x', off: 120, dur: 1800, ended: true, others: [] }] })]);
  assert.ok(b.offsetBins.some(([k]) => k === 300));
});

console.log('i18n');
{
  // 首頁文字（i18n/home.js）三種語言的結構要一樣，少一個 key 頁面就會出現空白
  globalThis.window = { I18N: {} };
  const req = createRequire(import.meta.url);
  for (const f of ['zh-TW', 'zh-CN', 'en', 'home']) req(join(root, `site/i18n/${f}.js`));
  const shape = (o) => (Array.isArray(o) ? o.map(shape) : o && typeof o === 'object'
    ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, shape(o[k])])) : typeof o);
  const I = globalThis.window.I18N;
  test('home text has the same keys in every language', () => {
    assert.deepEqual(shape(I['zh-CN'].home), shape(I['zh-TW'].home));
    assert.deepEqual(shape(I.en.home), shape(I['zh-TW'].home));
  });
  test('verdict sentences exist for every verdict', () => {
    for (const l of ['zh-TW', 'zh-CN', 'en']) for (const v of ['MATCH', 'POSSIBLE', 'NOMATCH', 'NODATA']) {
      assert.equal(typeof I[l].home.an.res[v][1]({ f: 3, e: 4, med: 110 }), 'string');
    }
  });
  test('home page keys used from the shared files exist', () => {
    for (const l of ['zh-TW', 'zh-CN', 'en']) {
      assert.equal(typeof I[l].home.an.named('x', 'y'), 'string', `${l} home.an.named`);
      assert.equal(typeof I[l].home.an.sep, 'string', `${l} home.an.sep`);
      for (const k of ['drop', 'shortDesc', 'notAmd', 'sysH', 'vgkH', 'failedOf']) assert.ok(I[l].an[k], `${l} an.${k}`);
      for (const k of ['send', 'delete', 'privacy', 'wdDesc', 'confirmDel', 'msg']) assert.ok(I[l].sh[k], `${l} sh.${k}`);
      assert.ok(I[l].ui.nav.home, `${l} ui.nav.home`);
    }
  });
  test('every data-i / data-i-label key in the pages exists in every language', () => {
    const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
    for (const page of ['index.html', 'investigation.html']) {
      const html = readFileSync(join(root, 'site', page), 'utf8');
      const keys = [...html.matchAll(/data-i(?:-label)?="([^"]+)"/g)].map((m) => m[1]);
      assert.ok(keys.length > 20, page);
      for (const l of ['zh-TW', 'zh-CN', 'en']) for (const k of keys) assert.equal(typeof get(I[l], k), 'string', `${page}: ${l} ${k}`);
    }
  });
  test('scrollable boxes are keyboard-focusable labelled regions', () => {
    const html = readFileSync(join(root, 'site', 'investigation.html'), 'utf8');
    const boxes = html.match(/<(?:div class="tablewrap"|pre class="term"|code id="cmd-text")[^>]*>/g);
    assert.ok(boxes.length >= 7);
    for (const b of boxes) assert.match(b, /tabindex="0" role="region" data-i-label=/, b);
    for (const c of html.match(/<div id="chart-[^"]+" class="chart"[^>]*>/g)) assert.match(c, /role="img" data-i-label="a11y\.\w+" aria-describedby=/, c);
  });
}

console.log(`\n${passed} passed`);
