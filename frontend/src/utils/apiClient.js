const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

export function getHealth() {
  return apiFetch('/api/health');
}

/**
 * Generic fetch wrapper with error handling.
 */
async function apiFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  const token = localStorage.getItem('token');
  const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};

  const config = {
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    credentials: 'include',
    ...options
  };

  try {
    const response = await fetch(url, config);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      const err = new Error(errorData.error || `Server error ${response.status}: ${response.statusText}`);
      if (errorData.scope_error) err.scopeError = true;
      throw err;
    }
    return response.json();
  } catch (error) {
    if (error.message === 'Failed to fetch') {
      throw new Error(
        "Cannot connect to server. Check if backend is running on port 3000 and CORS allows origin http://localhost:5173"
      );
    }
    throw error;
  }
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

export function resetApiUsage(apiId) {
  return apiFetch(`/api/store/${apiId}/reset`, { method: 'POST' });
}

export function resetAllApis() {
  return apiFetch(`/api/stores/reset-all`, { method: 'POST' });
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
  window.open(`${API_BASE}/api/csv/demo`, '_blank');
}

export function downloadDemoStoresCsv() {
  window.open(`${API_BASE}/api/csv/demo-stores`, '_blank');
}

/* ─── Log APIs ─── */

export function getLogs() {
  return apiFetch('/api/logs');
}

export function clearLogs() {
  return apiFetch('/api/logs', { method: 'DELETE' });
}

/* ─── Resume Feature APIs ─── */

/**
 * Check if a CSV batch has previous progress (resume detection).
 */
export function checkSendProgress(rows, shopDomain) {
  return apiFetch('/api/invoice/check-progress', {
    method: 'POST',
    body: JSON.stringify({ rows, shop_domain: shopDomain })
  });
}

/**
 * Delete a session to start fresh.
 */
export function deleteSessionProgress(sessionId) {
  return apiFetch('/api/invoice/delete-session', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId })
  });
}

/**
 * Clear ALL send history.
 */
export function clearSendHistory() {
  return apiFetch('/api/invoice/clear-history', { method: 'DELETE' });
}

/* ─── Invoice API (SSE) with Resume Support ─── */

export function sendBulkInvoices(rows, subject, customMessage, shopDomain, onEvent, options = {}) {
  const { sessionId, mode } = options;

  return new Promise((resolve, reject) => {
    const token = localStorage.getItem('token');
    const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};

    fetch(`${API_BASE}/api/invoice/send-bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      credentials: 'include',
      body: JSON.stringify({
        rows,
        shop_domain: shopDomain,
        session_id: sessionId || undefined,
        mode: mode || undefined
      })
    }).then(response => {
      if (!response.ok) {
        return response.json().then(data => {
          const err = new Error(data.error || 'Bulk send failed');
          if (data.scope_error) err.scopeError = true;
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
    }).catch(error => {
      if (error.message === 'Failed to fetch') {
        reject(new Error("Cannot connect to server. Check if backend is running on port 3000 and CORS allows origin http://localhost:5173"));
      } else {
        reject(error);
      }
    });
  });
}
