const getSupa = require('../lib/supa');

module.exports = async (req, res) => {
  const symbol = (req.url.split('/').pop() || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error:'symbol required' });

  const supa = getSupa();
  const { data } = await supa.from('tickers').select().eq('symbol', symbol).single();
  const peers = (data?.peers || []).map(p => ({
    symbol: p, fwdPE: null, mcap: null, ytd: null, bubbleSizeMetric: null
  }));
  // 簡化：先回結構，之後你有 key 再填數。
  res.status(200).json({ symbol, peers });
};
