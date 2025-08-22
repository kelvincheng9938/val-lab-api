module.exports = async (req, res) => {
  // 方便：直接回 demo 格式（之後你可換 NewsAPI）
  const demo = [
    { source:'MarketWatch', title:'Powell speech could be pivotal', url:'#', published_at: new Date().toISOString() },
    { source:'CNBC', title:'Tech earnings beat', url:'#', published_at: new Date().toISOString() }
  ];
  res.status(200).json(demo);
};
