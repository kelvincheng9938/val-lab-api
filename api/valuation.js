// /api/valuation.js
// 目的：安全、穩定地回傳 { 價格、EPS(NTM/2026/2027)、同業PE百分位 → 低/中/高估值 }
// 數源：FMP + Finnhub；全部有防呆，任何一步取不到都唔會 500

export default async function handler(req, res) {
  try {
  const url = new URL(req.url, 'http://localhost'); // vercel node runtime 需要 base
  const symbol = (url.searchParams.get('symbol') || 'CRM').toUpperCase();
  const mode = url.searchParams.get('mode') || ''; // "explain" 會回傳解釋
  const FMP = process.env.FMP_API_KEY;
  const FINN = process.env.FINNHUB_API_KEY;
  } catch (e) {
    res
      .status(500)
      .json({ ok: false, error: e?.message || String(e), hint: "valuation" });
  }
}

  if (!FMP) {
    return res.status(200).json({ ok: false, error: 'Missing FMP_API_KEY', symbol });
  }

  const out = { ok: true, symbol, price: null, eps: { ntm: null, y2026: null, y2027: null }, peBands: {}, bands: [], explain: {} };

  // 小工具
  const fetchJSON = async (u) => {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'val-lab' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      return { __err: e.message };
    }
  };
  const percentile = (arr, p) => {
    if (!arr?.length) return null;
    const a = [...arr].sort((x, y) => x - y);
    const idx = Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))));
    return a[idx];
  };

  // 1) 價格（FMP）
  const quote = await fetchJSON(`https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${FMP}`);
  if (Array.isArray(quote) && quote[0]?.price) out.price = Number(quote[0].price);
  out.explain.quote = quote;

  // 2) EPS TTM（作為 fallback）與 NTM / 2026 / 2027（分析師估）
  // 2.1 EPS TTM
  const km = await fetchJSON(`https://financialmodelingprep.com/api/v3/key-metrics-ttm/${symbol}?apikey=${FMP}`);
  const epsTTM = Array.isArray(km) && km[0]?.epsTTM ? Number(km[0].epsTTM) : null;
  out.explain.keyMetricsTTM = km;

  // 2.2 分析師年度 EPS 預估（近年）
  const est = await fetchJSON(`https://financialmodelingprep.com/api/v3/analyst-estimates/${symbol}?limit=12&apikey=${FMP}`);
  out.explain.analystEst = est;

  if (Array.isArray(est) && est.length) {
    // FMP 會回多筆，挑選最近三個年度
    // 欄位名稱可能是 "estimatedEpsAvg" 或 "epsAvg"（不同 plan 會有差異）所以兩者都試
    const byYear = {};
    for (const row of est) {
      const y = row.year || row.date?.slice(0, 4);
      const val = row.estimatedEpsAvg ?? row.epsAvg ?? row.estimatedEPSAvg ?? null;
      if (y && val != null) byYear[y] = Number(val);
    }
    const yNow = new Date().getUTCFullYear();
    const candidates = [yNow, yNow + 1, yNow + 2]
      .map(y => ({ y, v: byYear[y] ?? null }));

    // NTM 優先用「今年」或「下一年」，否則落回 TTM
    out.eps.ntm  = candidates[0].v ?? candidates[1].v ?? epsTTM ?? null;
    out.eps.y2026 = byYear[2026] ?? null;
    out.eps.y2027 = byYear[2027] ?? null;
  }
  if (!out.eps.ntm) out.eps.ntm = epsTTM ?? null;

  // 3) 同業名單（FMP）
  const peers = await fetchJSON(`https://financialmodelingprep.com/api/v3/stock_peers?symbol=${symbol}&apikey=${FMP}`);
  const peerTickers = Array.isArray(peers?.peers) ? peers.peers.slice(0, 12) : [];
  out.explain.peerList = peerTickers;

  // 4) 取得同業 PE（TTM），計 20/50/80 百分位（用嚟做 Low/Base/High）
  const getRatio = (t) => fetchJSON(`https://financialmodelingprep.com/api/v3/ratios-ttm/${t}?apikey=${FMP}`);
  const ratioSelf = await getRatio(symbol);
  const peSelf = Array.isArray(ratioSelf) && ratioSelf[0]?.peRatioTTM ? Number(ratioSelf[0].peRatioTTM) : null;

  const peerRatiosResp = await Promise.all(peerTickers.map(t => getRatio(t)));
  const peerPEs = peerRatiosResp
    .map(r => (Array.isArray(r) && r[0]?.peRatioTTM ? Number(r[0].peRatioTTM) : null))
    .filter(v => v && isFinite(v) && v > 0);

  if (peSelf) peerPEs.push(peSelf); // 將自己都計埋入去

  const p20 = percentile(peerPEs, 20);
  const p50 = percentile(peerPEs, 50);
  const p80 = percentile(peerPEs, 80);

  out.peBands = { low: p20 ?? null, base: p50 ?? null, high: p80 ?? null };
  out.bands = [
    { label: 'P20', pe: out.peBands.low,  value: out.eps.ntm && out.peBands.low  ? out.eps.ntm * out.peBands.low  : null },
    { label: 'P50', pe: out.peBands.base, value: out.eps.ntm && out.peBands.base ? out.eps.ntm * out.peBands.base : null },
    { label: 'P80', pe: out.peBands.high, value: out.eps.ntm && out.peBands.high ? out.eps.ntm * out.peBands.high : null }
  ];
  out.explain.peerPEs = peerPEs;

  return res.status(200).json(mode === 'explain' ? out : {
    ok: out.ok,
    symbol: out.symbol,
    price: out.price,
    eps: out.eps,
    peBands: out.peBands,
    bands: out.bands
  });
}
