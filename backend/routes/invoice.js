const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const { authenticateToken } = require('../middleware/authMiddleware');
const {
  getStoreByDomain,
  incrementUsage,
  generateSessionId,
  checkExistingProgress,
  initSessionRows,
  updateRowProgress,
  deleteSession,
  clearAllSendHistory,
  logActivity,
  checkDailyLimit,
  incrementDailyLimit,
  getNextAvailableAPI,
  markAPIUsed,
  markAPIExhausted
} = require('../db/database');
const { createDraftOrder } = require('../services/shopifyDraftOrder');
const { completeDraftOrder } = require('../services/shopifyCompleteDraft');
const { API_VERSION } = require('../services/shopifyAuth');
const logger = require('../utils/logger');

const MAX_RETRIES = 3;
const RATE_LIMIT_DELAY = 10000;
const ROW_DELAY = 10000;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function verifyOrderEmail(shopDomain, accessToken, orderId, expectedEmail) {
  try {
    const cleanDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const url = `https://${cleanDomain}/admin/api/${API_VERSION}/orders/${orderId}.json?fields=id,email,financial_status,confirmed,contact_email`;

    const response = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      logger.error('verifyOrder', `Cannot verify order #${orderId}: ${response.status}`);
      return;
    }

    const data = await response.json();
    const order = data.order;

    logger.info(`=== ORDER VERIFICATION #${orderId} ===`);
    if (!order.email) {
      logger.error('verifyOrder', `WARNING: Order #${orderId} has NO email!`);
    }
  } catch (err) {
    logger.error('verifyOrder', `Verification failed: ${err.message}`);
  }
}

/* ─── Test Connection ─── */
router.post('/api/store/test', authenticateToken, async (req, res) => {
  const { shop_domain } = req.body;

  if (!shop_domain) {
    return res.status(400).json({ error: 'shop_domain is required' });
  }

  const store = await getStoreByDomain(shop_domain, req.user.id, req.user.role);
  if (!store) {
    return res.status(404).json({ error: `Store not found: ${shop_domain}` });
  }

  const cleanDomain = store.shop_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const url = `https://${cleanDomain}/admin/api/2024-01/shop.json`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'X-Shopify-Access-Token': store.access_token, 'Content-Type': 'application/json' }
    });

    if (response.status === 200) {
      const data = await response.json();
      return res.json({
        success: true,
        status: 'connected',
        shop_name: data.shop.name,
        message: `Connected — ${data.shop.name}`
      });
    } else {
      return res.json({ success: false, status: 'error', message: `Connection failed: ${response.status}` });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: `Network error: ${err.message}` });
  }
});

/* ─── Check progress ─── */
router.post('/api/invoice/check-progress', authenticateToken, async (req, res) => {
  const { rows, shop_domain } = req.body;
  let effectiveShopDomain = shop_domain;
  
  if (!effectiveShopDomain || effectiveShopDomain === 'API_POOL') {
    const currentAPI = await getNextAvailableAPI(req.user.id);
    if (!currentAPI) {
      return res.status(400).json({ error: 'No active API found' });
    }
    effectiveShopDomain = currentAPI.shop_domain;
  }

  const sessionId = generateSessionId(rows, effectiveShopDomain, req.user.id);
  const progress = await checkExistingProgress(sessionId);

  return res.json({
    session_id: sessionId,
    is_resume: progress.isResume,
    already_sent: progress.alreadySent.length,
    already_failed: progress.totalFailed,
    remaining: rows.length - progress.alreadySent.length,
    last_sent_index: progress.lastSentIndex,
    total_rows: rows.length,
    sent_indices: progress.alreadySent,
    failed_indices: progress.failedRows || [],
    sent_details: progress.rows
      .filter(r => r.status === 'sent')
      .map(r => ({ row_index: r.row_index, email: r.email, order_id: r.order_id }))
  });
});

/* ─── Delete session ─── */
router.post('/api/invoice/delete-session', authenticateToken, async (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id is required' });

  await deleteSession(session_id, req.user.id, req.user.role);
  return res.json({ success: true, message: 'Session deleted.' });
});

/* ─── Clear history ─── */
router.delete('/api/invoice/clear-history', authenticateToken, async (req, res) => {
  await clearAllSendHistory(req.user.id, req.user.role);
  return res.json({ success: true, message: 'All send history cleared.' });
});

/* ─── Bulk Send ─── */
router.post('/api/invoice/send-bulk', authenticateToken, async (req, res) => {
  const { rows, shop_domain, session_id: clientSessionId, mode } = req.body;

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows provided' });
  }
  
  let currentAPI = await getNextAvailableAPI(req.user.id);
  if (!currentAPI) {
    return res.status(404).json({ error: 'No API available.' });
  }

  const effectiveShopDomain = (shop_domain === 'API_POOL' || !shop_domain) ? currentAPI.shop_domain : shop_domain;
  const sessionId = clientSessionId || generateSessionId(rows, effectiveShopDomain, req.user.id);
  let progress = await checkExistingProgress(sessionId);

  if (mode === 'fresh' && progress.isResume) {
    await deleteSession(sessionId, req.user.id, req.user.role);
    progress = { isResume: false, alreadySent: [], totalSentSoFar: 0, totalFailed: 0, rows: [] };
  }

  if (!progress.isResume) {
    await initSessionRows(sessionId, effectiveShopDomain, rows, req.user.id);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const alreadySentCount = progress.alreadySent.length;
  res.write(`data: ${JSON.stringify({ type: 'start', total: rows.length, session_id: sessionId, already_sent: alreadySentCount })}\n\n`);

  await logActivity(req.user.id, 'Bulk Send Started', `Started bulk send for ${rows.length} rows`, req.ip);

  let sentCount = alreadySentCount;
  let failedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (progress.alreadySent.includes(i)) {
      res.write(`data: ${JSON.stringify({ type: 'result', index: i, email: row.email, status: 'Skipped', skipped: true })}\n\n`);
      continue;
    }

    const { passes } = await checkDailyLimit(req.user.id);
    if (!passes) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Daily limit reached.' })}\n\n`);
      break; 
    }

    let status = 'Failed';
    let draftOrderId = null;
    let realOrderId = null;
    let errorMessage = '';
    let success = false;

    try {
      const draftOrder = await createDraftOrder(currentAPI.shop_domain, currentAPI.access_token, row);
      draftOrderId = draftOrder.id;

      const completed = await completeDraftOrder(currentAPI.shop_domain, currentAPI.access_token, draftOrderId, row.email);
      realOrderId = completed.order_id;
      
      await verifyOrderEmail(currentAPI.shop_domain, currentAPI.access_token, realOrderId, row.email);

      status = 'Completed';
      success = true;
      sentCount++;
      
      await markAPIUsed(currentAPI.id);
      await incrementDailyLimit(req.user.id);
      await updateRowProgress(sessionId, i, 'sent', String(realOrderId), String(draftOrderId), null, currentAPI.id, currentAPI.api_name);
    } catch (error) {
      errorMessage = error.message;
      failedCount++;
      await updateRowProgress(sessionId, i, 'failed', null, draftOrderId ? String(draftOrderId) : null, errorMessage, currentAPI.id, currentAPI.api_name);
    }

    res.write(`data: ${JSON.stringify({
      type: 'result',
      index: i,
      email: row.email,
      status,
      api_used: currentAPI.api_name,
      order_id: realOrderId,
      error: success ? null : errorMessage
    })}\n\n`);

    if (i < rows.length - 1) {
      await delay(10000);
    }
  }

  await logActivity(req.user.id, 'Bulk Send Completed', `Completed bulk send. ${sentCount} total sent.`, req.ip);
  res.write(`data: ${JSON.stringify({ type: 'complete', total_sent: sentCount, total_failed: failedCount })}\n\n`);
  res.end();
});

module.exports = router;
