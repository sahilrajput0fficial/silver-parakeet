const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
// --- Configuration ---
const dbPath = path.join(__dirname, 'shopify_app.db');
const db = new Database(dbPath);

// Encryption Key should be 32 bytes for AES-256-CBC
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; 

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_name TEXT NOT NULL,
    shop_domain TEXT UNIQUE NOT NULL,
    access_token_encrypted TEXT NOT NULL,
    access_token_iv TEXT NOT NULL,
    max_orders INTEGER DEFAULT 100,
    usage_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// TASK 1 — send_progress table for resume feature
db.exec(`
  CREATE TABLE IF NOT EXISTS send_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    shop_domain TEXT NOT NULL,
    email TEXT NOT NULL,
    row_index INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    order_id TEXT,
    draft_order_id TEXT,
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// Create index for fast lookups by session_id
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_send_progress_session 
  ON send_progress(session_id)
`);

// --- Multi-User Tables ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    daily_limit INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    force_change_password INTEGER DEFAULT 1
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS usage_logs (
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    emails_sent_today INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, date)
  )
`);

// --- Migrations for existing tables ---
try {
  db.exec("ALTER TABLE stores ADD COLUMN user_id INTEGER");
} catch (e) {}

try {
  db.exec("ALTER TABLE send_progress ADD COLUMN user_id INTEGER");
} catch (e) {}

// --- Default Admin Account ---
const existingAdmin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
if (!existingAdmin) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password, role, force_change_password) VALUES (?, ?, ?, ?)').run('admin', hash, 'admin', 1);
  console.log('[DB] Created default admin account (admin / admin123)');
}

// TASK 7 — Clear old sessions on startup (older than 7 days)
function clearOldSessions() {
  const result = db.prepare(
    `DELETE FROM send_progress WHERE created_at < datetime('now', '-7 days')`
  ).run();
  if (result.changes > 0) {
    console.log(`[DB] Cleared ${result.changes} old session rows (>7 days)`);
  }
}

// Run cleanup on startup
clearOldSessions();

/**
 * Encrypts an access token
 */
function encrypt(text) {
  if (!ENCRYPTION_KEY) {
    console.warn('Warning: Missing ENCRYPTION_KEY in .env. Storing as plaintext.');
    return { iv: 'plaintext', encrypted: text };
  }
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
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
  if (!ENCRYPTION_KEY || ivHex === 'plaintext') return encryptedText;
  
  try {
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedText, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (err) {
    console.error('Decryption failed:', err.message);
    return encryptedText;
  }
}

// --- Store Operations ---

function addStore(user_id, api_name, shop_domain, access_token, max_orders = 100) {
  const { iv, encrypted } = encrypt(access_token);
  const stmt = db.prepare(`
    INSERT INTO stores (user_id, api_name, shop_domain, access_token_encrypted, access_token_iv, max_orders)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(shop_domain) DO UPDATE SET
      user_id = excluded.user_id,
      api_name = excluded.api_name,
      access_token_encrypted = excluded.access_token_encrypted,
      access_token_iv = excluded.access_token_iv,
      max_orders = excluded.max_orders
  `);
  return stmt.run(user_id, api_name, shop_domain, encrypted, iv, max_orders);
}

function getAllStores(user_id, role) {
  let rows;
  if (role === 'admin') {
    rows = db.prepare('SELECT * FROM stores ORDER BY created_at DESC').all();
  } else {
    rows = db.prepare('SELECT * FROM stores WHERE user_id = ? ORDER BY created_at DESC').all(user_id);
  }
  
  return rows.map(row => ({
    id: row.id,
    user_id: row.user_id,
    api_name: row.api_name,
    shop_domain: row.shop_domain,
    access_token: decrypt(row.access_token_encrypted, row.access_token_iv),
    max_orders: row.max_orders,
    usage_count: row.usage_count,
    created_at: row.created_at
  }));
}

function getStoreByDomain(shop_domain, user_id, role) {
  let row;
  if (role === 'admin') {
    row = db.prepare('SELECT * FROM stores WHERE shop_domain = ?').get(shop_domain);
  } else {
    row = db.prepare('SELECT * FROM stores WHERE shop_domain = ? AND user_id = ?').get(shop_domain, user_id);
  }
  
  if (!row) return null;
  
  return {
    id: row.id,
    user_id: row.user_id,
    api_name: row.api_name,
    shop_domain: row.shop_domain,
    access_token: decrypt(row.access_token_encrypted, row.access_token_iv),
    max_orders: row.max_orders,
    usage_count: row.usage_count,
    created_at: row.created_at
  };
}

function deleteStoreByDomain(shop_domain, user_id, role) {
  if (role === 'admin') {
    return db.prepare('DELETE FROM stores WHERE shop_domain = ?').run(shop_domain);
  }
  return db.prepare('DELETE FROM stores WHERE shop_domain = ? AND user_id = ?').run(shop_domain, user_id);
}

function deleteAllStores(user_id, role) {
  if (role === 'admin') {
    return db.prepare('DELETE FROM stores').run();
  }
  return db.prepare('DELETE FROM stores WHERE user_id = ?').run(user_id);
}

function incrementUsage(shop_domain) {
  return db.prepare('UPDATE stores SET usage_count = usage_count + 1 WHERE shop_domain = ?').run(shop_domain);
}

function resetAllUsage(user_id, role) {
  if (role === 'admin') {
    return db.prepare('UPDATE stores SET usage_count = 0').run();
  }
  return db.prepare('UPDATE stores SET usage_count = 0 WHERE user_id = ?').run(user_id);
}

function logActivity(user_id, action, details, ip_address) {
  try {
    db.prepare('INSERT INTO activity_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)').run(
      user_id, action, details || '', ip_address || ''
    );
  } catch (e) {
    console.error('Failed to log activity:', e.message);
  }
}

// --- Usage & Daily Limits ---
function checkDailyLimit(user_id) {
  const user = db.prepare('SELECT daily_limit FROM users WHERE id = ?').get(user_id);
  if (!user || user.daily_limit === null) return { passes: true, limit: null, sent_today: 0 }; // No limit (Admin or unlimited member)

  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const usage = db.prepare('SELECT emails_sent_today FROM usage_logs WHERE user_id = ? AND date = ?').get(user_id, date);
  const sentToday = usage ? usage.emails_sent_today : 0;

  if (sentToday >= user.daily_limit) {
    return { passes: false, limit: user.daily_limit, sent_today: sentToday };
  }
  return { passes: true, limit: user.daily_limit, sent_today: sentToday };
}

function incrementDailyLimit(user_id) {
  const date = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO usage_logs (user_id, date, emails_sent_today) 
    VALUES (?, ?, 1) 
    ON CONFLICT(user_id, date) DO UPDATE SET emails_sent_today = emails_sent_today + 1
  `).run(user_id, date);
}

// --- Send Progress Operations (RESUME FEATURE) ---

/**
 * TASK 2 — Generate a unique session ID for a CSV batch.
 * Same CSV on same day = same session_id (enables resume detection).
 */
function generateSessionId(rows, shopDomain, userId) {
  const firstEmail = rows[0]?.email || '';
  const lastEmail = rows[rows.length - 1]?.email || '';
  const count = rows.length;
  const date = new Date().toDateString();

  const raw = `${firstEmail}-${lastEmail}-${count}-${shopDomain}-${date}-${userId}`;

  // Simple hash
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash = hash & hash;
  }

  return `session_${Math.abs(hash)}`;
}

/**
 * TASK 3 — Check if a session already has progress (resume detection).
 */
function checkExistingProgress(sessionId) {
  const existingRows = db.prepare(
    `SELECT * FROM send_progress WHERE session_id = ? ORDER BY row_index ASC`
  ).all(sessionId);

  if (existingRows.length === 0) {
    return {
      isResume: false,
      alreadySent: [],
      lastSentIndex: -1,
      totalSentSoFar: 0,
      totalFailed: 0,
      rows: []
    };
  }

  const alreadySent = existingRows
    .filter(r => r.status === 'sent')
    .map(r => r.row_index);

  const failedRows = existingRows
    .filter(r => r.status === 'failed')
    .map(r => r.row_index);

  const lastSentIndex = alreadySent.length > 0
    ? Math.max(...alreadySent)
    : -1;

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

/**
 * Save all rows as "pending" for a fresh session.
 */
function initSessionRows(sessionId, shopDomain, rows, user_id) {
  const stmt = db.prepare(
    `INSERT INTO send_progress (session_id, shop_domain, email, row_index, status, user_id)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  );

  const insertMany = db.transaction((rows) => {
    for (let i = 0; i < rows.length; i++) {
      stmt.run(sessionId, shopDomain, rows[i].email, i, user_id);
    }
  });

  insertMany(rows);
}

/**
 * Update a row's status after send attempt.
 */
function updateRowProgress(sessionId, rowIndex, status, orderId, draftOrderId, errorMessage) {
  db.prepare(
    `UPDATE send_progress 
     SET status = ?, order_id = ?, draft_order_id = ?, error_message = ?, updated_at = datetime('now')
     WHERE session_id = ? AND row_index = ?`
  ).run(status, orderId || null, draftOrderId || null, errorMessage || null, sessionId, rowIndex);
}

/**
 * Delete all progress for a session (Start Fresh).
 */
function deleteSession(sessionId, user_id, role) {
  if (role === 'admin') {
    return db.prepare('DELETE FROM send_progress WHERE session_id = ?').run(sessionId);
  }
  return db.prepare('DELETE FROM send_progress WHERE session_id = ? AND user_id = ?').run(sessionId, user_id);
}

/**
 * Clear ALL send progress history.
 */
function clearAllSendHistory(user_id, role) {
  if (role === 'admin') {
    return db.prepare('DELETE FROM send_progress').run();
  }
  return db.prepare('DELETE FROM send_progress WHERE user_id = ?').run(user_id);
}

/**
 * Get progress details for a specific row in a session.
 */
function getRowProgress(sessionId, rowIndex) {
  return db.prepare(
    `SELECT * FROM send_progress WHERE session_id = ? AND row_index = ?`
  ).get(sessionId, rowIndex);
}

module.exports = {
  db,
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
  // Resume feature exports
  generateSessionId,
  checkExistingProgress,
  initSessionRows,
  updateRowProgress,
  deleteSession,
  clearAllSendHistory,
  clearOldSessions,
  getRowProgress
};
