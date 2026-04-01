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

// STEP 1: CORS — FIRST (Must be first for production preflight)
app.use(cors({
  origin: [
    "https://shopify-emails.netlify.app",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:3001"
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Handle preflight OPTIONS requests for all routes
app.options("*", cors());

// STEP 2: Body parser (AFTER CORS)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// STEP 3: Request logger
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// STEP 4: Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", server: "running" });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// STEP 5: ALL ROUTES
// We use the full routes directly as they contain internal path prefixes
app.use(storeRoutes);
app.use(csvRoutes);
app.use(invoiceRoutes);
app.use(logRoutes);
app.use(authRoutes);
app.use(adminRoutes);

// STEP 6: Serve frontend in production (Netlify handles frontend, but keep for fallback)
const fs = require('fs');
const frontendBuildPath = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendBuildPath)) {
  app.use(express.static(frontendBuildPath));
}

// STEP 7: Error handler — LAST
app.use((err, req, res, next) => {
  console.error("Server Error:", err.message);
  res.status(500).json({ error: err.message });
});

// STEP 8: Crash handlers — prevent 502 crashing on Railway
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err.message);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err.message);
});

// STEP 9: Start server (Railway requires PORT and 0.0.0.0)
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`
    ╔════════════════════════════════════╗
    ║  Server running on port ${PORT}       ║
    ║  Host: 0.0.0.0 (Railway Mesh)       ║
    ╚════════════════════════════════════╝
    `);
});

module.exports = app;
