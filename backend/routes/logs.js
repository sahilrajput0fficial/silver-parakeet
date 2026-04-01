const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../logs/shopify.log');

/* ─── GET /api/logs — returns last 200 lines of log file ─── */
router.get('/api/logs', authenticateToken, requireAdmin, (req, res) => {
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
router.delete('/api/logs', authenticateToken, requireAdmin, (req, res) => {
  try {
    fs.writeFileSync(LOG_FILE, '', 'utf8');
    res.json({ message: 'Logs cleared!' });
  } catch (error) {
    console.error('Clear logs error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

/* ─── GET /api/activity-logs ─── */
router.get('/api/activity-logs', authenticateToken, (req, res) => {
  try {
    let logs;
    if (req.user.role === 'admin') {
      logs = db.prepare(`
        SELECT l.*, u.username as username 
        FROM activity_logs l 
        LEFT JOIN users u ON l.user_id = u.id 
        ORDER BY l.created_at DESC LIMIT 200
      `).all();
    } else {
      logs = db.prepare(`
        SELECT l.*, u.username as username 
        FROM activity_logs l 
        LEFT JOIN users u ON l.user_id = u.id 
        WHERE l.user_id = ? 
        ORDER BY l.created_at DESC LIMIT 200
      `).all(req.user.id);
    }
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
