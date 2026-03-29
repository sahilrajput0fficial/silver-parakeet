const express = require('express');
const router = express.Router();
const { getStoreByDomain, incrementUsage } = require('../db/database');
const { createDraftOrder } = require('../services/shopifyDraftOrder');
const { sendInvoice } = require('../services/shopifyInvoice');
const logger = require('../utils/logger');

const MAX_RETRIES = 3;
const RATE_LIMIT_DELAY = 2000;
const ROW_DELAY = 500;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

  const fetch = require('node-fetch');
  const cleanDomain = store.shop_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const url = `https://${cleanDomain}/admin/api/2024-01/shop.json`;

  try {
    logger.request('GET', url, { shop_domain: cleanDomain });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': store.access_token,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 200) {
      const data = await response.json();
      logger.response(url, 200, { shop_name: data.shop.name, plan: data.shop.plan_name });
      return res.json({
        success: true,
        status: 'connected',
        shop_name: data.shop.name,
        shop_email: data.shop.email,
        plan: data.shop.plan_name,
        message: `Connected ✓ — ${data.shop.name}`
      });
    } else if (response.status === 401) {
      logger.error('testConnection', 'Invalid token', { status: 401 });
      return res.json({
        success: false,
        status: 'invalid_token',
        message: 'Invalid token — reconnect store'
      });
    } else if (response.status === 403) {
      logger.error('testConnection', 'Missing scopes', { status: 403 });
      return res.json({
        success: false,
        status: 'missing_scopes',
        message: 'Missing scopes — reinstall app'
      });
    } else {
      const errText = await response.text();
      logger.error('testConnection', `Connection failed`, { status: response.status, response: errText });
      return res.json({
        success: false,
        status: 'error',
        message: `Connection failed (${response.status}): ${errText}`
      });
    }
  } catch (err) {
    logger.error('testConnection', `Network error`, { error: err.message });
    return res.status(500).json({
      success: false,
      status: 'error',
      message: `Network error: ${err.message}`
    });
  }
});

/* ─── Bulk Invoice Sending via SSE ─── */
router.post('/api/invoice/send-bulk', async (req, res) => {
  const { rows, subject, custom_message, shop_domain } = req.body;

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

  // ── Pre-flight scope check before starting bulk send ──
  const fetch = require('node-fetch');
  const scopeCheckDomain = store.shop_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const scopeCheckUrl = `https://${scopeCheckDomain}/admin/api/2024-01/draft_orders.json?limit=1`;

  try {
    logger.info('Pre-flight scope check', { url: scopeCheckUrl });

    const scopeResp = await fetch(scopeCheckUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': store.access_token
      }
    });

    if (scopeResp.status === 403) {
      logger.error('scopeCheck', 'write_draft_orders scope missing', { status: 403 });
      return res.status(403).json({
        error: 'write_draft_orders scope is not approved for this store. Click "Reconnect Store" to reauthorize.',
        scope_error: true
      });
    }

    if (scopeResp.status === 401) {
      logger.error('scopeCheck', 'Token invalid or expired', { status: 401 });
      return res.status(401).json({
        error: 'Access token is invalid or expired. Click "Reconnect Store" to get a new token.',
        scope_error: true
      });
    }

    logger.info('Scope check passed ✓', { status: scopeResp.status });
  } catch (scopeErr) {
    logger.error('scopeCheck', `Scope pre-check failed: ${scopeErr.message}`);
  }

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // LOG BULK SEND START
  logger.info('BULK SEND STARTED', {
    total_rows: rows.length,
    shop_domain: store.shop_domain,
    token_exists: !!store.access_token,
    token_preview: store.access_token ? store.access_token.slice(0, 15) + '...' : 'MISSING'
  });

  res.write(`data: ${JSON.stringify({ type: 'start', total: rows.length })}\n\n`);

  let sentCount = 0;
  let failedCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let status = 'Failed';
    let draftOrderId = null;
    let errorMessage = '';
    let retries = 0;
    let success = false;

    // LOG each row start
    logger.info(`Processing row ${i + 1}/${rows.length}`, {
      email: row.email,
      product: row.product_name,
      price: row.product_price
    });

    // Send "sending" status
    res.write(`data: ${JSON.stringify({
      type: 'progress',
      index: i,
      email: row.email,
      status: 'Sending'
    })}\n\n`);

    // Retry loop
    while (retries < MAX_RETRIES && !success) {
      try {
        // Step 1: Create draft order
        const draftOrder = await createDraftOrder(
          store.shop_domain,
          store.access_token,
          row
        );
        draftOrderId = draftOrder.id;

        // Step 2: Send invoice (has built-in 1500ms delay)
        await sendInvoice(
          store.shop_domain,
          store.access_token,
          draftOrderId,
          row,
          subject,
          custom_message
        );

        status = 'Sent ✓';
        success = true;
        sentCount++;
        incrementUsage(store.shop_domain);

        // LOG row success
        logger.info(`Row ${i + 1} COMPLETE`, {
          email: row.email,
          draft_order_id: draftOrderId,
          invoice_sent: true
        });

      } catch (error) {
        retries++;
        errorMessage = error.message;

        // LOG row failure
        logger.error('Bulk Send Row Failed', `Row ${i + 1}: ${row.email} — Attempt ${retries}/${MAX_RETRIES}`, {
          draft_order_id: draftOrderId || 'NOT CREATED',
          error: error.message
        });

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

        if (!draftOrderId) {
          status = 'Failed - Order Error';
        } else {
          status = 'Failed - Email Error';
        }
        break;
      }
    }

    if (!success) {
      failedCount++;
      if (!draftOrderId) {
        status = 'Failed - Order Error';
      } else {
        status = 'Failed - Email Error';
      }
    }

    // Send result event WITH error message for UI display
    res.write(`data: ${JSON.stringify({
      type: 'result',
      index: i,
      email: row.email,
      status,
      draft_order_id: draftOrderId,
      error: success ? null : errorMessage
    })}\n\n`);

    // Delay between rows
    if (i < rows.length - 1) {
      await delay(ROW_DELAY);
    }
  }

  const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);

  // LOG BULK SEND COMPLETE
  logger.info('BULK SEND COMPLETE', {
    total: rows.length,
    sent: sentCount,
    failed: failedCount,
    time_taken: `${timeTaken}s`
  });

  res.write(`data: ${JSON.stringify({
    type: 'complete',
    total_sent: sentCount,
    total_failed: failedCount,
    time_taken: `${timeTaken}s`
  })}\n\n`);

  res.end();
});

module.exports = router;
