const { supabase } = require('../db/database');

async function authenticateToken(req, res, next) {
  // Try to get token from cookies or authorization header
  let token = req.cookies?.token;
  if (!token && req.headers.authorization) {
    const authHeader = req.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Session expired. Please login again.' });
  }

  try {
    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Session expired. Please login again.' });
    }

    // Attach user info to request
    // Note: Supabase user object has app_metadata and user_metadata
    // We'll map it to a simpler format compatible with existing code
    req.user = {
      id: user.id,
      email: user.email,
      role: user.app_metadata?.role || 'member', // Default to member
      username: user.user_metadata?.username || user.email.split('@')[0]
    };

    next();
  } catch (err) {
    console.error('Auth Middleware Error:', err.message);
    return res.status(401).json({ error: 'Session expired. Please login again.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden. Admin access required.' });
  }
}

module.exports = { authenticateToken, requireAdmin };
