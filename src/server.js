import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import apiRoutes from './routes/api.js';
import hookRoutes from './routes/hook.js';
import { handleUpgrade, closeSession, closeAll as closeAllWs } from './lib/ws.js';
import { startEviction, setEvictCallback, clearAll as clearAllSessions } from './lib/store.js';
import { verifyDirectory, brandingGuard } from './lib/branding.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, 'public');
const app = express();
const PORT = process.env.PORT || 3001;
const HOOK_BODY_LIMIT = process.env.HOOK_BODY_LIMIT || '1mb';
const API_BODY_LIMIT = process.env.API_BODY_LIMIT || '64kb';

// Do not advertise the framework
app.disable('x-powered-by');

// ---- Security headers ----
// CSP note: the frontend is intentionally dependency-free with inline
// <script>/<style> blocks, so 'unsafe-inline' is required for script-src and
// style-src. This is the strictest policy compatible with that design;
// everything else (objects, frames, form targets, base URI) is locked down.
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  });
  next();
});

// ---- Branding integrity check at startup ----
const brandCheck = verifyDirectory(publicDir);
if (!brandCheck.ok) {
  console.error('\x1b[31m[FATAL] Branding verification failed.\x1b[0m');
  console.error('The following files are missing required branding:', brandCheck.failed.join(', '));
  console.error('OpenWhook requires "Powered by Huntz Group" with a link to huntz-group.com in all HTML files.');
  process.exit(1);
}

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', true);
}

app.use(cors());

// Branding guard middleware — blocks serving if HTML tampered at runtime
app.use(brandingGuard(publicDir));

// Static files (no body parsing needed)
app.use(express.static(publicDir));

// API routes (only need JSON parsing)
app.use('/api', express.json({ limit: API_BODY_LIMIT }), apiRoutes);

// Body parsers scoped to /hook only — avoids overhead on static/API routes
const rawBodyCapture = (req, _res, buf) => {
  req.rawBody = buf.toString();
  req.rawBodySize = buf.length;
};
const hookParsers = [
  express.json({ limit: HOOK_BODY_LIMIT, verify: rawBodyCapture }),
  express.urlencoded({ extended: true, limit: HOOK_BODY_LIMIT, verify: rawBodyCapture }),
  express.text({ type: 'text/*', limit: HOOK_BODY_LIMIT, verify: rawBodyCapture }),
  express.raw({ type: '*/*', limit: HOOK_BODY_LIMIT, verify: rawBodyCapture }),
];
app.use('/hook', hookParsers, hookRoutes);

// Central error handler — clean JSON for body-parser failures (413/400)
// instead of Express's default HTML error pages.
app.use((err, _req, res, next) => { // eslint-disable-line no-unused-vars
  if (!err) return next();
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: `Payload too large (limit: ${HOOK_BODY_LIMIT} for hooks, ${API_BODY_LIMIT} for API)` });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed request body' });
  }
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Create HTTP server and attach WebSocket
const server = http.createServer(app);
handleUpgrade(server);

// Clean up WebSocket connections when sessions are evicted (by TTL or by cap)
setEvictCallback((sessionId) => {
  closeSession(sessionId);
});

// Start periodic TTL eviction
startEviction();

server.listen(PORT, () => {
  console.log(`OpenWhook running at http://localhost:${PORT}`);
});

// ---- Graceful shutdown ----
function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully...`);

  // 1. Stop accepting new connections
  server.close(() => {
    console.log('HTTP server closed.');
  });

  // 2. Close all WebSocket connections (sends 1001 to clients)
  closeAllWs();
  console.log('All WebSocket connections closed.');

  // 3. Clear all session data
  clearAllSessions();
  console.log('All sessions cleared.');

  // 4. Force exit after 5s if something hangs
  setTimeout(() => {
    console.error('Forced exit after timeout.');
    process.exit(1);
  }, 5000).unref();

  // 5. Exit cleanly
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
