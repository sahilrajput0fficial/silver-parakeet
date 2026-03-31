import React from 'react';
import { Badge } from '@shopify/polaris';

const STATUS_MAP = {
  'Pending':                { tone: undefined,   label: 'Pending' },
  'Sending':                { tone: 'info',      label: 'Sending…' },
  'Sent ✓':                 { tone: 'success',   label: 'Sent ✓' },
  'Completed ✓':            { tone: 'success',   label: 'Completed ✓' },
  'Failed - Order Error':   { tone: 'critical',  label: 'Failed - Order Error' },
  'Failed - Email Error':   { tone: 'critical',  label: 'Failed - Email Error' },
  'Failed - Complete Error': { tone: 'critical', label: 'Failed - Complete Error' },
  'Failed':                 { tone: 'critical',  label: 'Failed ✗' }
};

export default function StatusBadge({ status }) {
  const config = STATUS_MAP[status] || { tone: undefined, label: status || 'Unknown' };

  return (
    <Badge tone={config.tone}>
      {config.label}
    </Badge>
  );
}
