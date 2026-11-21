// POST /api/delete  { token, id }  → 刪除這台電腦分享過的結果
import { json, verifyTurnstile, rateLimit, bumpStats } from '../../server/lib.js';

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'no_db' }, 503);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const ts = await verifyTurnstile(env, body?.token, ip);
  if (!ts.ok) return json({ error: ts.error }, ts.error === 'not_configured' ? 503 : 403);
  if (!(await rateLimit(env, ip))) return json({ error: 'rate_limited' }, 429);
  if (typeof body.id !== 'string' || !/^[0-9a-f]{16}$/.test(body.id)) return json({ error: 'bad_id' }, 400);
  const r = await env.DB.prepare('DELETE FROM results WHERE id = ?1').bind(body.id).run();
  await bumpStats(env);
  return json({ ok: true, deleted: r.meta?.changes ?? 0 });
}
