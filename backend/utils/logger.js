const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../logs');
const LOG_FILE = path.join(LOG_DIR, 'shopify.log');

// Create logs folder if not exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getTimestamp() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function writeLog(type, message, data = null) {
  const separator = '═'.repeat(60);
  const timestamp = getTimestamp();

  let logEntry = `\n${separator}\n[${timestamp}] [${type}]\n${message}`;

  if (data) {
    logEntry += `\n─────────── DATA ───────────\n${JSON.stringify(data, null, 2)}`;
  }

  logEntry += `\n${separator}\n`;

  // Write to file
  try {
    fs.appendFileSync(LOG_FILE, logEntry, 'utf8');
  } catch (err) {
    console.error('Logger write error:', err.message);
  }

  // Also show in terminal
  console.log(logEntry);
}

module.exports = {

  // Log API request going to Shopify
  request: (method, url, body = null) => {
    writeLog('REQUEST', `${method} → ${url}`, body);
  },

  // Log API response coming from Shopify
  response: (url, status, body) => {
    const type = status >= 200 && status < 300 ? 'SUCCESS' : 'ERROR';
    writeLog(`RESPONSE [${type}]`, `Status: ${status} ← ${url}`, body);
  },

  // Log draft order result
  draftOrder: (email, status, data) => {
    writeLog('DRAFT ORDER', `Email: ${email} | Status: ${status}`, data);
  },

  // Log invoice send result
  invoice: (email, status, data) => {
    writeLog('INVOICE SEND', `Email: ${email} | Status: ${status}`, data);
  },

  // Log errors
  error: (where, message, data = null) => {
    writeLog('ERROR', `[${where}] ${message}`, data);
  },

  // Log info
  info: (message, data = null) => {
    writeLog('INFO', message, data);
  },

  // Clear log file
  clear: () => {
    fs.writeFileSync(LOG_FILE, '', 'utf8');
    console.log('Log file cleared!');
  },

  LOG_FILE
};
