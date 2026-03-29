const API_BASE = import.meta.env.VITE_API_BASE || '';

/**
 * Generic fetch wrapper with error handling.
 */
async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options
  };

  const response = await fetch(url, config);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(errorData.error || `Request failed with status ${response.status}`);
  }
  return response.json();
}

/* ─── Store APIs ─── */

export function addStore(storeData) {
  return apiFetch('/api/store/add', {
    method: 'POST',
    body: JSON.stringify(storeData)
  });
}

export function getStores() {
  return apiFetch('/api/stores');
}

export function deleteAllStores() {
  return apiFetch('/api/stores', { method: 'DELETE' });
}

export function resetUsage() {
  return apiFetch('/api/usage/reset', { method: 'POST' });
}

export function testStoreConnection(shopDomain) {
  return apiFetch('/api/store/test', {
    method: 'POST',
    body: JSON.stringify({ shop_domain: shopDomain })
  });
}

export function reconnectStore(shopDomain, clientId, clientSecret) {
  return apiFetch('/api/store/reconnect', {
    method: 'POST',
    body: JSON.stringify({
      shop_domain: shopDomain,
      client_id: clientId,
      client_secret: clientSecret
    })
  });
}

export function verifyScopeCheck(shopDomain) {
  return apiFetch('/api/store/verify-scopes', {
    method: 'POST',
    body: JSON.stringify({ shop_domain: shopDomain })
  });
}

/* ─── CSV APIs ─── */

export function validateCsvRows(rows) {
  return apiFetch('/api/csv/upload', {
    method: 'POST',
    body: JSON.stringify({ rows })
  });
}

export function downloadDemoCsv() {
  window.open('/api/csv/demo', '_blank');
}

export function downloadDemoStoresCsv() {
  window.open('/api/csv/demo-stores', '_blank');
}

/* ─── Log APIs ─── */

export function getLogs() {
  return apiFetch('/api/logs');
}

export function clearLogs() {
  return apiFetch('/api/logs', { method: 'DELETE' });
}

/* ─── Invoice API (SSE) ─── */

export function sendBulkInvoices(rows, subject, customMessage, shopDomain, onEvent) {
  return new Promise((resolve, reject) => {
    fetch('/api/invoice/send-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows,
        subject,
        custom_message: customMessage,
        shop_domain: shopDomain
      })
    }).then(response => {
      if (!response.ok) {
        return response.json().then(data => {
          const err = new Error(data.error || 'Bulk send failed');
          if (data.scope_error) {
            err.scopeError = true;
          }
          reject(err);
        });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      function processStream() {
        reader.read().then(({ done, value }) => {
          if (done) {
            resolve();
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                onEvent(data);
              } catch (e) {
                // skip malformed events
              }
            }
          }

          processStream();
        }).catch(reject);
      }

      processStream();
    }).catch(reject);
  });
}
