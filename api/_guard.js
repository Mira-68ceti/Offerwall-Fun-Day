// Shared helpers: owner code check (code lives only in the OWNER_CODE setting in Vercel), round clock, wrong-code limiter.
const crypto = require('crypto');

const findEnv = (suffix) => {
  const k = Object.keys(process.env).find((n) => n.endsWith(suffix) && !n.includes('READ_ONLY'));
  return k ? process.env[k] : undefined;
};
const BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || findEnv('_REST_API_URL') || findEnv('_REST_URL');
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || findEnv('_REST_API_TOKEN') || findEnv('_REST_TOKEN');

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

// Round opening times. 14.12.2026 at 16:00 and 18:00 Israel time (UTC+2 in December).
// For a rehearsal you can set R1_AT / R2_AT in Vercel (e.g. 2026-11-20T14:00:00Z); remove them before the event.
const AT = (envName, fallback) => {
  const v = process.env[envName];
  const t = v ? Date.parse(v) : NaN;
  return isNaN(t) ? fallback : t;
};
const ROUND_AT = {
  1: AT('R1_AT', Date.UTC(2026, 11, 14, 14, 0, 0)),
  2: AT('R2_AT', Date.UTC(2026, 11, 14, 16, 0, 0)),
};
const roundOpen = (r) => Date.now() >= ROUND_AT[r];

const safeEq = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

const ipOf = (req) => String((req.headers['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || 'x').trim().slice(0, 64);

// Returns 'ok' | 'bad' | 'none' | 'limited'. 'none' = no code sent.
async function checkOwner(req) {
  const code = String(req.headers['x-owner'] || '').trim();
  const real = process.env.OWNER_CODE;
  if (!code || !real) return 'none';
  const key = 'ow:rl:' + ipOf(req);
  try {
    const n = Number(await redis(['GET', key])) || 0;
    if (n >= 8) return 'limited';
  } catch (e) { /* if storage is down, still allow a correct code */ }
  if (safeEq(code, real)) return 'ok';
  try { await redis(['INCR', key]); await redis(['EXPIRE', key, '600']); } catch (e) { /* ignore */ }
  return 'bad';
}

module.exports = { redis, ROUND_AT, roundOpen, checkOwner };
