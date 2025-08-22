const { createClient } = require('@supabase/supabase-js');
module.exports = function getSupa() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error('Missing Supabase env');
  return createClient(url, key);
};
