const fetch = require('node-fetch');
const { API_VERSION } = require('./shopifyAuth');
const logger = require('../utils/logger');

/**
 * Complete a Draft Order via Shopify REST API.
 * This converts the draft into a real Order.
 *
 * PUT /admin/api/{version}/draft_orders/{draft_order_id}/complete.json
 *
 * payment_pending in BODY:
 * - false → Marks as PAID (may hit dev store payment processor limit)
 * - true  → Marks as PENDING (works on dev stores, no processor needed)
 *
 * For dev stores: payment_pending=true avoids 422 errors
 * For paid stores: payment_pending=false marks as fully paid
 */
async function completeDraftOrder(shopDomain, accessToken, draftOrderId, email) {

  if (!draftOrderId) throw new Error('draftOrderId is missing');
  if (!accessToken) throw new Error('accessToken is missing');

  // Wait 2000ms before completing (avoid rate limits on dev stores)
  await new Promise(resolve => setTimeout(resolve, 2000));

  const cleanDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

  const url = `https://${cleanDomain}/admin/api/${API_VERSION}/draft_orders/${draftOrderId}/complete.json`;

  logger.info(`=== completeDraftOrder ===`);
  logger.info(`URL: ${url}`);
  logger.info(`Draft Order ID: ${draftOrderId}`);
  logger.info(`Customer Email: ${email}`);

  // Try with payment_pending: false first (paid stores)
  // If it fails with 422, retry with payment_pending: true (dev stores)
  let paymentPending = false;
  let response = await makeCompleteRequest(url, accessToken, paymentPending);

  // If 422 (dev store payment limit), retry with payment_pending: true
  if (response.status === 422) {
    const errText = await response.text();
    logger.info(`payment_pending:false failed (422). Retrying with payment_pending:true for dev store...`);
    logger.info(`422 Response: ${errText}`);

    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, 1000));

    paymentPending = true;
    response = await makeCompleteRequest(url, accessToken, paymentPending);
  }

  const responseText = await response.text();

  logger.info(`Status: ${response.status}`);
  logger.info(`payment_pending: ${paymentPending}`);

  if (response.status === 429) {
    logger.error('completeDraftOrder', `Rate limited for ${email}`, { status: 429 });
    const err = new Error('Rate limited by Shopify');
    err.statusCode = 429;
    throw err;
  }

  if (!response.ok) {
    logger.error('completeDraftOrder', `Complete failed for ${email}`, {
      status: response.status,
      response: responseText.slice(0, 300)
    });
    throw new Error(`Complete order failed ${response.status}: ${responseText}`);
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error('Invalid JSON response: ' + responseText);
  }

  if (!data?.draft_order?.order_id) {
    logger.error('completeDraftOrder', `Order not created for ${email}`, { response: data });
    throw new Error('Order not created: ' + responseText);
  }

  const completedOrder = data.draft_order;

  logger.info(`=== SUCCESS ===`);
  logger.info(`Order ID: ${completedOrder.order_id}`);
  logger.info(`Payment: ${paymentPending ? 'PENDING' : 'PAID'}`);
  logger.info(`Email: ${email}`);

  return completedOrder;
}

/**
 * Make the PUT request to complete the draft order.
 */
async function makeCompleteRequest(url, accessToken, paymentPending) {
  return fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    },
    body: JSON.stringify({
      payment_pending: paymentPending
    })
  });
}

module.exports = { completeDraftOrder };
