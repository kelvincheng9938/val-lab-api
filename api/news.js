// /api/news.js
import { ok, bad, fail, toISO } from "../lib/vendor.js";
const FMP = process.env.FMP_API_KEY;
const fmp = (p) => `https://financialmodelingprep.com/api${p}&apikey=${FMP}`;

export default async function handler(req, res) {
  try {
    const symbol = (req.query.symbol||"").toUpperCase().trim();
    if (!symbol) return bad(res,"missing symbol");

    // FMP stock_news（近幾日）
    const url = fmp(`/v3/stock_news?tickers=${symbol}&limit=20`);
    const r = await fetch(url, { headers:{ "User-Agent":"val-lab/1.0" } });
    if (!r.ok) throw new Error(`news ${r.status}`);
    const arr = await r.json();

    const items = (arr||[]).map(x=>({
      source: x?.site || x?.source || "news",
      headline: x?.title || x?.headline,
      summary: x?.text || x?.summary || "",
      url: x?.url,
      datetime: Number(x?.publishedDate ? Date.parse(x.publishedDate)/1000 : x?.timestamp || Date.now()/1000)
    }));

    return ok(res, { symbol, items });
  } catch(e){ return fail(res,e); }
}
