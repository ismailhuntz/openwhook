import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getSession, addRequest } from '../lib/store.js';
import { broadcast } from '../lib/ws.js';

const router = Router();
const OK_RESPONSE = JSON.stringify({ ok: true });
const NOT_FOUND_RESPONSE = JSON.stringify({ error: 'Session not found' });

function captureRequest(req, res) {
  const sessionId = req.params.sessionId;
  const session = getSession(sessionId);

  if (!session) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(NOT_FOUND_RESPONSE);
    return;
  }

  const body = req.rawBody || '';
  const subPath = req.params[0] ? `/${req.params[0]}` : '';

  // Copy headers to a plain object — avoids retaining Express's req internals
  const headers = Object.create(null);
  const rawHeaders = req.rawHeaders;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    headers[rawHeaders[i].toLowerCase()] = rawHeaders[i + 1];
  }

  const captured = {
    id: randomUUID(),
    method: req.method,
    path: `/hook/${sessionId}${subPath}`,
    headers,
    query: req.query,
    body,
    contentType: req.get('content-type') || null,
    ip: req.ip || req.socket.remoteAddress,
    size: req.rawBodySize || Buffer.byteLength(body, 'utf8'),
    timestamp: new Date().toISOString(),
  };

  addRequest(sessionId, captured);
  broadcast(sessionId, captured);

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(OK_RESPONSE);
}

router.all('/:sessionId', captureRequest);
router.all('/:sessionId/*', captureRequest);

export default router;
