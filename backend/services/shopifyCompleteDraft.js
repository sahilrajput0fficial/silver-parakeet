const fetch = require('node-fetch');
const { API_VERSION } = require('./shopifyAuth');
const logger = require('../utils/logger');

/**
 * Complete a Draft Order via Shopify REST API.
 * This converts the draft into a real paid Order.
 *
 * CRITICAL: payment_pending MUST be in the URL as query parameter!
 * Shopify docs: PUT /draft_orders/{id}/complete.json?payment_pending=false
 * Sending in body is silently ignored by Shopify.
 *
 * payment_pending=false → Order marked PAID → triggers Order Confirmation email
 * payment_pending=true  → Order marked PENDING → NO email sent (default!)
 */
async function completeDraftOrder(shopDomain, accessToken, draftOrderId, email) {

  if (!draftOrderId) throw new Error('draftOrderId is missing');
  if (!accessToken) throw new Error('accessToken is missing');

  // Wait 2s to let Shopify process the draft order
  await new Promise(resolve => setTimeout(resolve, 1000));

  const cleanDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

  // CRITICAL FIX: payment_pending=false as QUERY PARAMETER (not body!)
  // This is the ONLY way Shopify reads this parameter
  const url = `https://${cleanDomain}/admin/api/${API_VERSION}/draft_orders/${draftOrderId}/complete.json?payment_pending=false`;

  logger.info(`=== completeDraftOrder ===`);
  logger.info(`URL: ${url}`);
  logger.info(`Draft Order ID: ${draftOrderId}`);
  logger.info(`Customer Email: ${email}`);
  logger.info(`payment_pending: false (in URL query param)`);

  let response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    }
  });

  // If 422 (dev store payment limit), retry with payment_pending=true
  if (response.status === 422) {
    const errText = await response.text();
    logger.info(`payment_pending=false failed (422). Retrying with payment_pending=true...`);
    logger.info(`422 Response: ${errText}`);

    await new Promise(resolve => setTimeout(resolve, 1000));

    const fallbackUrl = `https://${cleanDomain}/admin/api/${API_VERSION}/draft_orders/${draftOrderId}/complete.json?payment_pending=true`;
    response = await fetch(fallbackUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      }
    });
  }

  const responseText = await response.text();
  logger.info(`Response Status: ${response.status}`);

  if (response.status === 429) {
    logger.error('completeDraftOrder', `Rate limited for ${email}`, { status: 429 });
    const err = new Error('Rate limited by Shopify');
    err.statusCode = 429;
    throw err;
  }

  if (!response.ok) {
    logger.error('completeDraftOrder', `Complete failed for ${email}`, {
      status: response.status,
      response: responseText.slice(0, 500)
    });
    throw new Error(`Complete order failed ${response.status}: ${responseText}`);
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error('Invalid JSON from Shopify: ' + responseText.slice(0, 200));
  }

  if (!data?.draft_order?.order_id) {
    logger.error('completeDraftOrder', `No order_id for ${email}`, { response: data });
    throw new Error('Order not created: ' + JSON.stringify(data).slice(0, 200));
  }

  const completedOrder = data.draft_order;
  const orderStatus = completedOrder.status;

  logger.info(`=== ORDER CREATED ===`);
  logger.info(`Order ID: ${completedOrder.order_id}`);
  logger.info(`Draft Status: ${orderStatus}`);
  logger.info(`Email: ${email}`);
  logger.info(`Order Confirmation email should be triggered by Shopify automatically`);

  return completedOrder;
}

module.exports = { completeDraftOrder };
