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

## How a condition is checked

1. **Map** (LLM, `src/lib/mapping.ts`): the investor's words become typed conditions
   (`market_launch`, `hiring_push`, `announcement` customer/revenue/retention, `product_shipped`, `ask_at_checkin`).
   The investor edits/confirms them on `/new`.
2. **Verify** (`src/lib/verify/*`): deterministic rules over live data fetched through Context.dev
   (scrape, news search) plus public job-board / GitHub APIs. The LLM only extracts claims with a verbatim
   quote, which code checks against the source text.
3. **Status** (`src/lib/conditions.ts`): platform/independent source passes → confirmed; founder-controlled
   only → reported; ambiguous → needs_review. Revenue/retention are capped at reported. Press-release wires
   count as founder-controlled. Every piece of evidence is stored with its source type, snapshot time and rule.
4. **Monitors** (`src/lib/monitors.ts`): Context.dev monitors are only triggers for step 2 (created when
   `PUBLIC_BASE_URL` is https). A verified `change.detected` webhook → `change_detected` + `webhook_received`
   on the timeline → a fresh re-check (`src/lib/process-webhook.ts`) → status change → alert.
5. **Customer's own site**: once a founder names a customer and links them, Since reads the customer's newsroom
   (independent) and adds a monitor on it. The customer's own announcement upgrades Reported → Confirmed.
6. **Alerts** (`src/lib/alerts.ts`): Telegram. Confirmed always; Reported on by default (labeled founder-reported);
   Needs review off. Set `TELEGRAM_BOT_TOKEN`, open the bot, press Start, then Settings → Detect chat.

## Endpoints

- `POST /api/notyet/parse`: domain + note → brand, discovered sources, draft conditions with "how we verify".
- `POST /api/notyet/start`: store confirmed conditions, capture a baseline check, create monitors.
- `POST /api/conditions/:id/check`: "Check now": run the verifier once via Context.dev (no monitor), return evidence + status.
- `POST /api/conditions/:id/recheck`: "Re-check now": check now + run-monitor-now for the condition's monitors.
- `POST /api/evidence/:id/wrong`: "Mark as wrong" → status recomputed from the remaining evidence.
- `GET/PATCH /api/settings`, `POST /api/settings/telegram/detect|test`: alert rules and the Telegram chat.
- `POST /api/webhooks/context`: stores every raw delivery, checks `X-Context-Signature`
  (HMAC-SHA256 of `t.rawBody`, 5 min tolerance). Logs unverified ones too unless `WEBHOOK_ENFORCE_SIGNATURE=true`.
- `GET  /api/webhooks/context`: last 50 events (JSON). UI: `/webhooks` (auto-refresh).
- `GET  /api/health`: DB, Context.dev key, `llm` flag, monitors on/off; 503 if the database is unreachable.

Demo reset before judging (resets both demo sites, seeds Nordwind / Slush / Anna's sentence, clears evidence +
timeline + alerts but keeps monitors, then captures a fresh baseline):
`curl -X POST -H "X-Demo-Key: $DEMO_KEY" https://<since-app>/api/demo/reset`

Dev helper: `node scripts/try-notyet.mjs <domain> "<come back when...>"` runs parse → start → check and prints the evidence.

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
- `POST /web/scrape` (markdown + HTML, `maxAgeMs: 0` for re-checks): every founder page, pricing page, careers page.
  Note: fresh scrapes are rate-limited to 10/min; the client retries with `retry-after` and pages are shared for 90 s.
- `POST /news/search` (by domain and natural language): independent coverage for announcements.
- Monitor types used: `extract` (market declarations), `page` (blog, job board, GitHub releases), `search` (independent coverage, LinkedIn/X).

## Other integrations used

- Granola (`GET /v1/notes?created_after&folder_id&cursor`, `GET /v1/notes/{id}?include=transcript`, `GET /v1/notes/{id}/transcript`): polled every 10 min + "Sync now"; meeting summaries and transcripts go through the same "not yet" extractor (verbatim-quote guard) into the Inbox, so a pass given in a call becomes a pending watch without retyping.
- **Cala** (REST `https://api.cala.ai/v1`, `X-API-KEY`): `GET /entities?name=` (entity search; we auto-accept only when Cala's `website` equals the startup domain), `POST /entities/{id}` (employee_count, funding rounds via PARTICIPATES_IN_CORPORATE_EVENT, investors via INVESTED_IN, presence/HQ/industry, each with source documents), `GET /entities/{id}/introspection` (to see which fields a round has: round_type, event_date, transaction_value). Why: verified, sourced company data verifies `funding_round` / `team_size` conditions and fills the "Since you passed" block of the reconnect email. Responses cached 1 h; snapshots polled every 30 min (Cala has no webhooks) and diffed for new investors.
