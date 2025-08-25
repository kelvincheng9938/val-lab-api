// --- CORS (讓前端可讀數) ---
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
res.setHeader('Access-Control-Allow-Headers', '*');
if (req.method === 'OPTIONS') return res.status(200).end();
// --- CORS end ---
// api/valuation.js
const FMP = process.env.FMP_API_KEY;

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  const idx = (a.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

async function getPrice(symbol) {
  const d = await getJSON(`https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${FMP}`);
  return d?.[0]?.price ?? null;
}

async function getTTMEps(symbol) {
  const d = await getJSON(`https://financialmodelingprep.com/api/v3/key-metrics-ttm/${symbol}?apikey=${FMP}`);
  // FMP 有時叫 epsTTM / trailingEps / netIncomePerShareTTM
  return d?.[0]?.epsTTM ?? d?.[0]?.trailingEps ?? d?.[0]?.netIncomePerShareTTM ?? null;
}

async function getForwardPE(symbol) {
  const p = await getJSON(`https://financialmodelingprep.com/api/v3/profile/${symbol}?apikey=${FMP}`);
  return p?.[0]?.forwardPE ?? null;
}

async function getPeers(symbol) {
  try {
    const p = await getJSON(`https://financialmodelingprep.com/api/v4/stock_peers?symbol=${symbol}&apikey=${FMP}`);
    return p?.[0]?.peersList?.slice(0, 10) ?? [];
  } catch { return []; }
}

async function getPEFromProfile(sym) {
  try {
    const d = await getJSON(`https://financialmodelingprep.com/api/v3/profile/${sym}?apikey=${FMP}`);
    return d?.[0]?.pe ?? null;
  } catch { return null; }
}

// 年度歷史 P/E（取近幾年）
async function getHistoricalPE(symbol) {
  try {
    const hist = await getJSON(`https://financialmodelingprep.com/api/v3/key-metrics/${symbol}?period=annual&limit=10&apikey=${FMP}`);
    const arr = (hist || [])
      .map(x => Number(x.peRatio))
      .filter(v => Number.isFinite(v) && v > 0 && v < 120); // 濾走極端值
    return arr.slice(0, 8); // 近 8 年
  } catch { return []; }
}

function bandsFromMultiples(eps, multiples) {
  return multiples.map(m => ({ multiple: Math.round(m), value: Number((eps * m).toFixed(1)) }));
}

module.exports = async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'AAPL').toUpperCase();
    const model = (req.query.model || 'fixed').toLowerCase();  // fixed | peer | hist
    const epsMode = (req.query.eps || 'ttm').toLowerCase();    // ttm | ntm
    const price = await getPrice(symbol);

    // 計 EPS（TTM / NTM）
    const epsTTM = await getTTMEps(symbol);
    let eps = epsTTM, epsType = 'TTM';
    if (epsMode === 'ntm') {
      const fpe = await getForwardPE(symbol);
      if (price && fpe && fpe > 0) {
        eps = price / fpe;
        epsType = 'NTM';
      }
    }

    // 倍數來源
    let multiples = [20, 25, 30];
    let modelUsed = 'fixed';

    if (model === 'peer') {
      const list = await getPeers(symbol);
      const all = [symbol, ...list];
      const pes = (await Promise.all(all.map(getPEFromProfile)))
        .filter(v => Number.isFinite(v) && v > 0 && v < 120);
      if (pes.length >= 4) {
        const p25 = percentile(pes, 0.25);
        const p50 = percentile(pes, 0.50);
        const p75 = percentile(pes, 0.75);
        multiples = [p25, p50, p75].map(x => Math.round(x));
        modelUsed = 'peer';
      }
    }

    if (model === 'hist') {
      const histPE = await getHistoricalPE(symbol);
      if (histPE.length >= 4) {
        const p25 = percentile(histPE, 0.25);
        const p50 = percentile(histPE, 0.50);
        const p75 = percentile(histPE, 0.75);
        multiples = [p25, p50, p75].map(x => Math.round(x));
        modelUsed = 'hist';
      }
    }

    // 安全護欄（避免過份極端）
    multiples = multiples
      .map(m => Math.max(5, Math.min(100, Number(m) || 0)))
      .sort((a,b)=>a-b);

    const bands = bandsFromMultiples(eps || 0, multiples);

    res.status(200).json({
      symbol,
      price,
      eps: Number((eps || 0).toFixed(2)),
      epsType,
      multiples,      // <— 回傳實際用咗嘅倍數
      modelUsed,      // fixed / peer / hist
      bands,
      updatedAt: Date.now()
    });

  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
};
