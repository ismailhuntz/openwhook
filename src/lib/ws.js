import { WebSocketServer } from 'ws';
import { getSession } from './store.js';

const wss = new WebSocketServer({ noServer: true });
const clients = new Map(); // sessionId -> Set<WebSocket>

export function handleUpgrade(server) {
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');
    const match = url.pathname.match(/^\/ws\/([a-f0-9-]+)$/);

    if (!match) {
      socket.destroy();
      return;
    }

    const sessionId = match[1];
    const session = getSession(sessionId);

    if (!session) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      if (!clients.has(sessionId)) {
        clients.set(sessionId, new Set());
      }
      clients.get(sessionId).add(ws);

      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('close', () => {
        const set = clients.get(sessionId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) clients.delete(sessionId);
        }
      });
    });
  });

  // Heartbeat every 30s
  setInterval(() => {
    for (const [, set] of clients) {
      for (const ws of set) {
        if (!ws.isAlive) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }
  }, 30_000);
}

export function broadcast(sessionId, data) {
  const set = clients.get(sessionId);
  if (!set) return;

  const message = JSON.stringify(data);
  for (const ws of set) {
    try {
      ws.send(message);
    } catch {
      set.delete(ws);
    }
  }
}

export function closeSession(sessionId) {
  const set = clients.get(sessionId);
  if (!set) return;
  for (const ws of set) {
    ws.close(1000, 'Session expired');
  }
  clients.delete(sessionId);
}
