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
import ApiPoolTable from '../components/ApiPoolTable.jsx';
import InvoiceTable from '../components/InvoiceTable.jsx';
import LogViewer from '../components/LogViewer.jsx';
import { getStores, testStoreConnection, reconnectStore } from '../utils/apiClient';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [stores, setStores] = useState([]);
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

  // Health check state
  const [healthStatus, setHealthStatus] = useState(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const fetchStores = useCallback(async () => {
    try {
      const data = await getStores();
      setStores(data.stores || []);
    } catch (err) {
      console.error('Failed to load stores:', err);
    }
  }, []);

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

  const handleScopeError = (errorMessage) => {
    setScopeError(errorMessage);
  };

  const handleTestHealth = async () => {
    setCheckingHealth(true);
    setHealthStatus(null);
    try {
      const { getHealth } = await import('../utils/apiClient');
      const res = await getHealth();
      setHealthStatus({ type: 'success', message: '✅ Server Connected: ' + res.message });
    } catch (err) {
      setHealthStatus({ type: 'critical', message: '❌ Server Not Reachable: ' + err.message });
    } finally {
      setCheckingHealth(false);
    }
  };

  const primaryAction = user?.role === 'admin' 
    ? { content: 'Admin Dashboard', onAction: () => navigate('/admin') } 
    : undefined;

  return (
    <Page 
      title={`Shopify Invoice Dashboard — Welcome, ${user?.username}`}
      primaryAction={primaryAction}
      secondaryActions={[
        { content: 'Logout', onAction: logout, destructive: true }
      ]}
    >
      <BlockStack gap="600">
        {user?.daily_limit && (
           <Banner status="info">Your daily limit is set to {user.daily_limit} emails.</Banner>
        )}
        {authMessage && (
          <Banner
            tone={authMessage.type}
            onDismiss={() => setAuthMessage(null)}
          >
            <p>{authMessage.text}</p>
          </Banner>
        )}

        {healthStatus && (
          <Banner
            tone={healthStatus.type}
            onDismiss={() => setHealthStatus(null)}
          >
            <p>{healthStatus.message}</p>
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
                CSV → Draft Order → Complete (paid) → Instant Order Confirmation Email
              </Text>
            </BlockStack>
            <InlineStack gap="200">
              <Button onClick={handleTestHealth} loading={checkingHealth} size="slim">🔌 Test Server Connection</Button>
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
          <ApiPoolTable stores={stores} onRefresh={fetchStores} />
        )}

        {orderRows.length > 0 && (
          <>
            {stores.length === 0 && (
              <Banner tone="warning">
                <p>Please add an API key before sending invoices.</p>
              </Banner>
            )}
            <InvoiceTable
              rows={orderRows}
              shopDomain="API_POOL"
              onComplete={fetchStores}
              onScopeError={handleScopeError}
            />
          </>
        )}

        {/* ─── Log Viewer ─── */}
        {user?.role === 'admin' && <LogViewer />}

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
