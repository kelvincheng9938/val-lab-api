// api/news.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = process.env.FINNHUB_API_KEY;
    const symbol = (req.query.symbol || 'SPY').toUpperCase();

    // 取近7日公司新聞
    const to = new Date();
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const fmt = (d) => d.toISOString().slice(0, 10);

    const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${fmt(from)}&to=${fmt(to)}&token=${token}`;
    const r = await fetch(url);
    const data = await r.json();

    const items = Array.isArray(data)
      ? data.slice(0, 20).map(n => ({
          source: n.source,
          headline: n.headline,
          summary: n.summary,
          url: n.url,
          datetime: n.datetime,
        }))
      : [];

    res.status(200).json({ symbol, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}
