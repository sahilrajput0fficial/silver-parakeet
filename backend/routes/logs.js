const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../logs/shopify.log');

/* ─── GET /api/logs — returns last 200 lines of log file ─── */
router.get('/api/logs', (req, res) => {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return res.json({ logs: 'No logs yet.', total_lines: 0, file_size: '0 KB' });
    }

    const content = fs.readFileSync(LOG_FILE, 'utf8');

    // Return last 200 lines only
    const lines = content.split('\n');
    const last200 = lines.slice(-200).join('\n');

    const fileSizeKB = (fs.statSync(LOG_FILE).size / 1024).toFixed(2);

    res.json({
      logs: last200,
      total_lines: lines.length,
      file_size: `${fileSizeKB} KB`
    });
  } catch (error) {
    console.error('Read logs error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* ─── DELETE /api/logs — clear log file ─── */
router.delete('/api/logs', (req, res) => {
  try {
    fs.writeFileSync(LOG_FILE, '', 'utf8');
    res.json({ message: 'Logs cleared!' });
  } catch (error) {
    console.error('Clear logs error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
