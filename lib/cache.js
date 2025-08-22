module.exports = async function getCached(supa, key, ttlSeconds, loader) {
  const { data } = await supa.from('api_cache').select().eq('key', key).single();
  const fresh = data && (Date.now() - Date.parse(data.fetched_at)) / 1000 < data.ttl_seconds;
  if (fresh) return data.payload;

  let payload = null;
  try { payload = await loader(); } catch (e) { /* ignore */ }

  if (payload) {
    await supa.from('api_cache').upsert({
      key, payload,
      fetched_at: new Date().toISOString(),
      ttl_seconds: ttlSeconds
    });
    return payload;
  }
  if (data) return data.payload; // fallback 舊快取
  throw new Error('NoData');
};
