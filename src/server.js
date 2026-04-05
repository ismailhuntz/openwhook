import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import apiRoutes from './routes/api.js';
import hookRoutes from './routes/hook.js';
import { handleUpgrade, closeSession } from './lib/ws.js';
import { startEviction } from './lib/store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', true);
}

app.use(cors());

// Static files (no body parsing needed)
app.use(express.static(join(__dirname, 'public')));

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

// Start session eviction with WebSocket cleanup
startEviction((sessionId) => {
  closeSession(sessionId);
});

server.listen(PORT, () => {
  console.log(`OpenWhook running at http://localhost:${PORT}`);
});
