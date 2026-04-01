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
  incrementDailyLimit
} = require('../db/database');
const { createDraftOrder } = require('../services/shopifyDraftOrder');
const { completeDraftOrder } = require('../services/shopifyCompleteDraft');
const { API_VERSION } = require('../services/shopifyAuth');
const logger = require('../utils/logger');

const MAX_RETRIES = 3;
const RATE_LIMIT_DELAY = 10000; // 10s wait on rate limit (dev stores need more time)
const ROW_DELAY = 3000;         // 3s between rows (dev stores have low rate limits)

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Verify the order was created with correct email and payment status.
 * If order is PAID + has email → Shopify WILL send Order Confirmation email.
 */
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
    logger.info(`Email on order: ${order.email || 'MISSING!'}`);
    logger.info(`Contact email: ${order.contact_email || 'MISSING!'}`);
    logger.info(`Financial status: ${order.financial_status}`);
    logger.info(`Confirmed: ${order.confirmed}`);

    if (!order.email) {
      logger.error('verifyOrder', `WARNING: Order #${orderId} has NO email! Notification will NOT be sent.`);
    }

    if (order.financial_status !== 'paid') {
      logger.error('verifyOrder', `WARNING: Order #${orderId} is "${order.financial_status}" — not "paid". Email may not trigger.`);
    }

    if (order.email && order.financial_status === 'paid') {
      logger.info(`Email CONFIRMED: Shopify will send Order Confirmation to ${order.email}`);
    }
  } catch (err) {
    logger.error('verifyOrder', `Verification failed: ${err.message}`);
  }
}

/**
 * Verify store settings before bulk send.
 */
async function verifyStoreEmailSettings(shopDomain, accessToken) {
  const cleanDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const url = `https://${cleanDomain}/admin/api/2024-01/shop.json`;

  try {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken }
    });

    if (!response.ok) return null;
    const data = await response.json();

    logger.info(`Store: ${data.shop?.name} | Plan: ${data.shop?.plan_name} | Email: ${data.shop?.email}`);
    return data.shop;
  } catch (err) {
    logger.error('verifyStore', err.message);
    return null;
  }
}

/* ─── Test Connection ─── */
router.post('/api/store/test', authenticateToken, async (req, res) => {
  const { shop_domain } = req.body;

  if (!shop_domain) {
    return res.status(400).json({ error: 'shop_domain is required' });
  }

  const store = getStoreByDomain(shop_domain, req.user.id, req.user.role);
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
        shop_email: data.shop.email,
        plan: data.shop.plan_name,
        message: `Connected — ${data.shop.name}`
      });
    } else if (response.status === 401) {
      return res.json({ success: false, status: 'invalid_token', message: 'Invalid token — reconnect store' });
    } else if (response.status === 403) {
      return res.json({ success: false, status: 'missing_scopes', message: 'Missing scopes — reinstall app' });
    } else {
      const errText = await response.text();
      return res.json({ success: false, status: 'error', message: `Connection failed (${response.status}): ${errText}` });
    }
  } catch (err) {
    return res.status(500).json({ success: false, status: 'error', message: `Network error: ${err.message}` });
  }
});

/* ─── Check progress for resume detection ─── */
router.post('/api/invoice/check-progress', authenticateToken, (req, res) => {
  const { rows, shop_domain } = req.body;

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows provided' });
  }
  if (!shop_domain) {
    return res.status(400).json({ error: 'shop_domain is required' });
  }

  const sessionId = generateSessionId(rows, shop_domain, req.user.id);
  const progress = checkExistingProgress(sessionId);

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

/* ─── Delete session (Start Fresh) ─── */
router.post('/api/invoice/delete-session', authenticateToken, (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id is required' });

  deleteSession(session_id, req.user.id, req.user.role);
  return res.json({ success: true, message: 'Session deleted.' });
});

/* ─── Clear ALL send history ─── */
router.delete('/api/invoice/clear-history', authenticateToken, (req, res) => {
  clearAllSendHistory(req.user.id, req.user.role);
  return res.json({ success: true, message: 'All send history cleared.' });
});

/* ════════════════════════════════════════════════════
   BULK ORDER CREATION — Shopify API Only
   
   Step 1: Create Draft Order
   Step 2: Send Invoice (Shopify queues email — GUARANTEED)
   Step 3: Complete Draft Order (marks PAID — triggers Order Confirmation)
   
   Customer gets email from BOTH:
   - send_invoice → Shopify email queue (guaranteed)
   - Complete → Order Confirmation notification (fast)
   ════════════════════════════════════════════════════ */
router.post('/api/invoice/send-bulk', authenticateToken, async (req, res) => {
  const { rows, shop_domain, session_id: clientSessionId, mode } = req.body;

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows provided' });
  }
  if (!shop_domain) {
    return res.status(400).json({ error: 'shop_domain is required' });
  }

  const store = getStoreByDomain(shop_domain, req.user.id, req.user.role);
  if (!store) {
    return res.status(404).json({ error: `Store not found: ${shop_domain}` });
  }

  // Pre-flight scope check
  const scopeCheckDomain = store.shop_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const scopeCheckUrl = `https://${scopeCheckDomain}/admin/api/2024-01/draft_orders.json?limit=1`;

  try {
    const scopeResp = await fetch(scopeCheckUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': store.access_token }
    });

    if (scopeResp.status === 403) {
      return res.status(403).json({ error: 'write_draft_orders scope missing.', scope_error: true });
    }
    if (scopeResp.status === 401) {
      return res.status(401).json({ error: 'Token invalid or expired.', scope_error: true });
    }
  } catch (scopeErr) {
    logger.error('scopeCheck', scopeErr.message);
  }

  // Session handling
  const sessionId = clientSessionId || generateSessionId(rows, shop_domain, req.user.id);
  let progress = checkExistingProgress(sessionId);

  if (mode === 'fresh' && progress.isResume) {
    deleteSession(sessionId, req.user.id, req.user.role);
    progress = { isResume: false, alreadySent: [], lastSentIndex: -1, totalSentSoFar: 0, totalFailed: 0, rows: [] };
  }

  if (!progress.isResume) {
    initSessionRows(sessionId, shop_domain, rows, req.user.id);
  }

  // Verify store
  const shopInfo = await verifyStoreEmailSettings(store.shop_domain, store.access_token);

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const alreadySentCount = progress.alreadySent.length;
  const remainingCount = rows.length - alreadySentCount;

  res.write(`data: ${JSON.stringify({
    type: 'start',
    total: rows.length,
    session_id: sessionId,
    is_resume: progress.isResume,
    already_sent: alreadySentCount,
    remaining: remainingCount,
    store_name: shopInfo?.name || store.shop_domain
  })}\n\n`);

  logger.info('=== BULK SEND START ===');
  logger.info(`Session: ${sessionId} | Total: ${rows.length} | Resume: ${progress.isResume} | Already sent: ${alreadySentCount}`);
  logActivity(req.user.id, 'Bulk Send Started', `Started bulk send for ${rows.length} rows on ${store.shop_domain}`, req.ip);

  let sentCount = alreadySentCount;
  let failedCount = 0;
  let skippedCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // ─── SKIP if already sent ───
    if (progress.alreadySent.includes(i)) {
      skippedCount++;
      const prevRow = progress.rows.find(r => r.row_index === i && r.status === 'sent');

      res.write(`data: ${JSON.stringify({
        type: 'result',
        index: i,
        email: row.email,
        status: 'Skipped',
        skipped: true,
        order_id: prevRow?.order_id || null
      })}\n\n`);

      logger.info(`Row ${i + 1} SKIPPED (already sent to ${row.email})`);
      continue;
    }

    // ─── Process this row ───
    const dailyCheck = checkDailyLimit(req.user.id);
    if (!dailyCheck.passes) {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        message: `Daily limit reached (${dailyCheck.limit}/${dailyCheck.limit}). Resets tomorrow at midnight.`
      })}\n\n`);
      logger.error('BulkSend', `Daily limit reached for user ${req.user.username}`);
      break; 
    }

    let status = 'Failed';
    let draftOrderId = null;
    let realOrderId = null;
    let errorMessage = '';
    let retries = 0;
    let success = false;

    logger.info(`--- Row ${i + 1}/${rows.length}: ${row.email} | ${row.product_name} ---`);

    res.write(`data: ${JSON.stringify({
      type: 'progress',
      index: i,
      email: row.email,
      status: 'Sending'
    })}\n\n`);

    // Retry loop
    while (retries < MAX_RETRIES && !success) {
      try {
        // ═══ STEP 1: Create Draft Order ═══
        const draftOrder = await createDraftOrder(
          store.shop_domain,
          store.access_token,
          row
        );
        draftOrderId = draftOrder.id;
        logger.info(`Step 1 OK: Draft #${draftOrderId}`);

        // ═══ STEP 2: Complete Draft Order ═══
        // payment_pending=false in URL query param → marks PAID
        // Shopify auto-triggers "Order Confirmation" email
        const completed = await completeDraftOrder(
          store.shop_domain,
          store.access_token,
          draftOrderId,
          row.email
        );
        realOrderId = completed.order_id;
        logger.info(`Step 2 OK: Completed -> Order #${realOrderId}`);

        // ═══ STEP 3: Verify order was created correctly ═══
        await verifyOrderEmail(store.shop_domain, store.access_token, realOrderId, row.email);

        status = 'Completed';
        success = true;
        sentCount++;
        incrementUsage(store.shop_domain);
        incrementDailyLimit(req.user.id);

        // Save to database
        updateRowProgress(sessionId, i, 'sent', String(realOrderId), String(draftOrderId), null);

        logger.info(`=== Row ${i + 1} SUCCESS: Order #${realOrderId} -> ${row.email} ===`);

      } catch (error) {
        retries++;
        errorMessage = error.message;

        logger.error('Row Failed', `Row ${i + 1}: ${row.email} - Attempt ${retries}/${MAX_RETRIES}: ${error.message}`);

        if (error.statusCode === 429 && retries < MAX_RETRIES) {
          res.write(`data: ${JSON.stringify({
            type: 'retry',
            index: i,
            email: row.email,
            retry: retries,
            message: 'Rate limited, retrying...'
          })}\n\n`);
          await delay(RATE_LIMIT_DELAY);
          continue;
        }

        if (retries >= MAX_RETRIES) break;

        status = !draftOrderId ? 'Failed - Order Error' : 'Failed - Complete Error';
        break;
      }
    }

    if (!success) {
      failedCount++;
      status = !draftOrderId ? 'Failed - Order Error' : 'Failed - Complete Error';
      updateRowProgress(sessionId, i, 'failed', null, draftOrderId ? String(draftOrderId) : null, errorMessage);
    }

    // Send result
    res.write(`data: ${JSON.stringify({
      type: 'result',
      index: i,
      email: row.email,
      status,
      draft_order_id: draftOrderId,
      order_id: realOrderId,
      error: success ? null : errorMessage
    })}\n\n`);

    // 2 seconds delay between each row
    if (i < rows.length - 1) {
      console.log(`Waiting 2 seconds before next email...`);
      console.log(`Next email: ${rows[i + 1]?.email}`);
      
      res.write(`data: ${JSON.stringify({
        type: 'waiting',
        seconds: 2
      })}\n\n`);

      await new Promise(resolve => 
        setTimeout(resolve, 2000)
      );
    }
  }

  const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);
  const newlySent = sentCount - alreadySentCount;

  logger.info('=== BULK SEND COMPLETE ===');
  logger.info(`Total: ${rows.length} | Skipped: ${skippedCount} | Newly Sent: ${newlySent} | Failed: ${failedCount} | Time: ${timeTaken}s`);
  logActivity(req.user.id, 'Bulk Send Completed', `Completed bulk send for ${rows.length} rows on ${store.shop_domain}. ${newlySent} sent, ${failedCount} failed.`, req.ip);

  res.write(`data: ${JSON.stringify({
    type: 'complete',
    session_id: sessionId,
    total: rows.length,
    total_sent: sentCount,
    newly_sent: newlySent,
    total_skipped: skippedCount,
    total_failed: failedCount,
    time_taken: `${timeTaken}s`
  })}\n\n`);

  res.end();
});

module.exports = router;
