const fetch = require('node-fetch');
const crypto = require('crypto');

const API_VERSION = '2024-01';

/**
 * Build the OAuth authorization URL for a Shopify store.
 */
function buildAuthUrl(shopDomain, clientId, scopes, redirectUri, state) {
  const cleanDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${cleanDomain}/admin/oauth/authorize?` +
    `client_id=${clientId}` +
    `&scope=${scopes}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;
}

/**
 * Exchange an authorization code for an access token.
 */
async function exchangeCodeForToken(shopDomain, clientId, clientSecret, code) {
  const cleanDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const url = `https://${cleanDomain}/admin/oauth/access_token`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Verify the HMAC signature from Shopify OAuth callback.
 */
function verifyHmac(queryParams, clientSecret) {
  const { hmac, ...params } = queryParams;
  const sortedKeys = Object.keys(params).sort();
  const message = sortedKeys.map(key => `${key}=${params[key]}`).join('&');

  const generatedHmac = crypto
    .createHmac('sha256', clientSecret)
    .update(message)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(generatedHmac, 'hex'),
    Buffer.from(hmac, 'hex')
  );
}

/**
 * Validate an existing access token by making a lightweight API call.
 */
async function validateAccessToken(shopDomain, accessToken) {
  const cleanDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const url = `https://${cleanDomain}/admin/api/${API_VERSION}/shop.json`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Access token validation failed (${response.status})`);
  }

  const data = await response.json();
  return data.shop;
}

module.exports = {
  buildAuthUrl,
  exchangeCodeForToken,
  verifyHmac,
  validateAccessToken,
  API_VERSION
};
