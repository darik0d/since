# Since

Investors say "not yet" and promise to keep in touch. They never do. Since does.
(Junction 2026, Context.dev challenge. Product spec: see CLAUDE.md.)

## Local

```bash
npm install
cp .env.example .env        # set CONTEXT_API_KEY and DATABASE_URL (local Postgres or Aiven)
npm run dev                 # http://localhost:3000 (migrations run on startup)
npm run context:smoke       # Context.dev REST checks (usage, limits, monitors, brand, news, scrape)
npm run webhook:test        # signed fake webhook -> shows "verified" in /webhooks
```

## Endpoints (M0)

- `POST /api/webhooks/context`: stores every raw delivery, checks `X-Context-Signature`
  (HMAC-SHA256 of `t.rawBody`, 5 min tolerance). Logs unverified ones too unless `WEBHOOK_ENFORCE_SIGNATURE=true`.
- `GET  /api/webhooks/context`: last 50 events (JSON). UI: `/webhooks` (auto-refresh).
- `POST /api/conditions/:id/recheck`: run-monitor-now for a condition's monitors.
- `GET  /api/health`: returns 503 if the database is unreachable.

## Database

Postgres via `DATABASE_URL` (Aiven PostgreSQL in production). The schema lives in
[src/lib/migrations.ts](src/lib/migrations.ts) and is applied at server startup by
[src/instrumentation.ts](src/instrumentation.ts) (advisory lock + `schema_migrations` table).
Aiven URIs with `?sslmode=require` work as is; set `DATABASE_CA_CERT` to the project CA for full TLS verification.

## Deploy: Aiven Runtime + Aiven PostgreSQL

1. Aiven console: create a PostgreSQL service and copy its Service URI.
2. Aiven Runtime: new app from GitHub `darik0d/since`, branch `main`, Dockerfile manifest, port 3000.
3. Env vars: `DATABASE_URL`, `CONTEXT_API_KEY`, `PUBLIC_BASE_URL=https://<app>.aiven.app`,
   `CONTEXT_WEBHOOK_SECRETS` (optional), `WEBHOOK_ENFORCE_SIGNATURE=false` for now.
   Do not redefine `NODE_ENV`, `NEXT_TELEMETRY_DISABLED`, `PORT` or `HOSTNAME`: the Dockerfile sets them.
4. Check `https://<app>.aiven.app/api/health` (`"db": "ok"`), then
   `npm run webhook:test -- https://<app>.aiven.app` and `npm run context:smoke -- --monitor`.

Fallback (not in use): `docker-compose.yml` + Caddy + `deploy/*.sh` on any VM, still with Aiven PostgreSQL.

## Context.dev endpoints used (running list for the submission)

- `GET /org/usage`, `GET /monitors/limits`: budget checks before creating monitors.
- `POST /monitors`, `POST /monitors/{id}/run`, `DELETE /monitors/{id}`: the watching loop and "Re-check now".
- Monitor webhooks (`change.detected`, `run.completed`), signature-verified: the real-time trigger.
- `POST /brand/retrieve`: startup logos on the watchlist.
- `POST /news/search`: independent coverage for announcements.
- `POST /web/scrape`: baseline snapshots.
