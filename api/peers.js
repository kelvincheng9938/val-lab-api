// /api/peers.js
import { ok, bad, fail } from "../lib/vendor.js";
const FMP = process.env.FMP_API_KEY;
const fmp = (p) => `https://financialmodelingprep.com/api${p}&apikey=${FMP}`;

const get = async (u,l) => {
  const r = await fetch(u, { headers: { "User-Agent":"val-lab/1.0" } });
  if (!r.ok) throw new Error(`${l||"req"} ${r.status}`);
  return r.json();
};

export default async function handler(req, res) {
  try {
    const symbol = (req.query.symbol||"").toUpperCase().trim();
    if (!symbol) return bad(res,"missing symbol");

    const peersObj = await get(fmp(`/v4/stock_peers?symbol=${symbol}`),"peers");
    const peers = peersObj?.peersList || peersObj?.peers || [];
    const uniq = [...new Set([symbol, ...peers])].slice(0, 20);

    const [quotes, profiles] = await Promise.all([
      get(fmp(`/v3/quote/${uniq.join(",")}?`),"q"),
      get(fmp(`/v3/profile/${uniq.join(",")}?`),"p")
    ]);

    const profMap = new Map((profiles||[]).map(p=>[p.symbol,p]));
    const rows = (quotes||[]).map(q=>{
      const p = profMap.get(q.symbol)||{};
      return {
        symbol: q.symbol,
        price: Number(q.price||q.previousClose)||null,
        mktCap: Number(p.mktCap || p.mktcap || q.marketCap)||null,
        sector: p.sector || p.industry || "Unknown",
        company: p.companyName || p.company || q.name || q.symbol
      };
    });

    // sector pie
    const sectorAgg = {};
    for (const r of rows) {
      const s = r.sector || "Unknown";
      sectorAgg[s] = (sectorAgg[s]||0) + (r.mktCap||0);
    }

    return ok(res, { base: symbol, peers: rows, sector: sectorAgg });
  } catch(e){ return fail(res,e); }
}
