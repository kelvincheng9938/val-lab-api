const getSupa = require('../lib/supa');

module.exports = async (req, res) => {
  const symbol = (req.url.split('/').pop() || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error:'symbol required' });

  const supa = getSupa();
  const { data } = await supa.from('segments').select().eq('symbol', symbol).maybeSingle();
  if (!data) {
    // demo
    return res.status(200).json({
      symbol, period: 'FY2024',
      segments: [
        { name:'Subscription & Support', revenue: 30300 },
        { name:'Professional Services', revenue: 2100 }
      ]
    });
  }
  res.status(200).json({ symbol, period: data.period, segments: data.data });
};
