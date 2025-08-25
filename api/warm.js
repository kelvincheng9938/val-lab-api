res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
if (req.method === 'OPTIONS') return res.status(200).end();

// api/warm.js
module.exports = (req, res) => {
  const auth = req.headers.authorization || "";
  const expected = process.env.CRON_SECRET || "";

  if (expected && auth !== `Bearer ${expected}`) {
    return res.status(401).json({ ok: false, message: "unauthorized" });
  }
  return res.status(200).json({ ok: true, message: "API is working!" });
};
