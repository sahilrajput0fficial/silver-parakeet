import React, { useState } from 'react';
import {
  Card,
  FormLayout,
  TextField,
  Button,
  Banner,
  InlineStack,
  Text,
  Box,
  BlockStack
} from '@shopify/polaris';
import { addStore } from '../utils/apiClient';

export default function StoreSetupPanel({ onStoreAdded }) {
  const [apiName, setApiName] = useState('');
  const [shopDomain, setShopDomain] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [maxOrders, setMaxOrders] = useState('100');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [useDirectToken, setUseDirectToken] = useState(false);

  // Auto-detect Shopify's install request parameter (?shop=...)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shop = params.get('shop');
    const auth = params.get('auth');
    if (shop && !auth && !shopDomain) {
      setShopDomain(shop);
      // Auto-generate a friendly API name, e.g. "store-name"
      const name = shop.replace('.myshopify.com', '');
      setApiName(name);
    }
  }, [shopDomain]);

  const handleSubmit = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const payload = {
        api_name: apiName,
        shop_domain: shopDomain,
        max_orders: parseInt(maxOrders, 10) || 100
      };

      if (useDirectToken) {
        payload.access_token = accessToken;
      } else {
        payload.client_id = clientId;
        payload.client_secret = clientSecret;
      }

      const result = await addStore(payload);

      if (result.auth_url) {
        // OAuth flow — redirect merchant in the same tab for a seamless install experience
        setMessage({ type: 'info', text: 'Redirecting to Shopify for authorization...' });
        window.location.href = result.auth_url;
      } else {
        setMessage({ type: 'success', text: 'Store added successfully!' });
        // Reset form
        setApiName('');
        setShopDomain('');
        setClientId('');
        setClientSecret('');
        setAccessToken('');
        setMaxOrders('100');
        if (onStoreAdded) onStoreAdded();
      }
    } catch (error) {
      setMessage({ type: 'critical', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">Single Store Setup</Text>

        <Banner tone="info">
          <p>{useDirectToken
            ? 'Enter your private app access token directly.'
            : 'Token is fetched automatically using Client ID & Secret.'
          }</p>
        </Banner>

        {message && (
          <Banner
            tone={message.type}
            onDismiss={() => setMessage(null)}
          >
            <p>{message.text}</p>
          </Banner>
        )}

        <FormLayout>
          <TextField
            label="API Name"
            value={apiName}
            onChange={setApiName}
            placeholder="My Store API"
            autoComplete="off"
          />

          <TextField
            label="Shop Domain"
            value={shopDomain}
            onChange={setShopDomain}
            placeholder="your-store.myshopify.com"
            autoComplete="off"
            helpText="Your Shopify store domain"
          />

          <InlineStack gap="200" blockAlign="center">
            <Button
              variant={useDirectToken ? 'tertiary' : 'primary'}
              size="slim"
              onClick={() => setUseDirectToken(false)}
            >
              OAuth (Client ID + Secret)
            </Button>
            <Button
              variant={useDirectToken ? 'primary' : 'tertiary'}
              size="slim"
              onClick={() => setUseDirectToken(true)}
            >
              Direct Access Token
            </Button>
          </InlineStack>

          {useDirectToken ? (
            <TextField
              label="Access Token"
              type="password"
              value={accessToken}
              onChange={setAccessToken}
              placeholder="shpat_xxxxx..."
              autoComplete="off"
            />
          ) : (
            <>
              <TextField
                label="Client ID"
                value={clientId}
                onChange={setClientId}
                placeholder="Your Shopify App Client ID"
                autoComplete="off"
              />
              <TextField
                label="Client Secret"
                type="password"
                value={clientSecret}
                onChange={setClientSecret}
                placeholder="Your Shopify App Client Secret"
                autoComplete="off"
              />
            </>
          )}

          <TextField
            label="Max Orders"
            type="number"
            value={maxOrders}
            onChange={setMaxOrders}
            placeholder="100"
            autoComplete="off"
          />
        </FormLayout>

        <InlineStack align="end">
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={loading}
            disabled={!apiName || !shopDomain || (useDirectToken ? !accessToken : (!clientId || !clientSecret))}
          >
            {useDirectToken ? 'Validate & Add' : 'Fetch Token & Add'}
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
