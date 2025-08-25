res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
if (req.method === 'OPTIONS') return res.status(200).end();

module.exports = async (req, res) => {
  // Demo：前端主要要格式正確；真值靠上游 key
  const out = {
    spy: { price: 0, changePct: 0 },
    btc: { price: 0, changePct: 0 }
  };
  try {
    const s = await fetch('https://api.coindesk.com/v1/bpi/currentprice.json').then(r=>r.json());
    out.btc.price = s?.bpi?.USD?.rate_float || 0;
  } catch(e){}
  res.status(200).json(out);
};
