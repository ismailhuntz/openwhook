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
const PORT = process.env.PORT || 3000;

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', true);
}

app.use(cors());

// Raw body capture for all content types
const rawBodyCapture = (req, res, buf) => {
  req.rawBody = buf.toString();
};

app.use(express.json({ limit: '1mb', verify: rawBodyCapture }));
app.use(express.urlencoded({ extended: true, limit: '1mb', verify: rawBodyCapture }));
app.use(express.raw({ type: '*/*', limit: '1mb', verify: rawBodyCapture }));
app.use(express.text({ type: 'text/*', limit: '1mb', verify: rawBodyCapture }));

// Static files
app.use(express.static(join(__dirname, 'public')));

// API routes
app.use('/api', apiRoutes);

// Hook capture routes
app.use('/hook', hookRoutes);

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
