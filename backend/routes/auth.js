const express = require('express');
const { supabase, logActivity } = require('../db/database');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

// --- Auth Routes ---

router.post('/api/auth/signup', async (req, res) => {
  const { email, password, username } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username || email.split('@')[0],
          role: 'member'
        }
      }
    });

    if (error) {
      console.error('Signup Error:', error.message, error.status);
      throw error;
    }
    
    // If verification is off, Supabase might return a session immediately
    const session = data.session;
    if (session) {
      const token = session.access_token;
      res.cookie('token', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: 24 * 60 * 60 * 1000
      });
      
      await logActivity(data.user.id, 'signup', 'User signed up (Auto-logged in)', req.ip);

      return res.json({
        success: true,
        autoLogin: true,
        token: token,
        user: {
          id: data.user.id,
          email: data.user.email,
          username: data.user.user_metadata.username,
          role: 'member'
        }
      });
    }

    // Standard signup (if verification is ON)
    if (data.user) {
      await logActivity(data.user.id, 'signup', 'User signed up', req.ip);
    }

    res.json({
      success: true,
      user: {
        id: data.user?.id,
        email: data.user?.email,
        username: data.user?.user_metadata?.username,
        role: data.user?.user_metadata?.role
      }
    });
  } catch (err) {
    console.error('Signup Exception:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      console.error('Login Error:', error.message, error.status);
      throw error;
    }

    const token = data.session.access_token;
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 24 * 60 * 60 * 1000
    });

    await logActivity(data.user.id, 'login', 'User logged in', req.ip);

    res.json({
      success: true,
      token: token,
      user: {
        id: data.user.id,
        email: data.user.email,
        username: data.user.user_metadata.username || data.user.email.split('@')[0],
        role: data.user.app_metadata?.role || data.user.user_metadata?.role || 'member'
      }
    });
  } catch (err) {
    console.error('Login Exception:', err.message);
    res.status(401).json({ error: err.message });
  }
});

router.post('/api/auth/logout', async (req, res) => {
  await supabase.auth.signOut();
  res.clearCookie('token', {
    httpOnly: true,
    secure: true,
    sameSite: 'none'
  });
  res.json({ success: true, message: 'Logged out' });
});

router.get('/api/auth/me', authenticateToken, async (req, res) => {
  // authenticateToken already attached req.user
  res.json(req.user);
});

router.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) throw error;
    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
