const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkStores() {
  const { data, error } = await supabase.from('stores').select('*').limit(1);
  if (error) {
    console.error('Error fetching stores:', error);
    return;
  }
  if (data.length === 0) {
    console.log('No stores found.');
    return;
  }
  console.log('Columns found in stores table:', Object.keys(data[0]));
  console.log('Sample Row:', data[0]);
}

checkStores();
