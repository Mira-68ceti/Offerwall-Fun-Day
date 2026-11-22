// GET /api/img?n=sub|leave|moo|r1|r2  -> JPEG, only when allowed (owner code, or the moment has arrived)
const { roundOpen, leaveOpen, checkOwner } = require('./_guard');
const IMG = require('./_img');

module.exports = async (req, res) => {
  try {
    const n = String((req.query && req.query.n) || '');
    if (!Object.prototype.hasOwnProperty.call(IMG, n)) return res.status(404).end();
    const who = await checkOwner(req);
    const owner = who === 'ok';
    let ok = owner;
    if (n === 'leave') ok = ok || leaveOpen();
    if (n === 'r1') ok = ok || roundOpen(1);
    if (n === 'r2') ok = ok || roundOpen(2);
    if (!ok) return res.status(403).end();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).send(Buffer.from(IMG[n], 'base64'));
  } catch (e) {
    return res.status(500).end();
  }
};
