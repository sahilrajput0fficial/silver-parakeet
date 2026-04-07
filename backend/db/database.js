const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// --- Configuration ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Encryption Key should be 32 bytes for AES-256-CBC
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; 

/**
 * Helper to ensure encryption key is 32 bytes (AES-256)
 */
function getEncryptionKey() {
  if (!ENCRYPTION_KEY) return null;
  if (ENCRYPTION_KEY.length === 32) return Buffer.from(ENCRYPTION_KEY);
  return crypto.createHash('sha256').update(String(ENCRYPTION_KEY)).digest();
}

/**
 * Encrypts an access token
 */
function encrypt(text) {
  const key = getEncryptionKey();
  if (!key) {
    console.warn('Warning: Missing ENCRYPTION_KEY in .env. Storing as plaintext.');
    return { iv: 'plaintext', encrypted: text };
  }
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return {
    iv: iv.toString('hex'),
    encrypted: encrypted.toString('hex')
  };
}

/**
 * Decrypts an access token
 */
function decrypt(encryptedText, ivHex) {
  const key = getEncryptionKey();
  if (!key || ivHex === 'plaintext') return encryptedText;
  
  try {
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedText, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (err) {
    console.error('Decryption failed:', err.message);
    return encryptedText;
  }
}

// --- Store Operations ---

async function addStore(user_id, api_name, shop_domain, access_token, max_orders = 100) {
  const { iv, encrypted } = encrypt(access_token);
  const { data, error } = await supabase
    .from('stores')
    .upsert({
      user_id,
      api_name,
      shop_domain,
      access_token_encrypted: encrypted,
      access_token_iv: iv,
      max_orders,
      updated_at: new Date().toISOString()
    }, { onConflict: 'shop_domain' })
    .select();

  if (error) throw error;
  return data;
}

async function getAllStores(user_id, role) {
  let query = supabase.from('stores').select('*').order('created_at', { ascending: false });
  
  if (role !== 'admin') {
    query = query.eq('user_id', user_id);
  }
  
  const { data, error } = await query;
  if (error) throw error;
  
  return data.map(row => ({
    id: row.id,
    user_id: row.user_id,
    api_name: row.api_name,
    shop_domain: row.shop_domain,
    access_token: decrypt(row.access_token_encrypted, row.access_token_iv),
    max_orders: row.max_orders,
    usage_count: row.usage_count,
    created_at: row.created_at,
    is_active: row.is_active,
    is_exhausted: row.is_exhausted,
    priority: row.priority
  }));
}

async function getStoreByDomain(shop_domain, user_id, role) {
  let query = supabase.from('stores').select('*').eq('shop_domain', shop_domain);
  
  if (role !== 'admin') {
    query = query.eq('user_id', user_id);
  }
  
  const { data, error } = await query.single();
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 is no rows found
  
  if (!data) return null;
  
  return {
    ...data,
    access_token: decrypt(data.access_token_encrypted, data.access_token_iv)
  };
}

async function deleteStoreByDomain(shop_domain, user_id, role) {
  let query = supabase.from('stores').delete().eq('shop_domain', shop_domain);
  
  if (role !== 'admin') {
    query = query.eq('user_id', user_id);
  }
  
  const { error } = await query;
  if (error) throw error;
}

async function deleteAllStores(user_id, role) {
  let query = supabase.from('stores').delete();
  
  if (role !== 'admin') {
    query = query.eq('user_id', user_id);
  } else {
    // Admin deletes everything? Actually admin might want to delete all stores system-wide or just their own.
    // Based on previous code, admin deletes all rows.
    query = query.neq('id', 0); // Hack to match all rows in Supabase delete
  }
  
  const { error } = await query;
  if (error) throw error;
}

async function incrementUsage(shop_domain) {
  const { data: store } = await supabase.from('stores').select('usage_count').eq('shop_domain', shop_domain).single();
  if (!store) return;

  const { error } = await supabase
    .from('stores')
    .update({ usage_count: store.usage_count + 1 })
    .eq('shop_domain', shop_domain);
    
  if (error) throw error;
}

async function resetAllUsage(user_id, role) {
  let query = supabase.from('stores').update({ usage_count: 0 });
  
  if (role !== 'admin') {
    query = query.eq('user_id', user_id);
  } else {
    query = query.neq('id', 0);
  }
  
  const { error } = await query;
  if (error) throw error;
}

async function logActivity(user_id, action, details, ip_address) {
  try {
    const { error } = await supabase.from('activity_logs').insert({
      user_id,
      action,
      details: details || '',
      ip_address: ip_address || ''
    });
    if (error) throw error;
  } catch (e) {
    console.error('Failed to log activity:', e.message);
  }
}

async function getNextAvailableAPI(user_id) {
  // First try the RPC (Most efficient)
  const { data: finalData, error: finalError } = await supabase.rpc('get_next_api', { p_user_id: user_id });
  
  if (finalError || !finalData || finalData.length === 0) {
    // Fallback: Fetch all active and filter in memory
    const { data: stores, error } = await supabase
      .from('stores')
      .select('*')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .eq('is_exhausted', false)
      .order('priority', { ascending: true });
    
    if (error || !stores) return null;
    
    const api = stores.find(s => s.usage_count < s.max_orders);
    if (!api) return null;
    
    return { ...api, access_token: decrypt(api.access_token_encrypted, api.access_token_iv) };
  }

  const api = finalData[0];
  return { ...api, access_token: decrypt(api.access_token_encrypted, api.access_token_iv) };
}

async function markAPIUsed(api_id) {
  const { data: api } = await supabase.from('stores').select('usage_count, max_orders').eq('id', api_id).single();
  if (!api) return;

  const newCount = api.usage_count + 1;
  const isExhausted = newCount >= api.max_orders;

  await supabase
    .from('stores')
    .update({ 
      usage_count: newCount,
      is_exhausted: isExhausted
    })
    .eq('id', api_id);
}

async function markAPIExhausted(api_id) {
  await supabase
    .from('stores')
    .update({ 
      is_exhausted: true,
      is_active: false
    })
    .eq('id', api_id);
}

async function checkDailyLimit(user_id) {
  const { data: user } = await supabase.from('users').select('daily_limit').eq('id', user_id).single();
  if (!user || user.daily_limit === null) return { passes: true, limit: null, sent_today: 0 };

  const date = new Date().toISOString().split('T')[0];
  const { data: usage } = await supabase.from('usage_logs').select('emails_sent_today').eq('user_id', user_id).eq('date', date).single();
  const sentToday = usage ? usage.emails_sent_today : 0;

  return { 
    passes: sentToday < user.daily_limit, 
    limit: user.daily_limit, 
    sent_today: sentToday 
  };
}

async function incrementDailyLimit(user_id) {
  const date = new Date().toISOString().split('T')[0];
  const { data: usage } = await supabase.from('usage_logs').select('emails_sent_today').eq('user_id', user_id).eq('date', date).single();
  
  if (usage) {
    await supabase.from('usage_logs').update({ emails_sent_today: usage.emails_sent_today + 1 }).eq('user_id', user_id).eq('date', date);
  } else {
    await supabase.from('usage_logs').insert({ user_id, date, emails_sent_today: 1 });
  }
}

// --- Send Progress Operations ---

function generateSessionId(rows, shopDomain, userId) {
  const firstEmail = rows[0]?.email || '';
  const lastEmail = rows[rows.length - 1]?.email || '';
  const count = rows.length;
  const date = new Date().toDateString();
  const raw = `${firstEmail}-${lastEmail}-${count}-${shopDomain}-${date}-${userId}`;

  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash = hash & hash;
  }
  return `session_${Math.abs(hash)}`;
}

async function checkExistingProgress(sessionId) {
  const { data: existingRows, error } = await supabase
    .from('send_progress')
    .select('*')
    .eq('session_id', sessionId)
    .order('row_index', { ascending: true });

  if (error) throw error;

  if (!existingRows || existingRows.length === 0) {
    return { isResume: false, alreadySent: [], lastSentIndex: -1, totalSentSoFar: 0, totalFailed: 0, rows: [] };
  }

  const alreadySent = existingRows.filter(r => r.status === 'sent').map(r => r.row_index);
  const failedRows = existingRows.filter(r => r.status === 'failed').map(r => r.row_index);
  const lastSentIndex = alreadySent.length > 0 ? Math.max(...alreadySent) : -1;

  return {
    isResume: true,
    alreadySent,
    failedRows,
    lastSentIndex,
    totalSentSoFar: alreadySent.length,
    totalFailed: failedRows.length,
    rows: existingRows
  };
}

async function initSessionRows(sessionId, shopDomain, rows, user_id) {
  const sessionRows = rows.map((row, i) => ({
    session_id: sessionId,
    shop_domain: shopDomain,
    email: row.email,
    row_index: i,
    status: 'pending',
    user_id
  }));

  const { error } = await supabase.from('send_progress').insert(sessionRows);
  if (error) throw error;
}

async function updateRowProgress(sessionId, rowIndex, status, orderId, draftOrderId, errorMessage, api_id = null, api_name = null) {
  await supabase
    .from('send_progress')
    .update({ 
      status, 
      order_id: orderId || null, 
      draft_order_id: draftOrderId || null, 
      error_message: errorMessage || null, 
      api_id, 
      api_name, 
      updated_at: new Date().toISOString()
    })
    .eq('session_id', sessionId)
    .eq('row_index', rowIndex);
}

async function deleteSession(sessionId, user_id, role) {
  let query = supabase.from('send_progress').delete().eq('session_id', sessionId);
  if (role !== 'admin') query = query.eq('user_id', user_id);
  await query;
}

async function clearAllSendHistory(user_id, role) {
  let query = supabase.from('send_progress').delete();
  if (role !== 'admin') {
    query = query.eq('user_id', user_id);
  } else {
    query = query.neq('id', 0);
  }
  await query;
}

async function clearOldSessions() {
  const ageLimit = new Date();
  ageLimit.setDate(ageLimit.getDate() - 7);
  
  const { error, count } = await supabase
    .from('send_progress')
    .delete()
    .lt('created_at', ageLimit.toISOString());
    
  if (error) console.error('Failed to clear old sessions:', error.message);
}

async function getRowProgress(sessionId, rowIndex) {
  const { data } = await supabase
    .from('send_progress')
    .select('*')
    .eq('session_id', sessionId)
    .eq('row_index', rowIndex)
    .single();
  return data;
}

module.exports = {
  supabase,
  addStore,
  getAllStores,
  getStoreByDomain,
  deleteStoreByDomain,
  deleteAllStores,
  incrementUsage,
  resetAllUsage,
  logActivity,
  checkDailyLimit,
  incrementDailyLimit,
  generateSessionId,
  checkExistingProgress,
  initSessionRows,
  updateRowProgress,
  deleteSession,
  clearAllSendHistory,
  clearOldSessions,
  getRowProgress,
  getNextAvailableAPI,
  markAPIUsed,
  markAPIExhausted
};
