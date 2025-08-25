// /api/valuation.js
// 功能：拉 FMP + Finnhub（只用 FMP 都可跑），回 NTM / 2026 / 2027 EPS 與解說。
// 設計：任何一步出錯 → 仍然 200 返回 { ok:false, error, explain }，前端唔會「黑 mon」。

export default async function handler(req, res) {
  // 1) 讀參數 & env（呢部唔應該 throw）
  const url = new URL(req.url, 'http://localhost');
  const symbol = (url.searchParams.get('symbol') || 'CRM').toUpperCase();
  const mode   = (url.searchParams.get('mode')   || '').toLowerCase();

  const FMP   = process.env.FMP_API_KEY || '';
  const FINN  = process.env.FINNHUB_API_KEY || ''; // 暫時未必用到，但保留位
  const explain = { symbol, steps: [] };

  if (!FMP) {
    return res.status(200).json({
      ok: false,
      error: 'Missing FMP_API_KEY in Vercel → Settings → Environment Variables.',
      explain
    });
  }

  // 2) 小工具：取 JSON（包埋非 2xx 錯誤）
  async function fetchJSON(u) {
    const r = await fetch(u, { headers: { 'User-Agent': 'val-lab' } });
    if (!r.ok) {
      const txt = await r.text().catch(()=> '');
      throw new Error(`HTTP ${r.status} for ${u} :: ${txt.slice(0,200)}`);
    }
    return r.json();
  }

  try {
    // 3) 併發取數：Quote / Analyst estimates / Peers / Profile
    const base = 'https://financialmodelingprep.com/api/v3';
    const urls = {
      quote:   `${base}/quote/${symbol}?apikey=${FMP}`,
      est:     `${base}/analyst-estimates/${symbol}?limit=8&apikey=${FMP}`,
      peers:   `${base}/stock_peers?symbol=${symbol}&apikey=${FMP}`,
      profile: `${base}/profile/${symbol}?apikey=${FMP}`
    };
    explain.steps.push({ fetch: urls });

    const [quote, est, peers, profile] = await Promise.all([
      fetchJSON(urls.quote),
      fetchJSON(urls.est),
      fetchJSON(urls.peers),
      fetchJSON(urls.profile)
    ]);

    explain.steps.push({ quote, estLen: est?.length || 0, peers, profile });

    // 4) 抽 price
    const price = Array.isArray(quote) && quote[0]?.price ? Number(quote[0].price) : null;

    // 5) 從分析師預估取 EPS：優先 NTM（下一財年 / next 12m），再 2026/2027
    // FMP 的 analyst-estimates 結構會有多個年份欄位（例如: year, epsEstimate 等）。
    // 為兼容差異，做一個寬鬆 mapping。
    const estRows = Array.isArray(est) ? est : [];
    // 嘗試識別年分字段
    function pickEPS(yearLike) {
      const row = estRows.find(r => String(r?.year || r?.period || '').includes(String(yearLike)));
      return row?.epsEstimate ?? row?.epsAvg ?? null;
    }
    // 嘗試 NTM：某些行會用 next12Months / nextFiscalYear；用多個候選字段找
    const ntm =
      estRows.find(r => r?.period?.toLowerCase?.() === 'ntm')?.epsEstimate ??
      estRows.find(r => /next/i.test(String(r?.period)))?.epsEstimate ??
      estRows[0]?.epsEstimate ??
      null;

    const y2026 = pickEPS(2026);
    const y2027 = pickEPS(2027);

    explain.steps.push({ ntm, y2026, y2027 });

    // 6) peers + 行業（畫圖用）
    const peerList = peers?.peersList || peers?.map?.(p => p) || [];
    const sector   = profile?.[0]?.sector || profile?.sector || null;

    // 7) bands：交由前端「用你之前嘅 model」計。
    // 你之前要求唔要「硬推 20/25/30」→ 我而家只回 price / eps / peers / sector，
    // 真正 multiple 規則，由前端（或之後你後端計）套「Trader/Excel Model」嘅邏輯。
    const payload = {
      ok: true,
      symbol,
      price,
      eps: { ntm, y2026, y2027 },   // ← 用分析師預估（如你要求）
      peers: peerList,
      sector,
      explain
    };

    if (mode === 'explain') return res.status(200).json(payload);
    return res.status(200).json(payload);

  } catch (e) {
    // 任何錯誤 → 返回 200 + explain，前端唔會黑 mon
    return res.status(200).json({
      ok: false,
      error: String(e?.message || e),
      explain
    });
  }
}
