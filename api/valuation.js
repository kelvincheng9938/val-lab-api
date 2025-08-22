const getSupa = require('../lib/supa');
const cache = require('../lib/cache');
const { getPrice, getForwardEPS } = require('../lib/vendor');

module.exports = async (req, res) => {
  const symbol = (req.url.split('/').pop() || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error:'symbol required' });

  const supa = getSupa();

  try {
    const payload = await cache(supa, `valuation:${symbol}`, 60 * 10, async () => {
      const [price, epsPack] = await Promise.all([ getPrice(symbol), getForwardEPS(symbol) ]);
      const years = epsPack.list.map(e => e.year);
      const estimates = epsPack.list;

      const warnings = [];
      if (!price) warnings.push('no_price');
      if (epsPack.warning) warnings.push(epsPack.warning);

      // bands 計算：只用「有 eps 的年」，無則留空
      const bands = { '20x': [], '25x': [], '30x': [] };
      estimates.forEach(e => {
        if (e.eps != null) {
          bands['20x'].push(+ (e.eps * 20).toFixed(2));
          bands['25x'].push(+ (e.eps * 25).toFixed(2));
          bands['30x'].push(+ (e.eps * 30).toFixed(2));
        } else {
          bands['20x'].push(null); bands['25x'].push(null); bands['30x'].push(null);
        }
      });

      return {
        symbol, price: price ?? null,
        eps_estimates: estimates,
        years, bands, warnings
      };
    });

    res.status(200).json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message || 'server_error' });
  }
};
