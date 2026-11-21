// POST /api/submit  { token, payload }  → 存一筆匿名結果（同一個 id 覆蓋）
import { json, normalize, verifyTurnstile, rateLimit, bumpStats } from '../../server/lib.js';

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'no_db' }, 503);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  let body;
  try {
    if (Number(request.headers.get('content-length') || 0) > 32768) return json({ error: 'too_large' }, 413);
    body = await request.json();
  } catch { return json({ error: 'bad_json' }, 400); }

  const ts = await verifyTurnstile(env, body?.token, ip);
  if (!ts.ok) return json({ error: ts.error }, ts.error === 'not_configured' ? 503 : 403);
  if (!(await rateLimit(env, ip))) return json({ error: 'rate_limited' }, 429);

  let rec;
  try { rec = normalize(body.payload); } catch (e) { return json({ error: e.message }, 400); }
  const id = body.payload.id;
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO results (id, updated, verdict, data) VALUES (?1, ?2, ?3, ?4) ' +
    'ON CONFLICT(id) DO UPDATE SET updated = excluded.updated, verdict = excluded.verdict, data = excluded.data',
  ).bind(id, now, rec.verdict, JSON.stringify(rec)).run();
  await bumpStats(env);
  return json({ ok: true, id, updated: now });
}
