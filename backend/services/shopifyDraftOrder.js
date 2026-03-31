const fetch = require('node-fetch');
const { API_VERSION } = require('./shopifyAuth');
const logger = require('../utils/logger');

/**
 * Create a Draft Order via Shopify REST API.
 * Full debug logging on every step.
 */
async function createDraftOrder(shopDomain, accessToken, rowData) {

  // Step 1: Validate inputs before API call
  if (!shopDomain) throw new Error('shopDomain is missing');
  if (!accessToken) throw new Error('accessToken is missing');
  if (!rowData.email) throw new Error('customer email is missing');

  const cleanDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const url = `https://${cleanDomain}/admin/api/${API_VERSION}/draft_orders.json`;

  const body = {
    draft_order: {
      email: rowData.email,
      send_receipt: false,
      send_fulfillment_receipt: false,
      line_items: [{
        title: rowData.product_name,
        price: String(rowData.product_price),
        quantity: 1,
        requires_shipping: true
      }],
      customer: {
        email: rowData.email,
        first_name: rowData.first_name,
        last_name: rowData.last_name,
        phone: rowData.phone || ''
      },
      shipping_address: {
        first_name: rowData.first_name,
        last_name: rowData.last_name,
        address1: rowData.address_line,
        city: rowData.city,
        province: rowData.state,
        zip: rowData.postal_code,
        country: rowData.country,
        phone: rowData.phone || ''
      },
      use_customer_default_address: false
    }
  };

  // LOG REQUEST
  logger.request('POST', url, {
    email: rowData.email,
    product: rowData.product_name,
    price: rowData.product_price,
    token_preview: accessToken ? accessToken.slice(0, 15) + '...' : 'MISSING'
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    },
    body: JSON.stringify(body)
  });

  // Step 3: Parse response
  const responseText = await response.text();
  let responseData;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = { raw: responseText };
  }

  // LOG RESPONSE
  logger.response(url, response.status, responseData);

  if (response.status === 429) {
    logger.error('createDraftOrder', `Rate limited for ${rowData.email}`, { status: 429 });
    const err = new Error('Rate limited by Shopify');
    err.statusCode = 429;
    throw err;
  }

  if (!response.ok) {
    logger.error('createDraftOrder', `Failed for ${rowData.email}`, {
      status: response.status,
      response: responseData
    });
    throw new Error(`Draft order failed: ${response.status} — ${responseText}`);
  }

  // Step 4: Verify draft_order_id exists
  if (!responseData?.draft_order?.id) {
    logger.error('createDraftOrder', `No draft_order id returned for ${rowData.email}`, responseData);
    throw new Error('Shopify returned no draft_order id: ' + responseText);
  }

  const draftOrder = responseData.draft_order;
  const customerId = draftOrder.customer?.id;

  // LOG SUCCESS
  logger.draftOrder(rowData.email, 'CREATED', {
    draft_order_id: draftOrder.id,
    status: draftOrder.status,
    customer_id: customerId
  });

  // NOTE: subscribeCustomerToMarketing removed — requires write_customers scope

  return draftOrder;
}

/**
 * Update customer email_marketing_consent via Shopify Customer API.
 */
async function subscribeCustomerToMarketing(shopDomain, accessToken, customerId, customerEmail) {
  const url = `https://${shopDomain}/admin/api/${API_VERSION}/customers/${customerId}.json`;

  const body = {
    customer: {
      id: customerId,
      email: customerEmail,
      email_marketing_consent: {
        state: 'subscribed',
        opt_in_level: 'single_opt_in'
      }
    }
  };

  try {
    logger.request('PUT', url, { customer_id: customerId, email: customerEmail });

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (response.ok) {
      logger.info(`Customer ${customerId} subscribed to email marketing`);
    } else {
      const errText = await response.text();
      logger.error('subscribeCustomerToMarketing', `Subscribe failed for ${customerId}`, { response: errText });
    }
  } catch (err) {
    logger.error('subscribeCustomerToMarketing', `Subscribe error for ${customerId}`, { error: err.message });
  }
}

module.exports = { createDraftOrder };
