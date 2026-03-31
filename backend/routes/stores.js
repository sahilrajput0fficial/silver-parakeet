const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const {
  addStore,
  getAllStores,
  deleteAllStores,
  deleteStoreByDomain,
  resetAllUsage,
  getStoreByDomain
} = require('../db/database');
const {
  buildAuthUrl,
  exchangeCodeForToken,
  verifyHmac,
  validateAccessToken
} = require('../services/shopifyAuth');

const SCOPES = process.env.SHOPIFY_SCOPES || 'write_draft_orders,read_draft_orders,write_customers,read_customers,write_orders,read_orders';

/* ─── Add a store (direct token or start OAuth) ─── */
router.post('/api/store/add', async (req, res) => {
  try {
    const { api_name, shop_domain, client_id, client_secret, access_token, max_orders } = req.body;

    if (!api_name || !shop_domain) {
      return res.status(400).json({ error: 'api_name and shop_domain are required' });
    }

    const cleanDomain = shop_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');

    // MODE 1: Direct access token (Private App / Custom App)
    if (access_token) {
      // Validate the token first
      try {
        await validateAccessToken(cleanDomain, access_token);
      } catch (err) {
        return res.status(400).json({ error: `Invalid access token: ${err.message}` });
      }

      const result = addStore(api_name, cleanDomain, access_token, max_orders || 100);
      return res.json({ success: true, message: 'Store added with direct token', ...result });
    }

    // MODE 2: OAuth flow — need client_id and client_secret
    if (!client_id || !client_secret) {
      return res.status(400).json({ error: 'Provide either access_token OR client_id + client_secret' });
    }

    // Generate state for CSRF protection
    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/api/auth/callback`;

    // Store OAuth state temporarily (in-memory for simplicity)
    if (!global._oauthStates) global._oauthStates = {};
    global._oauthStates[state] = {
      api_name,
      shop_domain: cleanDomain,
      client_id,
      client_secret,
      max_orders: max_orders || 100,
      created_at: Date.now()
    };
    // Clean up states older than 10 minutes
    // Clean up states older than 10 minutes
    const tenMinutesAgo = Date.now() - 600000;
    for (const [key, val] of Object.entries(global._oauthStates)) {
      if (val.created_at < tenMinutesAgo) delete global._oauthStates[key];
    }

    const authUrl = buildAuthUrl(cleanDomain, client_id, SCOPES, redirectUri, state);
    return res.json({ success: true, auth_url: authUrl, message: 'Redirect merchant to auth_url' });

  } catch (error) {
    console.error('Store add error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* ─── Reconnect Store (delete old token → restart OAuth) ─── */
router.post('/api/store/reconnect', async (req, res) => {
  try {
    const { shop_domain, client_id, client_secret } = req.body;

    if (!shop_domain || !client_id || !client_secret) {
      return res.status(400).json({
        error: 'shop_domain, client_id, and client_secret are required for reconnect'
      });
    }

    const cleanDomain = shop_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');

    // Get existing store info before deleting
    const existingStore = getStoreByDomain(cleanDomain);
    const apiName = existingStore ? existingStore.api_name : cleanDomain;
    const maxOrders = existingStore ? existingStore.max_orders : 100;

    // Delete old token
    deleteStoreByDomain(cleanDomain);
    console.log(`[Reconnect] Deleted old token for ${cleanDomain}`);

    // Generate state for CSRF protection
    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/api/auth/callback`;

    // Store OAuth state temporarily
    if (!global._oauthStates) global._oauthStates = {};
    global._oauthStates[state] = {
      api_name: apiName,
      shop_domain: cleanDomain,
      client_id,
      client_secret,
      max_orders: maxOrders,
      is_reconnect: true,
      created_at: Date.now()
    };

    const authUrl = buildAuthUrl(cleanDomain, client_id, SCOPES, redirectUri, state);
    console.log(`[Reconnect] OAuth URL generated for ${cleanDomain}`);
    console.log(`[Reconnect] Scopes requested: ${SCOPES}`);

    return res.json({
      success: true,
      auth_url: authUrl,
      message: 'Old token deleted. Redirect to auth_url to reauthorize with new scopes.'
    });

  } catch (error) {
    console.error('Reconnect error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* ─── Verify draft_orders scope on token ─── */
router.post('/api/store/verify-scopes', async (req, res) => {
  try {
    const { shop_domain } = req.body;

    if (!shop_domain) {
      return res.status(400).json({ error: 'shop_domain is required' });
    }

    const store = getStoreByDomain(shop_domain);
    if (!store) {
      return res.status(404).json({
        valid: false,
        error: `Store not found: ${shop_domain}. Please add the store first.`
      });
    }

    const fetch = require('node-fetch');
    const cleanDomain = store.shop_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const url = `https://${cleanDomain}/admin/api/2024-01/draft_orders.json?limit=1`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': store.access_token
      }
    });

    if (response.status === 403) {
      return res.json({
        valid: false,
        error: 'write_draft_orders scope is missing. Click "Reconnect Store" to reauthorize with correct scopes.'
      });
    }

    if (response.status === 401) {
      return res.json({
        valid: false,
        error: 'Access token is invalid or expired. Click "Reconnect Store" to get a new token.'
      });
    }

    if (!response.ok) {
      const errText = await response.text();
      return res.json({
        valid: false,
        error: `Scope check failed (${response.status}): ${errText}`
      });
    }

    return res.json({
      valid: true,
      message: 'write_draft_orders scope is approved ✓'
    });

  } catch (error) {
    console.error('Verify scopes error:', error);
    res.status(500).json({ valid: false, error: error.message });
  }
});

/* ─── OAuth callback ─── */
router.get('/api/auth/callback', async (req, res) => {
  try {
    const { code, state, shop, hmac } = req.query;

    if (!code || !state || !global._oauthStates || !global._oauthStates[state]) {
      return res.status(400).send('Invalid OAuth callback: missing or expired state');
    }

    const oauthData = global._oauthStates[state];
    delete global._oauthStates[state];

    // Exchange code for token
    const accessToken = await exchangeCodeForToken(
      oauthData.shop_domain,
      oauthData.client_id,
      oauthData.client_secret,
      code
    );

    // Save store
    addStore(oauthData.api_name, oauthData.shop_domain, accessToken, oauthData.max_orders);

    // Redirect back to app dashboard
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const authParam = oauthData.is_reconnect ? 'reconnected' : 'success';
    res.redirect(frontendUrl + `/?auth=${authParam}&shop=` + encodeURIComponent(oauthData.shop_domain));

  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send(`OAuth error: ${error.message}`);
  }
});

/* ─── List all stores ─── */
router.get('/api/stores', (req, res) => {
  try {
    const stores = getAllStores();
    res.json({ stores });
  } catch (error) {
    console.error('List stores error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* ─── Delete all stores ─── */
router.delete('/api/stores', (req, res) => {
  try {
    deleteAllStores();
    res.json({ success: true, message: 'All stores deleted' });
  } catch (error) {
    console.error('Delete stores error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* ─── Reset usage counters ─── */
router.post('/api/usage/reset', (req, res) => {
  try {
    resetAllUsage();
    res.json({ success: true, message: 'Usage counters reset' });
  } catch (error) {
    console.error('Reset usage error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
