import React, { useState, useEffect, useRef } from 'react';
import {
  Card,
  Button,
  InlineStack,
  Text,
  BlockStack,
  Badge,
  Banner
} from '@shopify/polaris';
import { getLogs, clearLogs } from '../utils/apiClient';

export default function LogViewer() {
  const [logs, setLogs] = useState('');
  const [totalLines, setTotalLines] = useState(0);
  const [fileSize, setFileSize] = useState('0 KB');
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [clearMessage, setClearMessage] = useState(null);
  const intervalRef = useRef(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const data = await getLogs();
      setLogs(data.logs || 'No logs yet.');
      setTotalLines(data.total_lines || 0);
      setFileSize(data.file_size || '0 KB');
    } catch (err) {
      setLogs('Failed to fetch logs: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm('Are you sure you want to clear all logs?')) return;
    try {
      await clearLogs();
      setLogs('');
      setTotalLines(0);
      setFileSize('0 KB');
      setClearMessage('Logs cleared successfully!');
      setTimeout(() => setClearMessage(null), 3000);
    } catch (err) {
      setClearMessage('Failed to clear logs: ' + err.message);
    }
  };

  const toggleAutoRefresh = () => {
    setAutoRefresh(prev => !prev);
  };

  useEffect(() => {
    if (autoRefresh) {
      fetchLogs();
      intervalRef.current = setInterval(fetchLogs, 3000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoRefresh]);

  // Colorize log lines
  const colorizedLogs = (text) => {
    if (!text) return null;

    // Reverse lines so latest is at top
    const lines = text.split('\n').reverse();

    return lines.map((line, i) => {
      let color = '#d4d4d4'; // default white/light gray
      let fontWeight = 'normal';

      if (line.includes('[SUCCESS]') || line.includes('SENT') || line.includes('CREATED') || line.includes('COMPLETE')) {
        color = '#4ade80'; // green
        fontWeight = 'bold';
      } else if (line.includes('[ERROR]') || line.includes('FAILED') || line.includes('Failed')) {
        color = '#f87171'; // red
        fontWeight = 'bold';
      } else if (line.includes('[REQUEST]')) {
        color = '#fbbf24'; // yellow
      } else if (line.includes('[INFO]')) {
        color = '#93c5fd'; // light blue
      } else if (line.includes('[DRAFT ORDER]')) {
        color = '#a78bfa'; // purple
      } else if (line.includes('[INVOICE SEND]')) {
        color = '#34d399'; // emerald
        fontWeight = 'bold';
      } else if (line.includes('[RESPONSE')) {
        color = line.includes('SUCCESS') ? '#4ade80' : '#f87171';
      } else if (line.includes('═') || line.includes('─')) {
        color = '#525252'; // dim separator
      }

      return (
        <div key={i} style={{ color, fontWeight, minHeight: '18px' }}>
          {line || '\u00A0'}
        </div>
      );
    });
  };

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Text variant="headingMd" as="h2">📋 API Logs</Text>
            <Badge tone="info">{totalLines} lines</Badge>
            <Badge>{fileSize}</Badge>
          </InlineStack>
          <InlineStack gap="200">
            <Button
              size="slim"
              onClick={() => {
                setExpanded(prev => !prev);
                if (!expanded && !logs) fetchLogs();
              }}
            >
              {expanded ? '▼ Collapse' : '▶ Expand'}
            </Button>
          </InlineStack>
        </InlineStack>

        {expanded && (
          <>
            <InlineStack gap="200">
              <Button
                variant="primary"
                size="slim"
                onClick={fetchLogs}
                loading={loading}
              >
                🔄 Refresh Logs
              </Button>
              <Button
                size="slim"
                onClick={toggleAutoRefresh}
                variant={autoRefresh ? 'primary' : 'tertiary'}
                tone={autoRefresh ? 'success' : undefined}
              >
                {autoRefresh ? '⏸ Stop Auto Refresh' : '▶ Auto Refresh (3s)'}
              </Button>
              <Button
                size="slim"
                variant="tertiary"
                tone="critical"
                onClick={handleClear}
              >
                🗑 Clear Logs
              </Button>
            </InlineStack>

            {clearMessage && (
              <Banner tone="success" onDismiss={() => setClearMessage(null)}>
                <p>{clearMessage}</p>
              </Banner>
            )}

            {autoRefresh && (
              <Banner tone="info">
                <p>Auto-refreshing every 3 seconds...</p>
              </Banner>
            )}

            <div
              style={{
                backgroundColor: '#1a1a2e',
                borderRadius: '8px',
                padding: '16px',
                maxHeight: '500px',
                overflowY: 'auto',
                fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", monospace',
                fontSize: '12px',
                lineHeight: '1.5',
                border: '1px solid #2d2d44',
                boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.3)'
              }}
            >
              {colorizedLogs(logs)}
            </div>
          </>
        )}
      </BlockStack>
    </Card>
  );
}
