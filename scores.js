// Shared leaderboard for the Offerwall team day.
// GET  /api/scores  -> list of everyone's score (best first)
// POST /api/scores  -> saves {name, score, total}; only the FIRST score per name is kept
const BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'ow:scores';

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

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!BASE || !TOKEN) return res.status(500).json({ error: 'storage not connected' });
  try {
    if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
      b = b || {};
      const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 20);
      const score = Number(b.score), total = Number(b.total);
      if (name.length < 2 || !Number.isInteger(score) || !Number.isInteger(total) ||
          total < 1 || total > 50 || score < 0 || score > total) {
        return res.status(400).json({ error: 'bad input' });
      }
      const added = await redis(['HSETNX', KEY, name.toLowerCase(),
        JSON.stringify({ name, score, total, t: Date.now() })]);
      return res.status(200).json({ ok: true, saved: added === 1 });
    }
    let flat = (await redis(['HGETALL', KEY])) || [];
    if (!Array.isArray(flat)) flat = Object.entries(flat).flat();
    const list = [];
    for (let i = 1; i < flat.length; i += 2) {
      try { list.push(JSON.parse(flat[i])); } catch (e) { /* skip bad row */ }
    }
    list.sort((a, b) => b.score - a.score || a.t - b.t);
    return res.status(200).json(list.slice(0, 100));
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
};
