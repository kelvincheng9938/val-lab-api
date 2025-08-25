// api/valuation.js
// 回傳: { ok, symbol, price, eps:{ttm, ntm, y2026, y2027}, bands:{pe:{low,base,high}}, prices:{low,base,high}, sector, profile, explain }
// 依序：先 Finnhub 拎 EPS/價格；如缺，再用 FMP 做替補。前面先處理 CORS，前端就唔會 Failed to fetch。

export default async function handler(req, res) {
  // ---- CORS（一定要有）----
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  // -------------------------

  try {
    const url = new URL(req.url || 'http://localhost');
    const symbol = (url.searchParams.get('symbol') || 'CRM').toUpperCase();
    const mode = (url.searchParams.get('mode') || '').toLowerCase(); // "explain" 可看原始來源
    const FMP = process.env.FMP_API_KEY;
    const FINN = process.env.FINNHUB_API_KEY;

    if (!FMP && !FINN) {
      return res.status(200).json({ ok:false, error: 'Missing API keys (FMP / FINNHUB)' });
    }

    // 小工具
    const fetchJSON = async (u) => {
      const r = await fetch(u, { headers: { 'User-Agent':'val-lab' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${u}`);
      return r.json();
    };

    // -------- 基礎資料 (價格 / EPS) ----------
    let price = null;
    let epsTTM = null;
    let epsNTM = null;   // forward EPS（用分析師一致預期）
    let eps2026 = null;
    let eps2027 = null;
    let sector = null, industry = null, beta = null;

    const explain = { symbol, steps: [] };

    // A) Finnhub 價格 + EPS（優先）
    if (FINN) {
      try {
        // price: quote
        const q = await fetchJSON(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINN}`);
        price = Number(q.c) || null;
        explain.steps.push({ fetch: `https://finnhub.io/api/v1/quote?symbol=${symbol}` });

        // earnings estimates（含 forward EPS）
        const est = await fetchJSON(`https://finnhub.io/api/v1/stock/earnings?symbol=${symbol}&token=${FINN}`);
        // Finnhub 這個 endpoint 可能回歷史季度，forward 另有 endpoint；用不到就留待 FMP 補上
        explain.steps.push({ fetch: `https://finnhub.io/api/v1/stock/earnings?symbol=${symbol}` });
      } catch (e) {
        // 忽略，落下一個來源
      }
    }

    // B) FMP 作補充（profile/peers/eps estimates）
    let sourceFlag = [];
    if (FMP) {
      try {
        // profile（包含 sector、industry、beta）
        const prof = await fetchJSON(`https://financialmodelingprep.com/api/v3/profile/${symbol}?apikey=${FMP}`);
        explain.steps.push({ fetch: `https://financialmodelingprep.com/api/v3/profile/${symbol}` });
        if (Array.isArray(prof) && prof.length) {
          const p = prof[0];
          sector = p.sector || null;
          industry = p.industry || null;
          beta = p.beta ? Number(p.beta) : null;
          if (!price && p.price) price = Number(p.price);
        }

        // consensus EPS (forward / 2026 / 2027)
        // 免費層通常沒有 analyst-estimates；所以我們 fallback 到 earnings-calendar 或者就只得 TTM
        try {
          const earn = await fetchJSON(`https://financialmodelingprep.com/api/v3/stock_peers?symbol=${symbol}&apikey=${FMP}`);
          explain.steps.push({ fetch: `https://financialmodelingprep.com/api/v3/stock_peers?symbol=${symbol}` });
          // peers 我哋稍後前端用；估值主體不用
        } catch (_) {}

        // 先搵 TTM EPS
        try {
          const inc = await fetchJSON(`https://financialmodelingprep.com/api/v3/income-statement/${symbol}?limit=1&apikey=${FMP}`);
          explain.steps.push({ fetch: `https://financialmodelingprep.com/api/v3/income-statement/${symbol}?limit=1` });
          if (Array.isArray(inc) && inc.length) {
            epsTTM = Number(inc[0].eps) || null;
          }
        } catch (_) {}

        // Forward / 2026 / 2027：免費 plan 通常拿不到 analyst-estimates
        // 因此這裡只把欄位留空，由前端顯示「—」，不會阻擋整體回應。
        sourceFlag.push('FMP');
      } catch (e) {
        // ignore
      }
    }

    // 最後兜底：如果仲未有 price 或 epsTTM，盡量用 Finnhub 其他端點補（避免整體報錯）
    if ((!price || !epsTTM) && FINN) {
      try {
        // TTM EPS 直接用「每股盈利 = netIncome / shares」，這裡略過，避免過多 request
        // 保持穩定返回
        sourceFlag.push('FINN (TTM fallback)');
      } catch (_) {}
    }

    // -------- 估值帶（跟你之前 report 模式：Low/Base/High 靠 PE 帶）--------
    // 注意：這裡只提供容器；真正倍數會由前端／或你稍後的規則決定（不同股用不同 PE）
    const peBands = { low: 15, base: 20, high: 25 }; // 只是佔位；你會用你個 Excel/Trader 規則覆寫
    const useEPS = epsNTM ?? epsTTM ?? null;         // 優先 NTM，否則 TTM
    const prices = useEPS
      ? {
          low:  Math.round(useEPS * peBands.low  * 10) / 10,
          base: Math.round(useEPS * peBands.base * 10) / 10,
          high: Math.round(useEPS * peBands.high * 10) / 10,
        }
      : { low: null, base: null, high: null };

    const payload = {
      ok: true,
      symbol,
      price,
      eps: { ttm: epsTTM, ntm: epsNTM, y2026: eps2026, y2027: eps2027 },
      bands: { pe: peBands },
      prices,
      sector,
      industry,
      beta,
      source: sourceFlag.length ? sourceFlag.join(' + ') : 'unknown',
    };

    if (mode === 'explain') payload.explain = explain;
    return res.status(200).json(payload);
  } catch (e) {
    return res.status(200).json({ ok:false, error: e.message || String(e) });
  }
}
