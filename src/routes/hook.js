import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getSession, addRequest } from '../lib/store.js';
import { broadcast } from '../lib/ws.js';
import { createRateLimiter } from '../lib/ratelimit.js';

const router = Router();
const OK_RESPONSE = JSON.stringify({ ok: true });
const NOT_FOUND_RESPONSE = JSON.stringify({ error: 'Session not found' });
const INVALID_ID_RESPONSE = JSON.stringify({ error: 'Invalid session ID format' });

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Rate limit hook captures per session ID — protects memory/CPU from floods
// against a known hook URL while leaving other sessions unaffected.
const hookLimiter = createRateLimiter({
  windowMs: 60_000,
  max: parseInt(process.env.RATE_LIMIT_HOOK_PER_MIN || '300', 10),
  keyFn: (req) => `hook:${req.params.sessionId}`,
  message: 'Rate limit exceeded for this hook URL.',
});

function validateSessionId(req, res, next) {
  if (!SESSION_ID_RE.test(req.params.sessionId)) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(INVALID_ID_RESPONSE);
    return;
  }
  next();
}

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

  // Respond with the session's custom response if one is configured
  const custom = session.response;
  if (custom && Number.isInteger(custom.status)) {
    res.writeHead(custom.status, { 'content-type': custom.contentType || 'application/json' });
    res.end(custom.body || '');
    return;
  }

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(OK_RESPONSE);
}

router.all('/:sessionId', validateSessionId, hookLimiter, captureRequest);
router.all('/:sessionId/*', validateSessionId, hookLimiter, captureRequest);

export default router;
