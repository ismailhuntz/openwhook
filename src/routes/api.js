import { Router } from 'express';
import {
  createSession, getSession, getSessionRequests, deleteSession,
  createLongLiveSession, getLongLiveSession, listLongLiveSessions,
  deleteLongLiveSession, getLongLiveCount, getLongLiveMax,
  deleteRequest, clearRequests, setSessionResponse,
} from '../lib/store.js';
import { createRateLimiter } from '../lib/ratelimit.js';
import { broadcast } from '../lib/ws.js';

const router = Router();

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_ID_RE = SESSION_ID_RE;
const MAX_RESPONSE_BODY_BYTES = 32 * 1024;

// Rate limit session creation per client IP (configurable).
const createLimiter = createRateLimiter({
  windowMs: 60_000,
  max: parseInt(process.env.RATE_LIMIT_CREATE_PER_MIN || '30', 10),
  message: 'Too many sessions created. Please wait a moment and try again.',
});

function getClientIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function validateSessionId(req, res, next) {
  if (!SESSION_ID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid session ID format' });
  }
  next();
}

function publicSession(session) {
  return {
    id: session.id,
    name: session.name || null,
    longLive: session.longLive || false,
    createdAt: session.createdAt,
    response: session.response || null,
    requests: getSessionRequests(session),
  };
}

// ---- Regular sessions ----

router.post('/sessions', createLimiter, (req, res) => {
  const session = createSession();
  const protocol = req.protocol;
  const host = req.get('host');
  res.status(201).json({
    id: session.id,
    url: `${protocol}://${host}/hook/${session.id}`,
    createdAt: session.createdAt,
  });
});

router.get('/sessions/:id', validateSessionId, (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(publicSession(session));
});

router.delete('/sessions/:id', validateSessionId, (req, res) => {
  const deleted = deleteSession(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.status(204).end();
});

// ---- Captured request management ----

// Clear all captured requests for a session
router.delete('/sessions/:id/requests', validateSessionId, (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  clearRequests(session);
  broadcast(session.id, { __control: 'cleared' });
  res.status(204).end();
});

// Delete a single captured request
router.delete('/sessions/:id/requests/:requestId', validateSessionId, (req, res) => {
  if (!REQUEST_ID_RE.test(req.params.requestId)) {
    return res.status(400).json({ error: 'Invalid request ID format' });
  }
  const result = deleteRequest(req.params.id, req.params.requestId);
  if (!result.found) {
    return res.status(404).json({ error: 'Session not found' });
  }
  if (!result.removed) {
    return res.status(404).json({ error: 'Request not found' });
  }
  broadcast(req.params.id, { __control: 'request-deleted', id: req.params.requestId });
  res.status(204).end();
});

// ---- Custom hook response ----

// Set the status/body/content-type the hook URL should respond with
router.put('/sessions/:id/response', validateSessionId, (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { status, body, contentType } = req.body || {};
  const statusCode = Number(status);
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    return res.status(400).json({ error: 'status must be an integer between 100 and 599' });
  }
  if (body !== undefined && body !== null && typeof body !== 'string') {
    return res.status(400).json({ error: 'body must be a string' });
  }
  const bodyStr = body || '';
  if (Buffer.byteLength(bodyStr, 'utf8') > MAX_RESPONSE_BODY_BYTES) {
    return res.status(413).json({ error: `body exceeds ${MAX_RESPONSE_BODY_BYTES} bytes` });
  }
  const ct = contentType ? String(contentType) : 'application/json';
  if (ct.length > 100 || /[\r\n]/.test(ct)) {
    return res.status(400).json({ error: 'Invalid contentType' });
  }

  setSessionResponse(session, { status: statusCode, body: bodyStr, contentType: ct });
  res.json({ ok: true, response: session.response });
});

// Reset the hook URL to the default { ok: true } response
router.delete('/sessions/:id/response', validateSessionId, (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  setSessionResponse(session, null);
  res.status(204).end();
});

// ---- Long-live sessions (scoped per client IP) ----

router.post('/long-live', createLimiter, (req, res) => {
  const clientIp = getClientIp(req);
  const name = (req.body && req.body.name) || null;
  const result = createLongLiveSession(clientIp, name);

  if (result.error) {
    return res.status(409).json({ error: result.error, count: result.count, max: result.max });
  }

  const protocol = req.protocol;
  const host = req.get('host');
  res.status(201).json({
    id: result.id,
    name: result.name,
    url: `${protocol}://${host}/hook/${result.id}`,
    createdAt: result.createdAt,
  });
});

router.get('/long-live', (req, res) => {
  const clientIp = getClientIp(req);
  res.json({
    sessions: listLongLiveSessions(clientIp),
    count: getLongLiveCount(clientIp),
    max: getLongLiveMax(),
  });
});

router.get('/long-live/:id', validateSessionId, (req, res) => {
  const session = getLongLiveSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Long-live session not found' });
  }
  res.json(publicSession(session));
});

router.delete('/long-live/:id', validateSessionId, (req, res) => {
  const clientIp = getClientIp(req);
  const result = deleteLongLiveSession(req.params.id, clientIp);

  if (!result.found) {
    return res.status(404).json({ error: 'Long-live session not found' });
  }
  if (!result.owned) {
    return res.status(403).json({ error: 'You can only delete your own long-live sessions.' });
  }
  res.status(204).end();
});

export default router;
