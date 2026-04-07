const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { authenticateToken } = require('../middleware/authMiddleware');
const {
  supabase,
  addStore,
  getAllStores,
  deleteAllStores,
  deleteStoreByDomain,
  resetAllUsage,
  getStoreByDomain,
  logActivity
} = require('../db/database');
const {
  buildAuthUrl,
  exchangeCodeForToken,
  validateAccessToken
} = require('../services/shopifyAuth');

const SCOPES = process.env.SHOPIFY_SCOPES || 'write_draft_orders,read_draft_orders,write_customers,read_customers,write_orders,read_orders';

/* ─── Add a store (direct token or start OAuth) ─── */
router.post('/api/store/add', authenticateToken, async (req, res) => {
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

      const result = await addStore(req.user.id, api_name, cleanDomain, access_token, max_orders || 100);
      await logActivity(req.user.id, 'API key added', `Added store ${cleanDomain} directly`, req.ip);
      return res.json({ success: true, message: 'Store added with direct token', ...result });
    }

    // MODE 2: OAuth flow — need client_id and client_secret
    if (!client_id || !client_secret) {
      return res.status(400).json({ error: 'Provide either access_token OR client_id + client_secret' });
    }

    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/api/auth/callback`;

    if (!global._oauthStates) global._oauthStates = {};
    global._oauthStates[state] = {
      user_id: req.user.id,
      api_name,
      shop_domain: cleanDomain,
      client_id,
      client_secret,
      max_orders: max_orders || 100,
      created_at: Date.now()
    };

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

/* ─── Reconnect Store ─── */
router.post('/api/store/reconnect', authenticateToken, async (req, res) => {
  try {
    const { shop_domain, client_id, client_secret } = req.body;

    if (!shop_domain || !client_id || !client_secret) {
      return res.status(400).json({ error: 'shop_domain, client_id, and client_secret are required for reconnect' });
    }

    const cleanDomain = shop_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');

    const existingStore = await getStoreByDomain(cleanDomain, req.user.id, req.user.role);
    if (!existingStore) {
      return res.status(404).json({ error: 'Store not found or no permission' });
    }

    const apiName = existingStore.api_name;
    const maxOrders = existingStore.max_orders;

    await deleteStoreByDomain(cleanDomain, req.user.id, req.user.role);
    console.log(`[Reconnect] Deleted old token for ${cleanDomain}`);

    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/api/auth/callback`;

    if (!global._oauthStates) global._oauthStates = {};
    global._oauthStates[state] = {
      user_id: req.user.id,
      api_name: apiName,
      shop_domain: cleanDomain,
      client_id,
      client_secret,
      max_orders: maxOrders,
      is_reconnect: true,
      created_at: Date.now()
    };

    const authUrl = buildAuthUrl(cleanDomain, client_id, SCOPES, redirectUri, state);
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

/* ─── Verify draft_orders scope ─── */
router.post('/api/store/verify-scopes', authenticateToken, async (req, res) => {
  try {
    const { shop_domain } = req.body;
    if (!shop_domain) return res.status(400).json({ error: 'shop_domain is required' });

    const store = await getStoreByDomain(shop_domain, req.user.id, req.user.role);
    if (!store) {
      return res.status(404).json({ valid: false, error: 'Store not found or access denied.' });
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

    if (response.status === 403) return res.json({ valid: false, error: 'write_draft_orders scope is missing.' });
    if (response.status === 401) return res.json({ valid: false, error: 'Access token is invalid or expired.' });
    if (!response.ok) {
      const errText = await response.text();
      return res.json({ valid: false, error: `Scope check failed (${response.status}): ${errText}` });
    }

    return res.json({ valid: true, message: 'write_draft_orders scope is approved ✓' });

  } catch (error) {
    res.status(500).json({ valid: false, error: error.message });
  }
});

/* ─── OAuth callback ─── */
router.get('/api/auth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state || !global._oauthStates || !global._oauthStates[state]) {
      return res.status(400).send('Invalid OAuth callback');
    }

    const oauthData = global._oauthStates[state];
    delete global._oauthStates[state];

    const accessToken = await exchangeCodeForToken(
      oauthData.shop_domain,
      oauthData.client_id,
      oauthData.client_secret,
      code
    );

    await addStore(oauthData.user_id, oauthData.api_name, oauthData.shop_domain, accessToken, oauthData.max_orders);
    await logActivity(oauthData.user_id, 'API key added', `Connected store ${oauthData.shop_domain} via OAuth`, req.ip);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const authParam = oauthData.is_reconnect ? 'reconnected' : 'success';
    res.redirect(frontendUrl + `/?auth=${authParam}&shop=` + encodeURIComponent(oauthData.shop_domain));

  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send(`OAuth error: ${error.message}`);
  }
});

/* ─── List all stores ─── */
router.get('/api/stores', authenticateToken, async (req, res) => {
  try {
    const stores = await getAllStores(req.user.id, req.user.role);
    res.json({ stores });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ─── Delete all stores ─── */
router.delete('/api/stores', authenticateToken, async (req, res) => {
  try {
    await deleteAllStores(req.user.id, req.user.role);
    res.json({ success: true, message: 'Stores deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ─── Reset usage counters ─── */
router.post('/api/usage/reset', authenticateToken, async (req, res) => {
  try {
    await resetAllUsage(req.user.id, req.user.role);
    res.json({ success: true, message: 'Usage counters reset' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ─── Auto API Switch Reset ─── */
router.post('/api/store/:id/reset', authenticateToken, async (req, res) => {
  try {
    const apiId = req.params.id;
    let query = supabase.from('stores').update({ 
      usage_count: 0, 
      is_exhausted: false
    }).eq('id', apiId);

    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    }

    const { error } = await query;
    if (error) throw error;

    await logActivity(req.user.id, 'API Reset', `Reset usage for API ID ${apiId}`, req.ip);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/stores/reset-all', authenticateToken, async (req, res) => {
  try {
    let query = supabase.from('stores').update({ 
      usage_count: 0, 
      is_exhausted: false
    });

    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    } else {
      query = query.neq('id', 0);
    }

    const { error } = await query;
    if (error) throw error;

    await logActivity(req.user.id, 'API Reset All', `Reset usage for all APIs`, req.ip);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
