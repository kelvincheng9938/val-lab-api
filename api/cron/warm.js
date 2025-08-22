const getSupa = require('../../lib/supa');

module.exports = async (req, res) => {
  // 每小時由 Vercel Cron 觸發：讀 tickers，預先熱身估值快取
  const supa = getSupa();
  const { data: list } = await supa.from('tickers').select('symbol').limit(20);
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
  for (const r of (list || [])) {
    try { await fetch(`${base}/v1/valuation/${r.symbol}`); } catch(e){}
  }
  res.status(200).json({ warmed: (list||[]).map(r=>r.symbol) });
};
