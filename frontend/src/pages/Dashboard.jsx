import React, { useState, useEffect, useCallback } from 'react';
import {
  Page,
  Layout,
  Card,
  Text,
  Banner,
  InlineStack,
  BlockStack,
  Badge,
  Button,
  Box,
  TextField,
  Modal
} from '@shopify/polaris';
import StoreSetupPanel from '../components/StoreSetupPanel.jsx';
import CsvUploadPanel from '../components/CsvUploadPanel.jsx';
import InvoiceTable from '../components/InvoiceTable.jsx';
import LogViewer from '../components/LogViewer.jsx';
import { getStores, testStoreConnection, reconnectStore } from '../utils/apiClient';

export default function Dashboard() {
  const [stores, setStores] = useState([]);
  const [selectedStore, setSelectedStore] = useState('');
  const [orderRows, setOrderRows] = useState([]);
  const [authMessage, setAuthMessage] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [scopeError, setScopeError] = useState(null);

  // Reconnect modal state
  const [reconnectModalOpen, setReconnectModalOpen] = useState(false);
  const [reconnectDomain, setReconnectDomain] = useState('');
  const [reconnectClientId, setReconnectClientId] = useState('');
  const [reconnectClientSecret, setReconnectClientSecret] = useState('');
  const [reconnectLoading, setReconnectLoading] = useState(false);
  const [reconnectError, setReconnectError] = useState(null);

  /* ─── Load stores on mount ─── */
  const fetchStores = useCallback(async () => {
    try {
      const data = await getStores();
      setStores(data.stores || []);
      if (data.stores && data.stores.length > 0 && !selectedStore) {
        setSelectedStore(data.stores[0].shop_domain);
      }
    } catch (err) {
      console.error('Failed to load stores:', err);
    }
  }, [selectedStore]);

  useEffect(() => {
    fetchStores();

    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      setAuthMessage({
        type: 'success',
        text: `Store "${params.get('shop')}" authenticated successfully!`
      });
      window.history.replaceState({}, '', '/');
      fetchStores();
    } else if (params.get('auth') === 'reconnected') {
      setAuthMessage({
        type: 'success',
        text: `Store "${params.get('shop')}" reconnected successfully ✓ write_draft_orders scope approved`
      });
      setScopeError(null);
      window.history.replaceState({}, '', '/');
      fetchStores();
    }
  }, []);

  const handleOrdersParsed = useCallback((rows) => {
    setOrderRows(rows);
  }, []);

  const handleTestConnection = async () => {
    if (!selectedStore) return;
    setTestingConnection(true);
    setConnectionStatus(null);
    try {
      const result = await testStoreConnection(selectedStore);
      setConnectionStatus(result);
    } catch (err) {
      setConnectionStatus({
        success: false,
        status: 'error',
        message: err.message
      });
    } finally {
      setTestingConnection(false);
    }
  };

  /* ─── Reconnect Store ─── */
  const openReconnectModal = (shopDomain) => {
    setReconnectDomain(shopDomain);
    setReconnectClientId('');
    setReconnectClientSecret('');
    setReconnectError(null);
    setReconnectModalOpen(true);
  };

  const handleReconnect = async () => {
    if (!reconnectClientId || !reconnectClientSecret) {
      setReconnectError('Client ID and Client Secret are required');
      return;
    }
    setReconnectLoading(true);
    setReconnectError(null);

    try {
      const result = await reconnectStore(reconnectDomain, reconnectClientId, reconnectClientSecret);
      if (result.auth_url) {
        window.location.href = result.auth_url;
        setReconnectModalOpen(false);
        setAuthMessage({
          type: 'info',
          text: 'Redirecting to Shopify...'
        });
      }
    } catch (err) {
      setReconnectError(err.message);
    } finally {
      setReconnectLoading(false);
    }
  };

  /* ─── Handle scope errors from InvoiceTable ─── */
  const handleScopeError = (errorMessage) => {
    setScopeError(errorMessage);
  };

  return (
    <Page title="Shopify Invoice Dashboard">
      <BlockStack gap="600">
        {authMessage && (
          <Banner
            tone={authMessage.type}
            onDismiss={() => setAuthMessage(null)}
          >
            <p>{authMessage.text}</p>
          </Banner>
        )}

        {/* ─── Scope Error Banner ─── */}
        {scopeError && (
          <Banner tone="critical" onDismiss={() => setScopeError(null)}>
            <BlockStack gap="200">
              <Text as="p" fontWeight="bold">
                ⚠️ Permission Error: write_draft_orders scope is not approved.
              </Text>
              <Text as="p">
                To fix this:
              </Text>
              <ol style={{ margin: '4px 0 4px 20px', lineHeight: '1.8' }}>
                <li>Go to <strong>Shopify Partner Dashboard</strong></li>
                <li>Apps → Your App → <strong>Configuration</strong></li>
                <li>Add <code>write_draft_orders</code> in API scopes</li>
                <li>Save</li>
                <li>Click the <strong>"🔄 Reconnect"</strong> button below for the affected store</li>
              </ol>
              <Text as="p" tone="subdued" variant="bodySm">
                Error detail: {scopeError}
              </Text>
            </BlockStack>
          </Banner>
        )}

        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text variant="headingLg" as="h1">
                📦 Shopify Invoice Sender
              </Text>
              <Text variant="bodySm" tone="subdued" as="p">
                CSV Upload → Draft Order → Invoice — powered by Shopify API
              </Text>
            </BlockStack>
            <InlineStack gap="200">
              <Badge tone="info">{stores.length} store{stores.length !== 1 ? 's' : ''} connected</Badge>
            </InlineStack>
          </InlineStack>
        </Card>

        <Layout>
          <Layout.Section variant="oneHalf">
            <StoreSetupPanel onStoreAdded={fetchStores} />
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <CsvUploadPanel
              onOrdersParsed={handleOrdersParsed}
              onStoresChanged={fetchStores}
            />
          </Layout.Section>
        </Layout>

        {stores.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h2">Connected Stores</Text>
                <Button
                  onClick={handleTestConnection}
                  loading={testingConnection}
                  disabled={!selectedStore || testingConnection}
                  size="slim"
                >
                  🔌 Test Connection
                </Button>
              </InlineStack>

              {connectionStatus && (
                <Banner
                  tone={connectionStatus.success ? 'success' : 'critical'}
                  onDismiss={() => setConnectionStatus(null)}
                >
                  <p>{connectionStatus.message}</p>
                  {connectionStatus.shop_email && (
                    <p style={{ fontSize: '12px', marginTop: '4px' }}>
                      Store email: {connectionStatus.shop_email} | Plan: {connectionStatus.plan}
                    </p>
                  )}
                </Banner>
              )}

              <InlineStack gap="200" wrap>
                {stores.map(store => (
                  <div
                    key={store.id}
                    onClick={() => setSelectedStore(store.shop_domain)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: `2px solid ${selectedStore === store.shop_domain ? '#2563eb' : (scopeError ? '#e53e3e' : '#e4e5e7')}`,
                      backgroundColor: selectedStore === store.shop_domain ? '#eff6ff' : '#fff',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <BlockStack gap="100">
                      <Text variant="bodySm" fontWeight="semibold" as="span">
                        {store.api_name}
                      </Text>
                      <Text variant="bodySm" tone="subdued" as="span">
                        {store.shop_domain}
                      </Text>
                      <InlineStack gap="100">
                        <Badge tone="info" size="small">
                          {store.usage_count} / {store.max_orders} used
                        </Badge>
                      </InlineStack>
                      <div style={{ marginTop: '4px' }}>
                        <Button
                          size="slim"
                          variant="tertiary"
                          onClick={(e) => {
                            e.stopPropagation();
                            openReconnectModal(store.shop_domain);
                          }}
                          tone={scopeError ? 'critical' : undefined}
                        >
                          🔄 Reconnect
                        </Button>
                      </div>
                    </BlockStack>
                  </div>
                ))}
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {orderRows.length > 0 && (
          <>
            {!selectedStore && (
              <Banner tone="warning">
                <p>Please add and select a store before sending invoices.</p>
              </Banner>
            )}
            <InvoiceTable
              rows={orderRows}
              shopDomain={selectedStore}
              onComplete={fetchStores}
              onScopeError={handleScopeError}
            />
          </>
        )}

        {/* ─── Log Viewer ─── */}
        <LogViewer />

        <Box paddingBlockEnd="800">
          <InlineStack align="center">
            <Text variant="bodySm" tone="subdued" as="p">
              Shopify Invoice Dashboard — Emails sent via Shopify Draft Orders API
            </Text>
          </InlineStack>
        </Box>
      </BlockStack>

      {/* ─── Reconnect Store Modal ─── */}
      <Modal
        open={reconnectModalOpen}
        onClose={() => setReconnectModalOpen(false)}
        title={`Reconnect Store: ${reconnectDomain}`}
        primaryAction={{
          content: 'Reconnect & Reauthorize',
          onAction: handleReconnect,
          loading: reconnectLoading,
          disabled: !reconnectClientId || !reconnectClientSecret
        }}
        secondaryActions={[{
          content: 'Cancel',
          onAction: () => setReconnectModalOpen(false)
        }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="warning">
              <p>This will delete the existing token and restart OAuth. You'll need to approve scopes on Shopify.</p>
            </Banner>

            {reconnectError && (
              <Banner tone="critical">
                <p>{reconnectError}</p>
              </Banner>
            )}

            <TextField
              label="Client ID"
              value={reconnectClientId}
              onChange={setReconnectClientId}
              placeholder="Your Shopify App Client ID"
              autoComplete="off"
            />

            <TextField
              label="Client Secret"
              type="password"
              value={reconnectClientSecret}
              onChange={setReconnectClientSecret}
              placeholder="Your Shopify App Client Secret"
              autoComplete="off"
            />

            <Banner tone="info">
              <p>Make sure <code>write_draft_orders</code> scope is added in your Shopify Partner Dashboard → App → Configuration before reconnecting.</p>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
