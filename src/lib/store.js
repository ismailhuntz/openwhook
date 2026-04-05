import { randomUUID } from 'node:crypto';

const sessions = new Map();

const MAX_REQUESTS = parseInt(process.env.MAX_REQUESTS_PER_SESSION || '200', 10);
const SESSION_TTL = parseInt(process.env.SESSION_TTL_HOURS || '24', 10) * 60 * 60 * 1000;

export function createSession() {
  const now = Date.now();
  const session = {
    id: randomUUID(),
    createdAt: new Date(now).toISOString(),
    _createdTs: now,
    requests: [],
    _head: 0, // circular buffer pointer
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id) {
  return sessions.get(id) || null;
}

export function getSessionRequests(session) {
  const { requests, _head } = session;
  if (requests.length < MAX_REQUESTS) return requests;
  // Unwrap circular buffer: _head is where the oldest item sits
  return requests.slice(_head).concat(requests.slice(0, _head));
}

export function addRequest(sessionId, request) {
  const session = sessions.get(sessionId);
  if (!session) return false;

  if (session.requests.length < MAX_REQUESTS) {
    session.requests.push(request);
  } else {
    // O(1) overwrite instead of O(n) shift
    session.requests[session._head] = request;
    session._head = (session._head + 1) % MAX_REQUESTS;
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
      if (now - session._createdTs > SESSION_TTL) {
        if (onEvict) onEvict(id);
        sessions.delete(id);
      }
    }
  }, 60_000);
}
