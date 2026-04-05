import { Router } from 'express';
import {
  createSession, getSession, getSessionRequests, deleteSession,
  createLongLiveSession, getLongLiveSession, listLongLiveSessions,
  deleteLongLiveSession, getLongLiveCount, getLongLiveMax,
} from '../lib/store.js';

const router = Router();

function getClientIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// ---- Regular sessions ----

router.post('/sessions', (req, res) => {
  const session = createSession();
  const protocol = req.protocol;
  const host = req.get('host');
  res.status(201).json({
    id: session.id,
    url: `${protocol}://${host}/hook/${session.id}`,
    createdAt: session.createdAt,
  });
});

router.get('/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({
    id: session.id,
    name: session.name || null,
    longLive: session.longLive || false,
    createdAt: session.createdAt,
    requests: getSessionRequests(session),
  });
});

router.delete('/sessions/:id', (req, res) => {
  const deleted = deleteSession(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.status(204).end();
});

// ---- Long-live sessions (scoped per client IP) ----

router.post('/long-live', (req, res) => {
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

router.get('/long-live/:id', (req, res) => {
  const session = getLongLiveSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Long-live session not found' });
  }
  res.json({
    id: session.id,
    name: session.name,
    longLive: true,
    createdAt: session.createdAt,
    requests: getSessionRequests(session),
  });
});

router.delete('/long-live/:id', (req, res) => {
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
