// Carpool coordination for the Offerwall team day.
// GET  /api/ride -> { people: { "<name>": {r:'driver',s:seats} | {r:'rider',c:'<driver>'} | {r:'need'} | {r:'own'} } }
// POST /api/ride -> { action, name, param }  actions: driver | join | need | own | clear | kick

// Finds the database settings whatever prefix was chosen when connecting it in Vercel.
const findEnv = (suffix) => {
  const k = Object.keys(process.env).find((n) => n.endsWith(suffix) && !n.includes('READ_ONLY'));
  return k ? process.env[k] : undefined;
};
const BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || findEnv('_REST_API_URL') || findEnv('_REST_URL');
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || findEnv('_REST_API_TOKEN') || findEnv('_REST_TOKEN');
const BASE_KEY = 'ow:ride';
// ?ns=test keeps a separate set of rides, used for rehearsals.
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

// Only one change at a time, so two people can never take the last seat together.
async function withLock(LOCK, fn) {
  for (let i = 0; i < 25; i++) {
    const ok = await redis(['SET', LOCK, '1', 'NX', 'PX', '4000']);
    if (ok === 'OK') {
      try { return await fn(); } finally { try { await redis(['DEL', LOCK]); } catch (e) { /* lock expires on its own */ } }
    }
    await sleep(80 + Math.random() * 120);
  }
  throw new Error('busy');
}

async function readAll(KEY) {
  let flat = (await redis(['HGETALL', KEY])) || [];
  if (!Array.isArray(flat)) flat = Object.entries(flat).flat();
  const people = {};
  for (let i = 0; i + 1 < flat.length; i += 2) {
    try { people[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { /* skip bad row */ }
  }
  return people;
}

const ridersOf = (m, driver) => Object.keys(m).filter((n) => m[n].r === 'rider' && m[n].c === driver);
const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 24);

async function act(KEY, action, name, param) {
  return withLock(KEY + ':lock', async () => {
    const m = await readAll(KEY);
    const me = m[name];
    const myRiders = me && me.r === 'driver' ? ridersOf(m, name) : [];
    if (action === 'driver') {
      const seats = Number(param);
      if (!Number.isInteger(seats) || seats < 1 || seats > 8) return 'bad';
      if (myRiders.length > seats) return 'seats_low';
      await redis(['HSET', KEY, name, JSON.stringify({ r: 'driver', s: seats })]);
      return 'ok';
    }
    if (action === 'join') {
      const d = m[param];
      if (!d || d.r !== 'driver' || param === name) return 'no_car';
      if (me && me.r === 'rider' && me.c === param) return 'ok';
      if (myRiders.length > 0) return 'has_riders';
      if (ridersOf(m, param).length >= d.s) return 'full';
      await redis(['HSET', KEY, name, JSON.stringify({ r: 'rider', c: param })]);
      return 'ok';
    }
    if (action === 'need') {
      if (myRiders.length > 0) return 'has_riders';
      await redis(['HSET', KEY, name, JSON.stringify({ r: 'need' })]);
      return 'ok';
    }
    if (action === 'own') {
      if (myRiders.length > 0) return 'has_riders';
      await redis(['HSET', KEY, name, JSON.stringify({ r: 'own' })]);
      return 'ok';
    }
    if (action === 'clear') {
      for (const rn of myRiders) await redis(['HDEL', KEY, rn]);
      await redis(['HDEL', KEY, name]);
      return 'ok';
    }
    if (action === 'kick') {
      const o = m[param];
      if (o && o.r === 'rider' && o.c === name) await redis(['HDEL', KEY, param]);
      return 'ok';
    }
    return 'bad';
  });
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
      const name = clean(b.name), param = clean(b.param);
      if (name.length < 2) return res.status(400).json({ ok: false, code: 'bad' });
      const code = await act(KEY, String(b.action || ''), name, param);
      return res.status(200).json({ ok: code === 'ok', code });
    }
    return res.status(200).json({ people: await readAll(KEY) });
  } catch (e) {
    return res.status(500).json({ error: e.message === 'busy' ? 'busy' : 'server error' });
  }
};
