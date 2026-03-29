const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

// --- Configuration ---
const dbPath = path.join(__dirname, 'shopify_app.db');
const db = new Database(dbPath);

// Encryption Key should be 32 bytes for AES-256-CBC
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; 

// Initialize database schema (matching existing shopify_app.db)
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

// --- Database Operations ---

function addStore(api_name, shop_domain, access_token, max_orders = 100) {
  const { iv, encrypted } = encrypt(access_token);
  const stmt = db.prepare(`
    INSERT INTO stores (api_name, shop_domain, access_token_encrypted, access_token_iv, max_orders)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(shop_domain) DO UPDATE SET
      api_name = excluded.api_name,
      access_token_encrypted = excluded.access_token_encrypted,
      access_token_iv = excluded.access_token_iv,
      max_orders = excluded.max_orders
  `);
  return stmt.run(api_name, shop_domain, encrypted, iv, max_orders);
}

function getAllStores() {
  const rows = db.prepare('SELECT * FROM stores ORDER BY created_at DESC').all();
  return rows.map(row => ({
    id: row.id,
    api_name: row.api_name,
    shop_domain: row.shop_domain,
    access_token: decrypt(row.access_token_encrypted, row.access_token_iv),
    max_orders: row.max_orders,
    usage_count: row.usage_count,
    created_at: row.created_at
  }));
}

function getStoreByDomain(shop_domain) {
  const row = db.prepare('SELECT * FROM stores WHERE shop_domain = ?').get(shop_domain);
  if (!row) return null;
  
  return {
    id: row.id,
    api_name: row.api_name,
    shop_domain: row.shop_domain,
    access_token: decrypt(row.access_token_encrypted, row.access_token_iv),
    max_orders: row.max_orders,
    usage_count: row.usage_count,
    created_at: row.created_at
  };
}

function deleteStoreByDomain(shop_domain) {
  return db.prepare('DELETE FROM stores WHERE shop_domain = ?').run(shop_domain);
}

function deleteAllStores() {
  return db.prepare('DELETE FROM stores').run();
}

function incrementUsage(shop_domain) {
  return db.prepare('UPDATE stores SET usage_count = usage_count + 1 WHERE shop_domain = ?').run(shop_domain);
}

function resetAllUsage() {
  return db.prepare('UPDATE stores SET usage_count = 0').run();
}

module.exports = {
  addStore,
  getAllStores,
  getStoreByDomain,
  deleteStoreByDomain,
  deleteAllStores,
  incrementUsage,
  resetAllUsage
};
