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
app.use('/api', express.json({ limit: '64kb' }), apiRoutes);

// Body parsers scoped to /hook only — avoids overhead on static/API routes
const rawBodyCapture = (req, _res, buf) => {
  req.rawBody = buf.toString();
  req.rawBodySize = buf.length;
};
const hookParsers = [
  express.json({ limit: '1mb', verify: rawBodyCapture }),
  express.urlencoded({ extended: true, limit: '1mb', verify: rawBodyCapture }),
  express.text({ type: 'text/*', limit: '1mb', verify: rawBodyCapture }),
  express.raw({ type: '*/*', limit: '1mb', verify: rawBodyCapture }),
];
app.use('/hook', hookParsers, hookRoutes);

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
