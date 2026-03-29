import React, { useState, useCallback } from 'react';
import {
  Card,
  Button,
  Banner,
  DropZone,
  InlineStack,
  Text,
  Box,
  Divider,
  BlockStack,
  List
} from '@shopify/polaris';
import { parseOrderCsv, parseStoreCsv } from '../utils/csvParser';
import { addStore, downloadDemoCsv, downloadDemoStoresCsv, deleteAllStores, resetUsage } from '../utils/apiClient';

export default function CsvUploadPanel({ onOrdersParsed, onStoresChanged }) {
  const [storeFile, setStoreFile] = useState(null);
  const [storeBulkLoading, setStoreBulkLoading] = useState(false);
  const [storeBulkMessage, setStoreBulkMessage] = useState(null);
  const [orderFile, setOrderFile] = useState(null);
  const [orderMessage, setOrderMessage] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  /* ─── Store CSV upload ─── */
  const handleStoreFileUpload = useCallback((_files, acceptedFiles) => {
    if (acceptedFiles.length > 0) {
      setStoreFile(acceptedFiles[0]);
    }
  }, []);

  const handleBulkStoreFetch = async () => {
    if (!storeFile) return;
    setStoreBulkLoading(true);
    setStoreBulkMessage(null);

    try {
      const result = await parseStoreCsv(storeFile);

      if (!result.isValid) {
        setStoreBulkMessage({ type: 'critical', text: result.errors[0]?.message || 'Invalid CSV format' });
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (const row of result.data) {
        try {
          await addStore({
            api_name: row.name,
            shop_domain: row.shop_domain,
            client_id: row.client_id,
            client_secret: row.client_secret,
            max_orders: parseInt(row.max_orders, 10) || 100
          });
          successCount++;
        } catch (err) {
          failCount++;
        }
      }

      setStoreBulkMessage({
        type: failCount === 0 ? 'success' : 'warning',
        text: `${successCount} stores added, ${failCount} failed.`
      });

      if (onStoresChanged) onStoresChanged();
      setStoreFile(null);
    } catch (error) {
      setStoreBulkMessage({ type: 'critical', text: error.message });
    } finally {
      setStoreBulkLoading(false);
    }
  };

  /* ─── Order CSV upload ─── */
  const handleOrderFileUpload = useCallback((_files, acceptedFiles) => {
    if (acceptedFiles.length > 0) {
      setOrderFile(acceptedFiles[0]);
      setOrderMessage(null);

      parseOrderCsv(acceptedFiles[0]).then((result) => {
        if (!result.isValid && result.data.length === 0) {
          setOrderMessage({
            type: 'critical',
            text: result.errors[0]?.message || 'No valid rows found',
            errors: result.errors
          });
          return;
        }

        if (result.errors.length > 0) {
          setOrderMessage({
            type: 'warning',
            text: `${result.totalValid} valid rows, ${result.totalInvalid} invalid rows skipped.`,
            errors: result.errors
          });
        } else {
          setOrderMessage({
            type: 'success',
            text: `${result.totalValid} orders ready to send.`
          });
        }

        if (onOrdersParsed) onOrdersParsed(result.data);
      }).catch((err) => {
        setOrderMessage({ type: 'critical', text: `Parse error: ${err.message}` });
      });
    }
  }, [onOrdersParsed]);

  /* ─── Destructive actions ─── */
  const handleDeleteAll = async () => {
    if (!window.confirm('Are you sure you want to delete ALL API keys? This cannot be undone.')) return;
    setDeleteLoading(true);
    try {
      await deleteAllStores();
      if (onStoresChanged) onStoresChanged();
    } catch (e) { /* ignore */ }
    setDeleteLoading(false);
  };

  const handleResetUsage = async () => {
    setResetLoading(true);
    try {
      await resetUsage();
      if (onStoresChanged) onStoresChanged();
    } catch (e) { /* ignore */ }
    setResetLoading(false);
  };

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">Bulk CSV Upload</Text>

        {/* ─── Store Config Section ─── */}
        <Banner tone="info">
          <p>Tokens will be fetched automatically for each row in CSV.</p>
        </Banner>

        {storeBulkMessage && (
          <Banner
            tone={storeBulkMessage.type}
            onDismiss={() => setStoreBulkMessage(null)}
          >
            <p>{storeBulkMessage.text}</p>
          </Banner>
        )}

        <DropZone
          accept=".csv"
          type="file"
          onDrop={handleStoreFileUpload}
          variableHeight
          label=""
        >
          <DropZone.FileUpload actionHint="CSV columns: name, shop_domain, client_id, client_secret, max_orders" />
        </DropZone>

        {storeFile && (
          <Text variant="bodySm" tone="subdued" as="p">
            File: {storeFile.name}
          </Text>
        )}

        <InlineStack gap="200">
          <Button
            variant="primary"
            onClick={handleBulkStoreFetch}
            loading={storeBulkLoading}
            disabled={!storeFile}
          >
            Upload & Fetch Tokens
          </Button>
          <Button variant="tertiary" onClick={downloadDemoStoresCsv}>
            Download Demo CSV
          </Button>
        </InlineStack>

        <Divider />

        {/* ─── Order CSV Section ─── */}
        <Text variant="headingMd" as="h2">Order Data CSV</Text>

        {orderMessage && (
          <Banner
            tone={orderMessage.type}
            onDismiss={() => setOrderMessage(null)}
          >
            <p>{orderMessage.text}</p>
            {orderMessage.errors && orderMessage.errors.length > 0 && (
              <Box paddingBlockStart="200">
                <List>
                  {orderMessage.errors.slice(0, 5).map((e, i) => (
                    <List.Item key={i}>
                      Row {e.row} ({e.email}): {e.issues ? e.issues.join(', ') : e.message}
                    </List.Item>
                  ))}
                  {orderMessage.errors.length > 5 && (
                    <List.Item>...and {orderMessage.errors.length - 5} more</List.Item>
                  )}
                </List>
              </Box>
            )}
          </Banner>
        )}

        <DropZone
          accept=".csv"
          type="file"
          onDrop={handleOrderFileUpload}
          variableHeight
          label=""
        >
          <DropZone.FileUpload actionHint="CSV columns: email, first_name, last_name, phone, product_name, product_price, address_line, city, state, postal_code, country" />
        </DropZone>

        {orderFile && (
          <Text variant="bodySm" tone="subdued" as="p">
            File: {orderFile.name}
          </Text>
        )}

        <InlineStack gap="200">
          <Button variant="tertiary" onClick={downloadDemoCsv}>
            Download Demo Order CSV
          </Button>
        </InlineStack>

        <Divider />

        {/* ─── Management Actions ─── */}
        <InlineStack gap="200">
          <Button variant="tertiary" onClick={handleResetUsage} loading={resetLoading}>
            Reset All Usage
          </Button>
          <Button variant="primary" tone="critical" onClick={handleDeleteAll} loading={deleteLoading}>
            Delete All API Keys
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
