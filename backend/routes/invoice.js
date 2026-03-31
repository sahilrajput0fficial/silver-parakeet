const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const {
  getStoreByDomain,
  incrementUsage,
  generateSessionId,
  checkExistingProgress,
  initSessionRows,
  updateRowProgress,
  deleteSession,
  clearAllSendHistory
} = require('../db/database');
const { createDraftOrder } = require('../services/shopifyDraftOrder');
const { sendInvoice } = require('../services/shopifyInvoice');
const { completeDraftOrder } = require('../services/shopifyCompleteDraft');
const logger = require('../utils/logger');

const MAX_RETRIES = 3;
const RATE_LIMIT_DELAY = 10000; // 10s wait on rate limit (dev stores need more time)
const ROW_DELAY = 3000;         // 3s between rows (dev stores have low rate limits)

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
router.post('/api/store/test', async (req, res) => {
  const { shop_domain } = req.body;

  if (!shop_domain) {
    return res.status(400).json({ error: 'shop_domain is required' });
  }

  const store = getStoreByDomain(shop_domain);
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
router.post('/api/invoice/check-progress', (req, res) => {
  const { rows, shop_domain } = req.body;

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows provided' });
  }
  if (!shop_domain) {
    return res.status(400).json({ error: 'shop_domain is required' });
  }

  const sessionId = generateSessionId(rows, shop_domain);
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
router.post('/api/invoice/delete-session', (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id is required' });

  deleteSession(session_id);
  return res.json({ success: true, message: 'Session deleted.' });
});

/* ─── Clear ALL send history ─── */
router.delete('/api/invoice/clear-history', (req, res) => {
  clearAllSendHistory();
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
router.post('/api/invoice/send-bulk', async (req, res) => {
  const { rows, shop_domain, session_id: clientSessionId, mode } = req.body;

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows provided' });
  }
  if (!shop_domain) {
    return res.status(400).json({ error: 'shop_domain is required' });
  }

  const store = getStoreByDomain(shop_domain);
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
  const sessionId = clientSessionId || generateSessionId(rows, shop_domain);
  let progress = checkExistingProgress(sessionId);

  if (mode === 'fresh' && progress.isResume) {
    deleteSession(sessionId);
    progress = { isResume: false, alreadySent: [], lastSentIndex: -1, totalSentSoFar: 0, totalFailed: 0, rows: [] };
  }

  if (!progress.isResume) {
    initSessionRows(sessionId, shop_domain, rows);
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

        // ═══ STEP 2: Send Invoice (Shopify email — guaranteed delivery) ═══
        try {
          await sendInvoice(
            store.shop_domain,
            store.access_token,
            draftOrderId,
            row,
            'Order Confirmation - {product_name}',
            'Hi {first_name}, your order has been confirmed. Thank you for your purchase!'
          );
          logger.info(`Step 2 OK: Invoice sent to ${row.email}`);
        } catch (invoiceErr) {
          // Invoice send failed — log but don't stop (Step 3 will also trigger email)
          logger.error('sendInvoice', `Invoice failed for ${row.email} (non-critical): ${invoiceErr.message}`);
        }

        // ═══ STEP 3: Complete Draft Order (marks PAID → triggers Order Confirmation) ═══
        const completed = await completeDraftOrder(
          store.shop_domain,
          store.access_token,
          draftOrderId,
          row.email
        );
        realOrderId = completed.order_id;
        logger.info(`Step 3 OK: Completed -> Order #${realOrderId}`);

        status = 'Completed';
        success = true;
        sentCount++;
        incrementUsage(store.shop_domain);

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

    // Delay between rows
    if (i < rows.length - 1) {
      await delay(ROW_DELAY);
    }
  }

  const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);
  const newlySent = sentCount - alreadySentCount;

  logger.info('=== BULK SEND COMPLETE ===');
  logger.info(`Total: ${rows.length} | Skipped: ${skippedCount} | Newly Sent: ${newlySent} | Failed: ${failedCount} | Time: ${timeTaken}s`);

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
