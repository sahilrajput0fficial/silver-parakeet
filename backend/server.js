require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');

const storeRoutes = require('./routes/stores');
const csvRoutes = require('./routes/csv');
const invoiceRoutes = require('./routes/invoice');
const logRoutes = require('./routes/logs');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

/* ─── Middleware ─── */
app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://localhost:3001",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:3000",
      "https://shopify-emails.netlify.app",
      "https://silver-parakeet-production.up.railway.app",
      process.env.FRONTEND_URL
    ];

    const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1');
    const isAllowed = allowedOrigins.includes(origin) || allowedOrigins.includes(origin + '/');

    if (isAllowed || isLocal) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* ─── Request logging ─── */
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

/* ─── API Routes ─── */
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Server is running",
    time: new Date().toISOString()
  });
});

app.use(storeRoutes);
app.use(csvRoutes);
app.use(invoiceRoutes);
app.use(logRoutes);
app.use(authRoutes);
app.use(adminRoutes);

/* ─── Serve frontend in production ─── */
const fs = require('fs');
const frontendBuildPath = path.join(__dirname, '..', 'frontend', 'dist');
const frontendIndexPath = path.join(frontendBuildPath, 'index.html');

if (fs.existsSync(frontendBuildPath)) {
  app.use(express.static(frontendBuildPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(frontendIndexPath);
    }
  });
} else {
  app.get('/', (req, res) => {
    res.json({ message: 'Backend API running. Frontend is at http://localhost:5173 in dev mode.' });
  });
}

/* ─── Error handler ─── */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

/* ─── Start server ─── */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════╗
║  Server running on port ${PORT}    ║
║  Host: 0.0.0.0 (All interfaces)    ║
╠════════════════════════════════════╣
║  Routes available:                 ║
║  GET  /api/health                  ║
║  POST /api/store/add               ║
║  POST /api/invoice/send-bulk       ║
║  GET  /api/logs                    ║
╚════════════════════════════════════╝
  `);
});

module.exports = app;
