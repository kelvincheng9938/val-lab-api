// 極簡 vendor 拉數（含容錯）；FMP / Finnhub key 放在 Vercel env
const FMP = process.env.FMP_API_KEY || '';
const FINN = process.env.FINNHUB_API_KEY || '';

async function fetchSafe(url) {
  const res = await fetch(url);
  const text = await res.text();
  const isJson = text.trim().startsWith('{') || text.trim().startsWith('[');
  if (!res.ok || !isJson) throw new Error(`Upstream ${res.status}: ${text.slice(0,120)}`);
  return JSON.parse(text);
}

// Current price（盡量 FMP，唔得再用 Finnhub）
async function getPrice(symbol) {
  try {
    if (FMP) {
      const d = await fetchSafe(`https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${FMP}`);
      if (Array.isArray(d) && d[0]?.price) return +d[0].price;
    }
  } catch (e) {}
  try {
    if (FINN) {
      const d = await fetchSafe(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINN}`);
      if (d?.c) return +d.c;
    }
  } catch (e) {}
  return null;
}

// Forward EPS（嚴格真來源；無就回 derived 並出 warning）
async function getForwardEPS(symbol) {
  // 目標：回傳 [{year, eps, source, quality}]
  const out = [];
  // FMP analyst estimates（annual）
  try {
    if (FMP) {
      const d = await fetchSafe(`https://financialmodelingprep.com/api/v4/analyst-estimates?symbol=${symbol}&limit=20&apikey=${FMP}`);
      // 某些帳號 endpoint 不同，fallback 第二條：
      const d2 = Array.isArray(d) ? d : await fetchSafe(`https://financialmodelingprep.com/api/v3/analyst-estimates/${symbol}?period=annual&apikey=${FMP}`);
      const arr = Array.isArray(d2) ? d2 : [];
      arr.forEach(row => {
        const yr = row?.fiscalDateEnding ? new Date(row.fiscalDateEnding).getFullYear()+1 : (row?.year || null);
        const eps = row?.estimatedEpsAvg ?? row?.epsAvg ?? row?.eps ?? null;
        if (yr && eps) out.push({ year: yr, eps: +eps, source:'fmp', quality:'official' });
      });
    }
  } catch(e){}

  // Finnhub 補（如 FMP 不齊）
  try {
    if (FINN && out.length < 3) {
      const d = await fetchSafe(`https://finnhub.io/api/v1/stock/eps-estimate?symbol=${symbol}&freq=annual&token=${FINN}`);
      const arr = d?.data || d || [];
      arr.forEach(row=>{
        const yr = row?.year || null;
        const eps = row?.epsAvg ?? row?.eps ?? null;
        if (yr && eps && !out.find(x=>x.year===yr))
          out.push({ year: yr, eps:+eps, source:'finnhub', quality:'vendor' });
      });
    }
  } catch(e){}

  // 仍不足 → derived 提示（不外推增長，只用最後一個可用 eps 做 placeholder）
  if (out.length === 0) {
    const thisYear = new Date().getFullYear();
    return {
      list: [{ year: thisYear+1, eps: null, source:'derived', quality:'derived' }],
      warning: 'derived_eps'
    };
  }
  // 按年份排序 + 去重
  const list = [...out.reduce((m, r)=> m.set(r.year, r), new Map()).values()]
               .sort((a,b)=>a.year-b.year).slice(0,4);
  return { list, warning: null };
}

module.exports = { getPrice, getForwardEPS };
