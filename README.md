# OpenWhook

Open-source webhook testing tool. Capture, inspect, and debug HTTP requests in real-time.

Inspired by [webhook.site](https://webhook.site) — free, self-hosted, no sign-up required.

## Features

- **Instant webhook URLs** — get a unique URL to receive HTTP requests
- **Real-time updates** — requests appear instantly via WebSocket
- **Full request inspection** — method, headers, body, query params, IP, timestamp
- **JSON pretty-printing** — auto-formats JSON payloads with syntax highlighting
- **Search & filter** — filter captured requests by method, path, body, headers, or IP
- **Copy as cURL** — replay any captured request with one click
- **Custom hook responses** — set the status code, content type, and body your hook URL returns
- **Request management** — delete individual requests or clear a whole session via UI or API
- **Any HTTP method** — GET, POST, PUT, DELETE, PATCH, and more
- **Sub-path support** — `/hook/:id/any/path/here` all captured
- **Security hardened** — security headers, rate limiting, body-size caps, strict input validation
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

Open http://localhost:3001 and start sending webhooks!

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
| `PORT` | `3001` | Server listen port |
| `SESSION_TTL_HOURS` | `24` | Max session lifetime (hard cap) |
| `IDLE_TTL_HOURS` | `2` | Evict sessions with no activity for this long |
| `MAX_SESSIONS` | `10` | Max concurrent sessions (oldest evicted when full) |
| `MAX_LONG_LIVE_SESSIONS` | `10` | Max long-live sessions (no TTL, deleted manually) |
| `MAX_REQUESTS_PER_SESSION` | `200` | Max requests stored per session |
| `HOOK_BODY_LIMIT` | `1mb` | Max request body size accepted on `/hook/*` (413 beyond) |
| `API_BODY_LIMIT` | `64kb` | Max JSON body size accepted on `/api/*` |
| `RATE_LIMIT_CREATE_PER_MIN` | `30` | Session-creation requests per minute per IP (429 beyond) |
| `RATE_LIMIT_HOOK_PER_MIN` | `300` | Hook captures per minute per session (429 beyond) |
| `TRUST_PROXY` | `false` | Set `true` when behind a reverse proxy |

## API

| Endpoint | Description |
|----------|-------------|
| `POST /api/sessions` | Create a session → `{ id, url, createdAt }` |
| `GET /api/sessions/:id` | Get session metadata + captured requests |
| `DELETE /api/sessions/:id` | Delete a session |
| `DELETE /api/sessions/:id/requests` | Clear all captured requests |
| `DELETE /api/sessions/:id/requests/:requestId` | Delete one captured request |
| `PUT /api/sessions/:id/response` | Set custom hook response `{ status, body, contentType }` |
| `DELETE /api/sessions/:id/response` | Reset hook response to default `200 {"ok":true}` |
| `POST /api/long-live` | Create a long-live session (per-IP quota) |
| `GET /api/long-live` | List your long-live sessions |
| `GET /api/long-live/:id` | Get a long-live session + requests |
| `DELETE /api/long-live/:id` | Delete your long-live session |

## Testing with curl

```bash
# Send a POST request
curl -X POST http://localhost:3001/hook/YOUR-SESSION-ID \
  -H "Content-Type: application/json" \
  -d '{"event": "payment", "amount": 42.00}'

# Send a GET request with query params
curl "http://localhost:3001/hook/YOUR-SESSION-ID?foo=bar&test=123"

# Send to a sub-path
curl -X PUT http://localhost:3001/hook/YOUR-SESSION-ID/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"status": "active"}'
```

## License

MIT
