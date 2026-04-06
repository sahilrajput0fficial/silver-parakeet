const express = require('express');
const { supabase } = require('../db/database');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // List users from Supabase Auth
    const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers();
    if (usersError) throw usersError;

    // Fetch stats from other tables
    const { data: storesCount } = await supabase.rpc('get_user_stores_count'); // Custom RPC or multiple queries
    
    // For simplicity, let's just fetch all needed data and aggregate in JS for now
    // In a real production app, you'd use a more optimized approach or a view
    const { data: stores } = await supabase.from('stores').select('user_id');
    const { data: usage } = await supabase.from('usage_logs').select('*').eq('date', new Date().toISOString().split('T')[0]);
    const { data: progress } = await supabase.from('send_progress').select('user_id, status, updated_at').order('updated_at', { ascending: false });

    const userList = users.map(user => {
      const userStores = stores.filter(s => s.user_id === user.id).length;
      const userUsage = usage.find(u => u.user_id === user.id)?.emails_sent_today || 0;
      const lastActivityRow = progress.find(p => p.user_id === user.id);

      return {
        id: user.id,
        username: user.user_metadata?.username || user.email.split('@')[0],
        email: user.email,
        role: user.app_metadata?.role || 'member',
        created_at: user.created_at,
        stores_count: userStores,
        sent_today: userUsage,
        last_status: lastActivityRow?.status || 'N/A',
        last_activity: lastActivityRow?.updated_at || null,
        daily_limit: user.user_metadata?.daily_limit || null
      };
    });

    res.json(userList);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  const { email, password, username, daily_limit } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  
  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { 
        username: username || email.split('@')[0],
        role: 'member',
        daily_limit: daily_limit || null
      }
    });

    if (error) throw error;
    res.json({ success: true, user: data.user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (req.user.id === id) return res.status(400).json({ error: 'Cannot delete yourself' });
  
  try {
    const { error: authError } = await supabase.auth.admin.deleteUser(id);
    if (authError) throw authError;

    // Supabase RLS or manual cleanup
    await supabase.from('stores').delete().eq('user_id', id);
    await supabase.from('send_progress').delete().eq('user_id', id);
    await supabase.from('usage_logs').delete().eq('user_id', id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/admin/users/:id/limit', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { limit } = req.body;
  
  try {
    const { error } = await supabase.auth.admin.updateUserById(id, {
      user_metadata: { daily_limit: limit === '' ? null : limit }
    });
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/users/:id/reset-password', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;
  
  if (!newPassword) return res.status(400).json({ error: 'Password required' });
  
  try {
    const { error } = await supabase.auth.admin.updateUserById(id, {
      password: newPassword
    });
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
