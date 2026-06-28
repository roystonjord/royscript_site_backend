'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';

// Comma-separated list of origins allowed to POST (only matters if the form
// is served from a different origin than this API). Same-origin needs none.
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Database (Postgres on the host machine; with --network host use 127.0.0.1)
// ---------------------------------------------------------------------------
const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error:', err.message);
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();

// One proxy hop (Nginx) in front — gives correct req.ip for rate limiting.
app.set('trust proxy', 1);

app.use(helmet());
app.use(express.json({ limit: '16kb' }));

if (ALLOWED_ORIGIN.length) {
  app.use(
    cors({
      origin: ALLOWED_ORIGIN,
      methods: ['POST'],
      optionsSuccessStatus: 204,
    })
  );
}

// 20 submissions per IP per 15 minutes — generous for humans, throttles bots.
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests. Please try again later.' },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clamp = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check — used by Docker HEALTHCHECK and the Jenkins deploy stage.
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  } catch (e) {
    res.status(503).json({ ok: false, db: 'down' });
  }
});

app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const body = req.body || {};

    // Honeypot: bots fill hidden fields. Pretend success, store nothing.
    if (body._gotcha) return res.json({ ok: true });

    const name = clamp(body.name, 120);
    const email = clamp(body.email, 200);
    const company = clamp(body.company, 160);
    const message = clamp(body.message, 5000);

    const errors = [];
    if (!name) errors.push('name is required');
    if (!email || !EMAIL_RE.test(email)) errors.push('a valid email is required');
    if (!message) errors.push('message is required');
    if (errors.length) return res.status(400).json({ ok: false, errors });

    const ip = req.ip;
    const ua = clamp(req.get('user-agent') || '', 400);

    await pool.query(
      `INSERT INTO contact_submissions
         (name, email, company, message, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [name, email, company || null, message, ip, ua]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('Contact insert failed:', err.message);
    return res
      .status(500)
      .json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
});

app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// ---------------------------------------------------------------------------
// Start + graceful shutdown
// ---------------------------------------------------------------------------
const server = app.listen(PORT, HOST, () => {
  console.log(`RoyScript contact API listening on http://${HOST}:${PORT}`);
});

function shutdown(sig) {
  console.log(`${sig} received, shutting down...`);
  server.close(() => {
    pool.end().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

['SIGTERM', 'SIGINT'].forEach((s) => process.on(s, () => shutdown(s)));
