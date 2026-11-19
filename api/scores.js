// Shared leaderboard for the Offerwall team day. Two rounds; the FIRST score per person per round is kept.
// GET  /api/scores  -> [{name, score, total, r1, r2, t}] best total first
// POST /api/scores  -> {name, round: 1|2, score, total}

// Finds the database settings whatever prefix was chosen when connecting it in Vercel.
const findEnv = (suffix) => {
  const k = Object.keys(process.env).find((n) => n.endsWith(suffix) && !n.includes('READ_ONLY'));
  return k ? process.env[k] : undefined;
};
const BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || findEnv('_REST_API_URL') || findEnv('_REST_URL');
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || findEnv('_REST_API_TOKEN') || findEnv('_REST_TOKEN');
const BASE_KEY = 'ow:scores';
// ?ns=test keeps a separate table, used for rehearsals.
const nsOf = (req) => String((req.query && req.query.ns) || '').replace(/[^a-z0-9]/gi, '').slice(0, 12);

async function redis(command) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'storage error');
  return j.result;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withLock(LOCK, fn) {
  for (let i = 0; i < 25; i++) {
    const ok = await redis(['SET', LOCK, '1', 'NX', 'PX', '4000']);
    if (ok === 'OK') {
      try { return await fn(); } finally { try { await redis(['DEL', LOCK]); } catch (e) { /* expires on its own */ } }
    }
    await sleep(80 + Math.random() * 120);
  }
  throw new Error('busy');
}

// Older records were saved as {name, score, total}; treat those as round 1.
function normalize(rec) {
  if (!rec.r1 && rec.score != null && rec.total != null && !rec.r2) rec.r1 = { score: rec.score, total: rec.total };
  const r1 = rec.r1 || null, r2 = rec.r2 || null;
  return {
    name: rec.name, r1, r2, t: rec.t || 0,
    score: (r1 ? r1.score : 0) + (r2 ? r2.score : 0),
    total: (r1 ? r1.total : 0) + (r2 ? r2.total : 0),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!BASE || !TOKEN) return res.status(500).json({ error: 'storage not connected' });
  const ns = nsOf(req);
  const KEY = BASE_KEY + (ns ? ':' + ns : '');
  try {
    if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
      b = b || {};
      const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 20);
      const round = Number(b.round || 1), score = Number(b.score), total = Number(b.total);
      if (name.length < 2 || (round !== 1 && round !== 2) || !Number.isInteger(score) || !Number.isInteger(total) ||
          total < 1 || total > 50 || score < 0 || score > total) {
        return res.status(400).json({ error: 'bad input' });
      }
      const field = name.toLowerCase();
      const saved = await withLock(KEY + ':lock', async () => {
        const raw = await redis(['HGET', KEY, field]);
        let rec = raw ? JSON.parse(raw) : { name, t: Date.now() };
        if (raw && !rec.r1 && rec.score != null && !rec.r2) rec.r1 = { score: rec.score, total: rec.total };
        if (rec['r' + round]) return false;            // first score of each round only
        rec['r' + round] = { score, total };
        delete rec.score; delete rec.total;
        await redis(['HSET', KEY, field, JSON.stringify(rec)]);
        return true;
      });
      return res.status(200).json({ ok: true, saved });
    }
    let flat = (await redis(['HGETALL', KEY])) || [];
    if (!Array.isArray(flat)) flat = Object.entries(flat).flat();
    const list = [];
    for (let i = 1; i < flat.length; i += 2) {
      try { list.push(normalize(JSON.parse(flat[i]))); } catch (e) { /* skip bad row */ }
    }
    list.sort((a, b) => b.score - a.score || a.t - b.t);
    return res.status(200).json(list.slice(0, 100));
  } catch (e) {
    return res.status(500).json({ error: e.message === 'busy' ? 'busy' : 'server error' });
  }
};
