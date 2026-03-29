import React from 'react';
import { Box, InlineStack, Text } from '@shopify/polaris';

export default function ProgressBar({ current, total, label }) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <Box paddingBlockStart="400" paddingBlockEnd="400">
      <InlineStack align="space-between">
        <Text variant="bodySm" as="span" tone="subdued">
          {label || `${current} of ${total} invoices sent`}
        </Text>
        <Text variant="bodySm" as="span" fontWeight="semibold">
          {percent}%
        </Text>
      </InlineStack>
      <Box paddingBlockStart="200">
        <div style={{
          width: '100%',
          height: '8px',
          backgroundColor: '#e4e5e7',
          borderRadius: '4px',
          overflow: 'hidden'
        }}>
          <div style={{
            width: `${percent}%`,
            height: '100%',
            backgroundColor: percent === 100 ? '#22c55e' : '#2563eb',
            borderRadius: '4px',
            transition: 'width 0.4s ease-in-out'
          }} />
        </div>
      </Box>
    </Box>
  );
}
