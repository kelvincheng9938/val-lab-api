// api/valuation.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const FMP = process.env.FMP_API_KEY;
  const symbol = (req.query.symbol || 'CRM').toUpperCase();

  try {
    // 現價
    const qRes = await fetch(`https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${FMP}`);
    const qJson = await qRes.json();
    const price = qJson?.[0]?.price ?? null;

    // 取最近一年 income statement，抓 epsdiluted（或 eps）
    const isRes = await fetch(`https://financialmodelingprep.com/api/v3/income-statement/${symbol}?limit=1&apikey=${FMP}`);
    const isJson = await isRes.json();
    const eps = isJson?.[0]?.epsdiluted ?? isJson?.[0]?.eps ?? null;

    const multiples = [20, 25, 30];
    const bands = multiples.map(m => ({
      multiple: m,
      value: eps != null ? Number((eps * m).toFixed(2)) : null,
    }));

    res.status(200).json({ symbol, price, eps, bands, updatedAt: Date.now() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}
