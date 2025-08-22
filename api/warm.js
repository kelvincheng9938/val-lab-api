// api/warm.js  —— Node Serverless Function (Vercel)
module.exports = (req, res) => {
  res.setHeader('content-type', 'application/json');
  res.status(200).send(JSON.stringify({
    ok: true,
    now: new Date().toISOString()
  }));
};
