// GET /api/stats  → 公開統計（只有加總）。快取 5 分鐘，避免每次都把整張表讀一遍。
// GET /api/stats?download=1  → 同樣內容，以檔案下載（方便整理給 AMD／Riot）
import { json, aggregate, statsCacheKey, statsVersion } from '../../server/lib.js';

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.DB) return json({ error: 'no_db' }, 503);
  const url = new URL(request.url);
  const download = url.searchParams.get('download') === '1';
  const cacheKey = statsCacheKey(request, await statsVersion(env));
  const cache = caches.default;
  let stats;
  const hit = await cache.match(cacheKey);
  if (hit) stats = await hit.json();
  else {
    const { results } = await env.DB.prepare('SELECT updated, verdict, data FROM results').all();
    stats = aggregate(results || []);
    waitUntil(cache.put(cacheKey, json(stats, 200, { 'cache-control': 'public, max-age=300' })));
  }
  const extra = download
    ? { 'content-disposition': `attachment; filename="amd-ftpm-vanguard-stats-${stats.updated.slice(0, 10)}.json"` }
    : { 'cache-control': 'no-cache' };
  return json(stats, 200, extra);
}
