const fetch = require('node-fetch');
const { API_VERSION } = require('./shopifyAuth');
const logger = require('../utils/logger');

/**
 * Complete a Draft Order via Shopify REST API.
 * This marks the draft as PAID and creates a real Order.
 * Shopify will automatically send an Order Confirmation email to the customer.
 *
 * PUT /admin/api/{version}/draft_orders/{draft_order_id}/complete.json
 * Query param: payment_pending=false (mark as fully paid)
 */
async function completeDraftOrder(shopDomain, accessToken, draftOrderId, customerEmail) {

  if (!draftOrderId) throw new Error('draftOrderId is missing');
  if (!accessToken) throw new Error('accessToken is missing');

  // Wait 1500ms after draft order creation to let Shopify process it
  logger.info(`Waiting 1500ms before completing draft order for ${customerEmail}...`);
  await new Promise(resolve => setTimeout(resolve, 1500));

  const cleanDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

  // payment_pending=false means the order is fully paid
  const url = `https://${cleanDomain}/admin/api/${API_VERSION}/draft_orders/${draftOrderId}/complete.json?payment_pending=false`;

  // LOG REQUEST
  logger.request('PUT', url, {
    draft_order_id: draftOrderId,
    customer_email: customerEmail,
    action: 'COMPLETE (mark as paid → triggers order confirmation email)'
  });

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    }
  });

  const responseText = await response.text();
  let responseData;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = { raw: responseText };
  }

  // LOG FULL RESPONSE
  logger.response(url, response.status, responseData);

  if (response.status === 429) {
    logger.error('completeDraftOrder', `Rate limited for ${customerEmail}`, { status: 429 });
    const err = new Error('Rate limited by Shopify');
    err.statusCode = 429;
    throw err;
  }

  if (!response.ok) {
    logger.error('completeDraftOrder', `Complete failed for ${customerEmail}`, {
      status: response.status,
      response: responseData
    });
    throw new Error(`complete_draft_order failed: ${response.status} — ${responseText}`);
  }

  const completedOrder = responseData.draft_order;
  const realOrderId = completedOrder?.order_id;

  // LOG SUCCESS
  logger.info(`✅ Draft Order COMPLETED for ${customerEmail}`, {
    draft_order_id: draftOrderId,
    real_order_id: realOrderId || 'pending',
    status: completedOrder?.status,
    order_status_url: completedOrder?.order_status_url || 'N/A',
    message: 'Shopify will now send Order Confirmation email automatically!'
  });

  return {
    draft_order: completedOrder,
    real_order_id: realOrderId,
    order_status_url: completedOrder?.order_status_url
  };
}

module.exports = { completeDraftOrder };
