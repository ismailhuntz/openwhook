import { randomUUID } from 'node:crypto';

const sessions = new Map();
const longLiveSessions = new Map();

const MAX_REQUESTS = parseInt(process.env.MAX_REQUESTS_PER_SESSION || '200', 10);
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '10', 10);
const MAX_LONG_LIVE_SESSIONS = parseInt(process.env.MAX_LONG_LIVE_SESSIONS || '10', 10);
const SESSION_TTL = parseInt(process.env.SESSION_TTL_HOURS || '24', 10) * 60 * 60 * 1000;

let _onEvict = null;
export function setEvictCallback(fn) { _onEvict = fn; }

function evictOldestRegular() {
  // Only evict regular sessions, never long-live
  for (const [id] of sessions) {
    if (_onEvict) _onEvict(id);
    sessions.delete(id);
    return;
  }
}

const IDLE_TTL = parseInt(process.env.IDLE_TTL_HOURS || '2', 10) * 60 * 60 * 1000;

function makeSession() {
  const now = Date.now();
  return {
    id: randomUUID(),
    createdAt: new Date(now).toISOString(),
    _createdTs: now,
    _lastActivityTs: now,
    requests: [],
    _head: 0,
  };
}

export function createSession() {
  // Evict oldest regular session(s) when at capacity
  while (sessions.size >= MAX_SESSIONS) {
    evictOldestRegular();
  }

  const session = makeSession();
  sessions.set(session.id, session);
  return session;
}

// ---- Long-live sessions (per-client, keyed by IP) ----

// clientIndex: IP -> Set<sessionId> for O(1) per-client counting
const clientIndex = new Map();

function getClientSet(clientIp) {
  let set = clientIndex.get(clientIp);
  if (!set) {
    set = new Set();
    clientIndex.set(clientIp, set);
  }
  return set;
}

export function createLongLiveSession(clientIp, name) {
  const clientSet = getClientSet(clientIp);
  if (clientSet.size >= MAX_LONG_LIVE_SESSIONS) {
    return {
      error: `Maximum ${MAX_LONG_LIVE_SESSIONS} long-live sessions reached for your IP. Delete an existing one first.`,
      count: clientSet.size,
      max: MAX_LONG_LIVE_SESSIONS,
    };
  }

  const session = makeSession();
  session.name = name || null;
  session.longLive = true;
  session._clientIp = clientIp;
  longLiveSessions.set(session.id, session);
  clientSet.add(session.id);
  return session;
}

export function getLongLiveSession(id) {
  return longLiveSessions.get(id) || null;
}

export function listLongLiveSessions(clientIp) {
  const clientSet = clientIndex.get(clientIp);
  if (!clientSet || clientSet.size === 0) return [];

  const list = [];
  for (const id of clientSet) {
    const session = longLiveSessions.get(id);
    if (session) {
      list.push({
        id: session.id,
        name: session.name,
        createdAt: session.createdAt,
        requestCount: session.requests.length,
      });
    }
  }
  return list;
}

export function deleteLongLiveSession(id, clientIp) {
  const session = longLiveSessions.get(id);
  if (!session) return { found: false };
  if (session._clientIp !== clientIp) return { found: true, owned: false };

  longLiveSessions.delete(id);
  const clientSet = clientIndex.get(clientIp);
  if (clientSet) {
    clientSet.delete(id);
    if (clientSet.size === 0) clientIndex.delete(clientIp);
  }
  return { found: true, owned: true };
}

export function getLongLiveCount(clientIp) {
  const clientSet = clientIndex.get(clientIp);
  return clientSet ? clientSet.size : 0;
}

export function getLongLiveMax() {
  return MAX_LONG_LIVE_SESSIONS;
}

export function getSession(id) {
  return sessions.get(id) || longLiveSessions.get(id) || null;
}

export function getSessionRequests(session) {
  const { requests, _head } = session;
  if (requests.length < MAX_REQUESTS) return requests;
  // Unwrap circular buffer: _head is where the oldest item sits
  return requests.slice(_head).concat(requests.slice(0, _head));
}

export function addRequest(sessionId, request) {
  const session = sessions.get(sessionId) || longLiveSessions.get(sessionId);
  if (!session) return false;

  session._lastActivityTs = Date.now();

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
  if (sessions.delete(id)) return true;

  // If it's a long-live session, also clean up the client index
  const llSession = longLiveSessions.get(id);
  if (llSession) {
    const clientSet = clientIndex.get(llSession._clientIp);
    if (clientSet) {
      clientSet.delete(id);
      if (clientSet.size === 0) clientIndex.delete(llSession._clientIp);
    }
    longLiveSessions.delete(id);
    return true;
  }
  return false;
}

export function clearAll() {
  sessions.clear();
  longLiveSessions.clear();
  clientIndex.clear();
}

// Evict sessions that exceeded TTL or have been idle too long
export function startEviction() {
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      const expiredByTTL = now - session._createdTs > SESSION_TTL;
      const expiredByIdle = now - session._lastActivityTs > IDLE_TTL;
      if (expiredByTTL || expiredByIdle) {
        if (_onEvict) _onEvict(id);
        sessions.delete(id);
      }
    }
  }, 60_000);
}
