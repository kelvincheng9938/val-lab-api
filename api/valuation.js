// api/valuation.js
export default async function handler(req, res) {
  // ---- parse & env ----
  const url = new URL(req.url, 'http://localhost');
  const symbol = (url.searchParams.get('symbol') || 'CRM').toUpperCase();
  const mode = url.searchParams.get('mode') || ''; // "explain" 會帶多啲步驟
  const FMP = process.env.FMP_API_KEY;
  const FINN = process.env.FINNHUB_API_KEY;

  const explain = { symbol, steps: [] };
  const out = { ok: true, symbol, price: null, eps: { ttm: null, ntm: null, y2026: null, y2027: null, source: null }, bands: {}, peers: {}, profile: {}, explain };

  try {
    // ------- helpers -------
    const fetchJSON = async (u) => {
      explain.steps.push({ fetch: u });
      const r = await fetch(u, { headers: { 'User-Agent': 'val-lab' } });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(`HTTP ${r.status} for ${u} :: ${t.slice(0, 180)}`);
      }
      return r.json();
    };
    const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);

    if (!FMP) throw new Error('Missing FMP_API_KEY');

    // ------- 1) 基本資料：價錢 / 行業 / peers（用 FMP 可用端點） -------
    const quoteArr = await fetchJSON(`https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${FMP}`);
    const q = Array.isArray(quoteArr) ? quoteArr[0] : null;
    out.price = q?.price ?? null;
    out.eps.ttm = q?.eps ?? null;

    const profArr = await fetchJSON(`https://financialmodelingprep.com/api/v3/profile/${symbol}?apikey=${FMP}`);
    const prof = Array.isArray(profArr) ? profArr[0] : null;
    out.profile = { sector: prof?.sector || null, industry: prof?.industry || null, beta: prof?.beta ?? null };

    const peersObj = await fetchJSON(`https://financialmodelingprep.com/api/v3/stock_peers?symbol=${symbol}&apikey=${FMP}`);
    out.peers = { list: peersObj?.peersList || peersObj?.peers || [] };

    // ------- 2) EPS 估值：先用 Finnhub（analyst estimates），唔得就用 TTM fallback -------
    if (!FINN) explain.steps.push({ warn: 'FINNHUB_API_KEY not set → will fallback to TTM for NTM' });

    let ntm = null, y2026 = null, y2027 = null, epsSource = null;

    if (FINN) {
      // Finnhub: quarterly earnings (含 epsEstimate/epsActual)
      const earn = await fetchJSON(`https://finnhub.io/api/v1/stock/earnings?symbol=${symbol}&token=${FINN}`);
      const rows = Array.isArray(earn?.earnings) ? earn.earnings : [];

      const today = new Date();

      // 未來季度（如果 Finnhub 有提供 estimate）
      const future = rows
        .filter(r => r?.epsEstimate != null && new Date(r.period) > today)
        .sort((a, b) => new Date(a.period) - new Date(b.period));

      // 歷史季度（用 actual 作後備）
      const hist = rows
        .filter(r => r?.epsActual != null && new Date(r.period) <= today)
        .sort((a, b) => new Date(a.period) - new Date(b.period));

      // 計 NTM：優先用 future estimate 的最近 4 季；否則用 hist actual 的最近 4 季（TTM）
      if (future.length >= 4) {
        ntm = sum(future.slice(0, 4).map(r => r.epsEstimate));
        epsSource = 'Finnhub (future estimates)';
      } else if (hist.length >= 4) {
        ntm = sum(hist.slice(-4).map(r => r.epsActual));
        epsSource = 'Finnhub (TTM fallback from actual)';
      }

      // 砌年度（2026/2027）：把 future 分年合計；若不足，留空
      if (future.length) {
        const byYear = {};
        for (const r of future) {
          const y = String(new Date(r.period).getUTCFullYear());
          byYear[y] = (byYear[y] || 0) + (Number(r.epsEstimate) || 0);
        }
        y2026 = byYear['2026'] ?? null;
        y2027 = byYear['2027'] ?? null;
      }
    }

    // 如果 Finnhub 攞唔到任何 EPS，就用 FMP quote 入面嘅 TTM 當 NTM 臨時值（至少保證前端有數唔死螢幕）
    if (!ntm && out.eps.ttm != null) {
      ntm = Number(out.eps.ttm);
      epsSource = epsSource || 'FMP (TTM fallback)';
    }

    out.eps.ntm = ntm;
    out.eps.y2026 = y2026;
    out.eps.y2027 = y2027;
    out.eps.source = epsSource;

    // ------- 3) 估值 bands：用 NTM（有先計，冇就略） -------
    if (ntm) {
      const peLow = 15, peBase = 20, peHigh = 25; // 先行用固定帶；你升級到 FMP analyst 之後可換回模型帶
      out.bands = {
        pe: { low: peLow, base: peBase, high: peHigh },
        prices: { low: +(ntm * peLow).toFixed(2), base: +(ntm * peBase).toFixed(2), high: +(ntm * peHigh).toFixed(2) }
      };
    }

    return res.status(200).json(out);

  } catch (e) {
    // 統一把錯誤包回 200 + ok:false（前端唔會死），加 explain
    const err = typeof e?.message === 'string' ? e.message : String(e);
    return res.status(200).json({ ok: false, error: err, explain });
  }
}
