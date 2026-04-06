const express = require('express');
const router = express.Router();
const { supabase } = require('../db/database');
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

/* ─── GET /api/activity-logs ─── */
router.get('/api/activity-logs', authenticateToken, async (req, res) => {
  try {
    let query = supabase
      .from('activity_logs')
      .select('*, profiles:user_id(username)') // Assuming a profiles table or handled via metadata
      .order('created_at', { ascending: false })
      .limit(200);

    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    }

    const { data: logs, error } = await query;
    if (error) throw error;

    // Map username if needed (Supabase joins return nested objects)
    const formattedLogs = logs.map(l => ({
      ...l,
      username: l.profiles?.username || l.user_id
    }));

    res.json(formattedLogs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
