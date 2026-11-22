// GET /api/quiz            -> {r1: bool, r2: bool, owner: bool}   (which rounds are open; header x-owner = owner code)
// GET /api/quiz?round=1|2  -> {round, qs, prizes}   only if that round is open, or the owner code is sent
// GET /api/quiz?stops=1    -> {stops}               owner only
const { ROUND_AT, roundOpen, leaveOpen, checkOwner } = require('./_guard');
const { STOPS, PRIZES, QUIZ } = require('./_data');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const who = await checkOwner(req);
    if (who === 'limited') return res.status(429).send(JSON.stringify({ error: 'limited' }));
    const owner = who === 'ok';
    const q = req.query || {};
    if (q.stops) {
      if (!owner) return res.status(403).send(JSON.stringify({ error: 'no' }));
      return res.status(200).send(JSON.stringify({ stops: STOPS }));
    }
    if (q.round) {
      const r = Number(q.round);
      if (r !== 1 && r !== 2) return res.status(400).send(JSON.stringify({ error: 'bad round' }));
      if (!owner && !roundOpen(r)) return res.status(403).send(JSON.stringify({ error: 'closed' }));
      return res.status(200).send(JSON.stringify({ round: r, qs: QUIZ.filter((x) => x.rd === r), prizes: PRIZES }));
    }
    return res.status(200).send(JSON.stringify({
      r1: roundOpen(1), r2: roundOpen(2), leave: leaveOpen(), owner,
      bad: who === 'bad',
      counts: owner || roundOpen(1) ? { 1: QUIZ.filter((x) => x.rd === 1).length, 2: QUIZ.filter((x) => x.rd === 2).length } : null,
    }));
  } catch (e) {
    return res.status(500).send(JSON.stringify({ error: 'server' }));
  }
};
