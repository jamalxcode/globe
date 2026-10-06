# Meridian

Interactive globe of reported strikes and explosions. Amber marks a single source. Red marks two or more independent sources. Reports are social-media claims, not confirmed facts.

The preview runs in **mock mode** until an X bearer token is present: a new simulated report appears about every five seconds, and some of those later get a second source.

## Run

```bash
npm install
MOCK=1 npm start
```

`npm start` and `npm run dev` both serve the app. With no `X_BEARER_TOKEN`, mock mode is automatic even without `MOCK=1`.

Live ingest:

```bash
# copy .env.example values into the process environment — do not commit secrets
X_BEARER_TOKEN=... LLM_API_KEY=... npm start
```

- `GET /events` — server-sent events (snapshot, then upserts)
- `GET /health` — `{ status, mode, events, ingest }`

## X API access

Filtered stream (`GET /2/tweets/search/stream`) needs **pay-per-use credits** or a legacy **Pro** subscription. **Enterprise** raises rule and connection limits. As of 2026 the free tier is closed to new developers, and legacy Basic does not include filtered stream.

If the stream endpoint returns 401, 402, or 403, Meridian falls back to **recent search** every 60 seconds. Recent search is available on legacy Basic, legacy Pro, and pay-per-use. Set `MOCK=1` to skip both and keep the simulated globe.
