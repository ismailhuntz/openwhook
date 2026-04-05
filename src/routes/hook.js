import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getSession, addRequest } from '../lib/store.js';
import { broadcast } from '../lib/ws.js';

const router = Router();

function captureRequest(req, res) {
  const sessionId = req.params.sessionId;
  const session = getSession(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const body = req.rawBody || '';
  const subPath = req.params[0] ? `/${req.params[0]}` : '';

  const captured = {
    id: uuidv4(),
    method: req.method,
    path: `/hook/${sessionId}${subPath}`,
    headers: req.headers,
    query: req.query,
    body,
    contentType: req.get('content-type') || null,
    ip: req.ip || req.socket.remoteAddress,
    size: Buffer.byteLength(body, 'utf8'),
    timestamp: new Date().toISOString(),
  };

  addRequest(sessionId, captured);
  broadcast(sessionId, captured);

  res.status(200).json({ ok: true });
}

router.all('/:sessionId', captureRequest);
router.all('/:sessionId/*', captureRequest);

export default router;
