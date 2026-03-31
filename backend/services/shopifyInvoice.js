const fetch = require('node-fetch');
const { API_VERSION } = require('./shopifyAuth');
const logger = require('../utils/logger');

/**
 * Send an invoice for an existing Draft Order via Shopify REST API.
 * Waits 1500ms before calling to let Shopify process the draft order.
 * Full debug logging on every step.
 */
async function sendInvoice(shopDomain, accessToken, draftOrderId, rowData, subject, customMessage) {

  if (!draftOrderId) throw new Error('draftOrderId is missing');
  if (!accessToken) throw new Error('accessToken is missing');

  // Wait 1500ms after draft order creation
  logger.info(`Sending invoice to ${rowData.email}...`);
  await new Promise(resolve => setTimeout(resolve, 1500));

  const cleanDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const url = `https://${cleanDomain}/admin/api/${API_VERSION}/draft_orders/${draftOrderId}/send_invoice.json`;

  const emailSubject = (subject || 'Your Order Invoice — {product_name}')
    .replace(/\{product_name\}/g, rowData.product_name || '')
    .replace(/\{first_name\}/g, rowData.first_name || '');

  const emailMessage = (customMessage || 'Dear {first_name}, please find your order invoice below.')
    .replace(/\{product_name\}/g, rowData.product_name || '')
    .replace(/\{first_name\}/g, rowData.first_name || '');

  const body = {
    draft_order_invoice: {
      to: rowData.email,
      subject: emailSubject,
      custom_message: emailMessage
    }
  };

  // LOG REQUEST
  logger.request('POST', url, {
    draft_order_id: draftOrderId,
    sending_to: rowData.email,
    subject: emailSubject
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    },
    body: JSON.stringify(body)
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
    logger.error('sendInvoice', `Rate limited for ${rowData.email}`, { status: 429 });
    const err = new Error('Rate limited by Shopify');
    err.statusCode = 429;
    throw err;
  }

  if (!response.ok) {
    logger.error('sendInvoice', `Invoice failed for ${rowData.email}`, {
      status: response.status,
      response: responseData
    });
    throw new Error(`send_invoice failed: ${response.status} — ${responseText}`);
  }

  // LOG SUCCESS — this is the KEY log
  logger.invoice(rowData.email, 'SENT', {
    draft_order_id: draftOrderId,
    shopify_response: responseData,
    email_details: responseData?.draft_order_invoice || 'check above'
  });

  return responseData;
}

module.exports = { sendInvoice };
