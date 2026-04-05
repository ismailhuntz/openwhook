import { v4 as uuidv4 } from 'uuid';

const sessions = new Map();

const MAX_REQUESTS = parseInt(process.env.MAX_REQUESTS_PER_SESSION || '200', 10);
const SESSION_TTL = parseInt(process.env.SESSION_TTL_HOURS || '24', 10) * 60 * 60 * 1000;

export function createSession() {
  const session = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    requests: [],
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id) {
  return sessions.get(id) || null;
}

export function addRequest(sessionId, request) {
  const session = sessions.get(sessionId);
  if (!session) return false;

  session.requests.push(request);
  if (session.requests.length > MAX_REQUESTS) {
    session.requests.shift();
  }
  return true;
}

export function deleteSession(id) {
  return sessions.delete(id);
}

// Evict expired sessions
export function startEviction(onEvict) {
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - new Date(session.createdAt).getTime() > SESSION_TTL) {
        if (onEvict) onEvict(id);
        sessions.delete(id);
      }
    }
  }, 60_000);
}
