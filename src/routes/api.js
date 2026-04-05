import { Router } from 'express';
import { createSession, getSession, getSessionRequests, deleteSession } from '../lib/store.js';

const router = Router();

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
  // Return ordered requests from circular buffer
  res.json({
    id: session.id,
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

export default router;
