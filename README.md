# OpenWhook

Open-source webhook testing tool. Capture, inspect, and debug HTTP requests in real-time.

Inspired by [webhook.site](https://webhook.site) — free, self-hosted, no sign-up required.

## Features

- **Instant webhook URLs** — get a unique URL to receive HTTP requests
- **Real-time updates** — requests appear instantly via WebSocket
- **Full request inspection** — method, headers, body, query params, IP, timestamp
- **JSON pretty-printing** — auto-formats JSON payloads with syntax highlighting
- **Any HTTP method** — GET, POST, PUT, DELETE, PATCH, and more
- **Sub-path support** — `/hook/:id/any/path/here` all captured
- **No database** — everything runs in-memory, zero config
- **Docker ready** — one command to deploy

## Quick Start

```bash
# Clone and install
git clone https://github.com/yourusername/openwhook.git
cd openwhook
npm install

# Start the server
npm start
```

Open http://localhost:3000 and start sending webhooks!

## Docker

```bash
# Using docker compose
docker compose up -d

# Or build and run directly
docker build -t openwhook .
docker run -p 3000:3000 openwhook
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server listen port |
| `SESSION_TTL_HOURS` | `24` | Max session lifetime (hard cap) |
| `IDLE_TTL_HOURS` | `2` | Evict sessions with no activity for this long |
| `MAX_SESSIONS` | `10` | Max concurrent sessions (oldest evicted when full) |
| `MAX_LONG_LIVE_SESSIONS` | `10` | Max long-live sessions (no TTL, deleted manually) |
| `MAX_REQUESTS_PER_SESSION` | `200` | Max requests stored per session |
| `TRUST_PROXY` | `false` | Set `true` when behind a reverse proxy |

## Testing with curl

```bash
# Send a POST request
curl -X POST http://localhost:3000/hook/YOUR-SESSION-ID \
  -H "Content-Type: application/json" \
  -d '{"event": "payment", "amount": 42.00}'

# Send a GET request with query params
curl "http://localhost:3000/hook/YOUR-SESSION-ID?foo=bar&test=123"

# Send to a sub-path
curl -X PUT http://localhost:3000/hook/YOUR-SESSION-ID/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"status": "active"}'
```

## License

MIT
