import React, { useState, useEffect } from 'react';
import {
  Card,
  DataTable,
  Button,
  Banner,
  InlineStack,
  Text,
  BlockStack,
  Divider
} from '@shopify/polaris';
import StatusBadge from './StatusBadge.jsx';
import ProgressBar from './ProgressBar.jsx';
import {
  sendBulkInvoices,
  checkSendProgress,
  deleteSessionProgress,
  clearSendHistory
} from '../utils/apiClient';
import { exportFailedRows } from '../utils/csvParser';

export default function InvoiceTable({ rows, shopDomain, onComplete, onScopeError }) {
  const [sending, setSending] = useState(false);
  const [statuses, setStatuses] = useState(rows.map(() => 'Pending'));
  const [orderIds, setOrderIds] = useState({});
  const [errors, setErrors] = useState({});
  const [progress, setProgress] = useState({ current: 0, total: rows.length, alreadySent: 0 });
  const [summary, setSummary] = useState(null);

  // Resume state
  const [resumeInfo, setResumeInfo] = useState(null);
  const [checkingProgress, setCheckingProgress] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [countdown, setCountdown] = useState(null);

  // ─── Countdown Timer ───
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown(prev => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // ─── Check for existing session on mount ───
  useEffect(() => {
    if (rows.length > 0 && shopDomain) {
      checkForResume();
    }
  }, [rows, shopDomain]);

  const checkForResume = async () => {
    setCheckingProgress(true);
    try {
      const result = await checkSendProgress(rows, shopDomain);
      setSessionId(result.session_id);

      if (result.is_resume && result.already_sent > 0) {
        setResumeInfo(result);

        // Pre-set statuses for already-sent rows
        setStatuses(prev => {
          const next = [...prev];
          result.sent_indices.forEach(idx => { next[idx] = 'Skipped'; });
          result.failed_indices.forEach(idx => { next[idx] = 'Pending'; }); // Reset failed to pending
          return next;
        });

        // Pre-set order IDs
        const ids = {};
        result.sent_details.forEach(d => {
          if (d.order_id) ids[d.row_index] = d.order_id;
        });
        setOrderIds(ids);

        // Set progress starting point
        setProgress({
          current: result.already_sent,
          total: rows.length,
          alreadySent: result.already_sent
        });
      } else {
        setResumeInfo(null);
      }
    } catch (err) {
      console.error('Check progress failed:', err);
      setResumeInfo(null);
    } finally {
      setCheckingProgress(false);
    }
  };

  // ─── Send All (Resume or Fresh) ───
  const handleSend = async (mode = 'resume') => {
    if (!shopDomain) {
      alert('Please add a store first');
      return;
    }

    setSending(true);
    setSummary(null);
    setErrors({});

    if (mode === 'fresh') {
      // Reset everything for fresh start
      setStatuses(rows.map(() => 'Pending'));
      setOrderIds({});
      setProgress({ current: 0, total: rows.length, alreadySent: 0 });
      setResumeInfo(null);
    }
    setCountdown(null);

    const alreadySentBefore = mode === 'resume' && resumeInfo ? resumeInfo.already_sent : 0;

    try {
      await sendBulkInvoices(rows, '', '', shopDomain, (event) => {
        switch (event.type) {
          case 'start':
            if (event.is_resume) {
              setProgress(prev => ({
                ...prev,
                alreadySent: event.already_sent
              }));
            }
            break;

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
            if (event.order_id) {
              setOrderIds(prev => ({ ...prev, [event.index]: event.order_id }));
            }
            if (event.error) {
              setErrors(prev => ({ ...prev, [event.index]: event.error }));
            }
            // Only increment progress for non-skipped rows
            if (!event.skipped) {
              setProgress(prev => ({
                ...prev,
                current: prev.current + 1
              }));
            }
            break;

          case 'retry':
            break;

          case 'waiting':
            setCountdown(event.seconds);
            break;

          case 'complete':
            setSummary({
              totalSent: event.total_sent,
              newlySent: event.newly_sent,
              totalSkipped: event.total_skipped,
              totalFailed: event.total_failed,
              timeTaken: event.time_taken,
              sessionId: event.session_id
            });
            // Set final progress
            setProgress(prev => ({
              ...prev,
              current: event.total_sent + event.total_failed
            }));
            setCountdown(null);
            break;

          default:
            break;
        }
      }, { sessionId, mode });
    } catch (error) {
      if (error.scopeError && onScopeError) {
        onScopeError(error.message);
      }
      setSummary({
        totalSent: alreadySentBefore,
        newlySent: 0,
        totalSkipped: alreadySentBefore,
        totalFailed: rows.length - alreadySentBefore,
        timeTaken: '0s',
        error: error.message,
        scopeError: error.scopeError || false
      });
    } finally {
      setSending(false);
      setResumeInfo(null); // Clear resume banner after send
      if (onComplete) onComplete();
    }
  };

  // ─── Start Fresh handler ───
  const handleStartFresh = async () => {
    if (sessionId) {
      try {
        await deleteSessionProgress(sessionId);
      } catch (err) {
        console.error('Delete session failed:', err);
      }
    }
    setResumeInfo(null);
    setStatuses(rows.map(() => 'Pending'));
    setOrderIds({});
    setErrors({});
    setProgress({ current: 0, total: rows.length, alreadySent: 0 });
    setSummary(null);
    handleSend('fresh');
  };

  // ─── Retry Failed ───
  const handleRetryFailed = async () => {
    const failedIndices = statuses
      .map((s, i) => (s.startsWith('Failed') ? i : -1))
      .filter(i => i >= 0);

    if (failedIndices.length === 0) return;

    const failedRows = failedIndices.map(i => rows[i]);

    setStatuses(prev => {
      const next = [...prev];
      failedIndices.forEach(i => { next[i] = 'Pending'; });
      return next;
    });

    setSending(true);
    setSummary(null);
    setProgress({ current: 0, total: failedRows.length, alreadySent: 0 });

    try {
      await sendBulkInvoices(failedRows, '', '', shopDomain, (event) => {
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
              if (event.order_id) {
                setOrderIds(prev => ({ ...prev, [actualIndex]: event.order_id }));
              }
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
              newlySent: event.newly_sent || event.total_sent,
              totalSkipped: event.total_skipped || 0,
              totalFailed: event.total_failed,
              timeTaken: event.time_taken
            });
            setCountdown(null);
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
      .map((row) => ({
        ...row,
        status: statuses[rows.indexOf(row)],
        error: errors[rows.indexOf(row)] || ''
      }));

    if (failedRows.length > 0) {
      exportFailedRows(failedRows);
    }
  };

  // ─── Clear All History ───
  const handleClearHistory = async () => {
    try {
      await clearSendHistory();
      setResumeInfo(null);
      setSessionId(null);
      setStatuses(rows.map(() => 'Pending'));
      setOrderIds({});
      setErrors({});
      setProgress({ current: 0, total: rows.length, alreadySent: 0 });
      setSummary(null);
      setCountdown(null);
    } catch (err) {
      console.error('Clear history failed:', err);
    }
  };

  // ─── Build table rows ───
  const tableRows = rows.map((row, i) => [
    row.email,
    `${row.first_name} ${row.last_name}`,
    row.product_name,
    `$${row.product_price}`,
    <div key={i}>
      <StatusBadge status={statuses[i]} />
      {orderIds[i] && statuses[i] !== 'Skipped' && (
        <div style={{ fontSize: '11px', color: '#1a7f37', marginTop: '4px' }}>
          ✅ Order #{orderIds[i]} — Email sent to: {row.email}
        </div>
      )}
      {orderIds[i] && statuses[i] === 'Skipped' && (
        <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
          ↩️ Already sent (Order #{orderIds[i]})
        </div>
      )}
      {errors[i] && (
        <div style={{ fontSize: '11px', color: '#d72c0d', marginTop: '4px', maxWidth: '260px', wordBreak: 'break-word' }}>
          ❌ {errors[i]}
        </div>
      )}
    </div>
  ]);

  const failedCount = statuses.filter(s => s && s.startsWith('Failed')).length;
  const sentCount = statuses.filter(s => s === 'Completed' || s === 'Sent').length;
  const skippedCount = statuses.filter(s => s === 'Skipped').length;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text variant="headingMd" as="h2">
              Order Queue ({rows.length} orders)
            </Text>
            <Text variant="bodySm" tone="subdued">
              2 second gap between each email. {rows.length} emails × 2s = ~{Math.ceil((rows.length * 2) / 60)} minutes
            </Text>
          </BlockStack>
          <Button variant="tertiary" tone="critical" onClick={handleClearHistory} disabled={sending}>
            🗑 Clear History
          </Button>
        </InlineStack>

        {/* ─── RESUME BANNER ─── */}
        {resumeInfo && !sending && !summary && (
          <Banner tone="warning">
            <BlockStack gap="200">
              <Text as="p" fontWeight="bold">
                ⚠️ Previous session found!
              </Text>
              <Text as="p">
                Already sent: <strong>{resumeInfo.already_sent}</strong> emails | Remaining: <strong>{resumeInfo.remaining}</strong> emails
                {resumeInfo.already_failed > 0 && <> | Previously failed: <strong>{resumeInfo.already_failed}</strong></>}
              </Text>
              <InlineStack gap="300">
                <Button
                  variant="primary"
                  onClick={() => handleSend('resume')}
                  disabled={sending}
                >
                  ▶️ Resume from row {resumeInfo.last_sent_index + 2}
                </Button>
                <Button
                  variant="tertiary"
                  tone="critical"
                  onClick={handleStartFresh}
                  disabled={sending}
                >
                  🔄 Start Fresh
                </Button>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                ⚠️ "Start Fresh" will re-send to customers who already received email.
              </Text>
            </BlockStack>
          </Banner>
        )}

        <DataTable
          columnContentTypes={['text', 'text', 'text', 'numeric', 'text']}
          headings={['Email', 'Name', 'Product', 'Price', 'Status']}
          rows={tableRows}
          truncate
          hoverable
        />

        <Divider />

        {/* ─── PROGRESS BAR ─── */}
        {(sending || progress.current > 0) && (
          <ProgressBar
            current={progress.current}
            total={progress.total}
            alreadySent={progress.alreadySent}
          />
        )}

        {/* ─── ACTION BUTTONS ─── */}
        {(!resumeInfo || sending) && (
          <InlineStack gap="300" align="center" blockAlign="center">
            <Button
              variant="primary"
              onClick={() => handleSend('resume')}
              loading={sending && countdown === null}
              disabled={sending || rows.length === 0 || checkingProgress}
            >
              🚀 Send All Orders
            </Button>

            {countdown > 0 && (
              <Text tone="critical" fontWeight="semibold">
                Next email in: {countdown}s
              </Text>
            )}

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
        )}

        {/* ─── SUMMARY BANNER ─── */}
        {summary && (
          <Banner
            tone={summary.error ? 'critical' : summary.totalFailed === 0 ? 'success' : 'warning'}
          >
            <BlockStack gap="200">
              <Text as="p" fontWeight="bold">
                {summary.error ? '❌ Bulk Send Failed' : '📊 Bulk Send Results'}
              </Text>
              <InlineStack gap="400" wrap>
                <Text as="span" fontWeight="semibold">
                  ✅ Total Sent: {summary.totalSent}
                </Text>
                {summary.totalSkipped > 0 && (
                  <Text as="span" fontWeight="semibold">
                    ↩️ Skipped: {summary.totalSkipped}
                  </Text>
                )}
                {summary.newlySent !== undefined && (
                  <Text as="span" fontWeight="semibold">
                    🆕 Newly Sent: {summary.newlySent}
                  </Text>
                )}
                <Text as="span" fontWeight="semibold">
                  ❌ Failed: {summary.totalFailed}
                </Text>
                <Text as="span" fontWeight="semibold">
                  ⏱ Time: {summary.timeTaken}
                </Text>
              </InlineStack>
              {summary.error && <Text as="p" tone="critical">{summary.error}</Text>}
            </BlockStack>
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}
