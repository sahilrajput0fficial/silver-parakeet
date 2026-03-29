import React, { useState } from 'react';
import {
  Card,
  DataTable,
  TextField,
  Button,
  Banner,
  InlineStack,
  Text,
  Box,
  BlockStack,
  Divider
} from '@shopify/polaris';
import StatusBadge from './StatusBadge.jsx';
import ProgressBar from './ProgressBar.jsx';
import { sendBulkInvoices } from '../utils/apiClient';
import { exportFailedRows } from '../utils/csvParser';

export default function InvoiceTable({ rows, shopDomain, onComplete, onScopeError }) {
  const [subject, setSubject] = useState('Your Order Invoice - {product_name}');
  const [customMessage, setCustomMessage] = useState(
    'Dear {first_name}, please find your order invoice attached.'
  );
  const [sending, setSending] = useState(false);
  const [statuses, setStatuses] = useState(
    rows.map(() => 'Pending')
  );
  const [errors, setErrors] = useState({});
  const [progress, setProgress] = useState({ current: 0, total: rows.length });
  const [summary, setSummary] = useState(null);

  const handleSendAll = async () => {
    if (!shopDomain) {
      alert('Please add a store first (configure in left panel)');
      return;
    }

    setSending(true);
    setSummary(null);
    setErrors({});
    setStatuses(rows.map(() => 'Pending'));
    setProgress({ current: 0, total: rows.length });

    try {
      await sendBulkInvoices(rows, subject, customMessage, shopDomain, (event) => {
        switch (event.type) {
          case 'progress':
            setStatuses(prev => {
              const next = [...prev];
              next[event.index] = event.status;
              return next;
            });
            break;

          case 'result':
            setStatuses(prev => {
              const next = [...prev];
              next[event.index] = event.status;
              return next;
            });
            if (event.error) {
              setErrors(prev => ({ ...prev, [event.index]: event.error }));
            }
            setProgress(prev => ({
              ...prev,
              current: prev.current + 1
            }));
            break;

          case 'retry':
            // keep current "Sending" status
            break;

          case 'complete':
            setSummary({
              totalSent: event.total_sent,
              totalFailed: event.total_failed,
              timeTaken: event.time_taken
            });
            break;

          default:
            break;
        }
      });
    } catch (error) {
      // Check if this is a scope error
      if (error.scopeError && onScopeError) {
        onScopeError(error.message);
      }
      setSummary({
        totalSent: 0,
        totalFailed: rows.length,
        timeTaken: '0s',
        error: error.message,
        scopeError: error.scopeError || false
      });
    } finally {
      setSending(false);
      if (onComplete) onComplete();
    }
  };

  const handleRetryFailed = async () => {
    const failedIndices = statuses
      .map((s, i) => (s.startsWith('Failed') ? i : -1))
      .filter(i => i >= 0);

    if (failedIndices.length === 0) return;

    const failedRows = failedIndices.map(i => rows[i]);

    // Reset failed statuses
    setStatuses(prev => {
      const next = [...prev];
      failedIndices.forEach(i => { next[i] = 'Pending'; });
      return next;
    });

    setSending(true);
    setSummary(null);
    setProgress({ current: 0, total: failedRows.length });

    try {
      await sendBulkInvoices(failedRows, subject, customMessage, shopDomain, (event) => {
        const actualIndex = failedIndices[event.index];

        switch (event.type) {
          case 'progress':
          case 'result':
            setStatuses(prev => {
              const next = [...prev];
              next[actualIndex] = event.status;
              return next;
            });
            if (event.type === 'result') {
              if (event.error) {
                setErrors(prev => ({ ...prev, [actualIndex]: event.error }));
              }
              setProgress(prev => ({
                ...prev,
                current: prev.current + 1
              }));
            }
            break;

          case 'complete':
            setSummary({
              totalSent: event.total_sent,
              totalFailed: event.total_failed,
              timeTaken: event.time_taken
            });
            break;

          default:
            break;
        }
      });
    } catch (error) {
      // ignore
    } finally {
      setSending(false);
    }
  };

  const handleExportFailed = () => {
    const failedRows = rows
      .filter((_, i) => statuses[i] && statuses[i].startsWith('Failed'))
      .map((row, i) => ({
        ...row,
        status: statuses[rows.indexOf(row)],
        error: errors[rows.indexOf(row)] || ''
      }));

    if (failedRows.length > 0) {
      exportFailedRows(failedRows);
    }
  };

  const tableRows = rows.map((row, i) => [
    row.email,
    `${row.first_name} ${row.last_name}`,
    row.product_name,
    `$${row.product_price}`,
    <div key={i}>
      <StatusBadge status={statuses[i]} />
      {errors[i] && (
        <div style={{ fontSize: '11px', color: '#d72c0d', marginTop: '4px', maxWidth: '220px', wordBreak: 'break-word' }}>
          {errors[i]}
        </div>
      )}
    </div>
  ]);

  const failedCount = statuses.filter(s => s && s.startsWith('Failed')).length;
  const sentCount = statuses.filter(s => s === 'Sent ✓').length;

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">
          Invoice Queue ({rows.length} orders)
        </Text>


        <DataTable
          columnContentTypes={['text', 'text', 'text', 'numeric', 'text']}
          headings={['Email', 'Name', 'Product', 'Price', 'Status']}
          rows={tableRows}
          truncate
          hoverable
        />

        <Divider />

        <FormFields
          subject={subject}
          setSubject={setSubject}
          customMessage={customMessage}
          setCustomMessage={setCustomMessage}
          disabled={sending}
        />

        {(sending || progress.current > 0) && (
          <ProgressBar
            current={progress.current}
            total={progress.total}
          />
        )}

        <InlineStack gap="300" align="start">
          <Button
            variant="primary"
            onClick={handleSendAll}
            loading={sending}
            disabled={sending || rows.length === 0}
          >
            Send All Invoices
          </Button>

          {failedCount > 0 && !sending && (
            <>
              <Button
                variant="primary"
                tone="critical"
                onClick={handleRetryFailed}
              >
                Retry Failed ({failedCount})
              </Button>
              <Button variant="tertiary" onClick={handleExportFailed}>
                Export Failed Rows as CSV
              </Button>
            </>
          )}
        </InlineStack>

        {summary && (
          <Banner
            tone={summary.error ? 'critical' : summary.totalFailed === 0 ? 'success' : 'warning'}
          >
            <InlineStack gap="600">
              <Text as="span" fontWeight="semibold">
                ✅ Sent: {summary.totalSent}
              </Text>
              <Text as="span" fontWeight="semibold">
                ❌ Failed: {summary.totalFailed}
              </Text>
              <Text as="span" fontWeight="semibold">
                ⏱ Time: {summary.timeTaken}
              </Text>
            </InlineStack>
            {summary.error && <Text as="p" tone="critical">{summary.error}</Text>}
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}

/* ─── Inline sub-component for form fields ─── */
function FormFields({ subject, setSubject, customMessage, setCustomMessage, disabled }) {
  return (
    <BlockStack gap="300">
      <TextField
        label="Email Subject"
        value={subject}
        onChange={setSubject}
        disabled={disabled}
        helpText="Use {product_name} and {first_name} as template variables"
        autoComplete="off"
      />
      <TextField
        label="Custom Message"
        value={customMessage}
        onChange={setCustomMessage}
        multiline={3}
        disabled={disabled}
        helpText="Use {product_name} and {first_name} as template variables"
        autoComplete="off"
      />
    </BlockStack>
  );
}
