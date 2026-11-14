# Since

Investors say "not yet" and promise to keep in touch. They never do. Since does.
(Junction 2026, Context.dev challenge. Product spec: see CLAUDE.md.)

## Local

```bash
npm install
cp .env.example .env        # set CONTEXT_API_KEY
npm run dev                 # http://localhost:3000
npm run context:smoke       # Context.dev REST checks (usage, limits, monitors, brand, news, scrape)
npm run webhook:test        # signed fake webhook -> shows "verified" in /webhooks
```

## Endpoints (M0)

- `POST /api/webhooks/context`: stores every raw delivery, checks `X-Context-Signature`
  (HMAC-SHA256 of `t.rawBody`, 5 min tolerance). Logs unverified ones too unless `WEBHOOK_ENFORCE_SIGNATURE=true`.
- `GET  /api/webhooks/context`: last 50 events (JSON). UI: `/webhooks` (auto-refresh).
- `POST /api/conditions/:id/recheck`: run-monitor-now for a condition's monitors.
- `GET  /api/health`

## Vultr deploy

1. Create an Ubuntu 24.04 VM in an EU region (Frankfurt/Amsterdam/Stockholm), add your SSH key.
2. `scp deploy/vultr-bootstrap.sh root@<ip>:` then `ssh root@<ip> bash vultr-bootstrap.sh`
   (installs Docker, opens 80/443, prints `SITE_DOMAIN` / `PUBLIC_BASE_URL`).
3. `cp .env.example .env.production`, fill `CONTEXT_API_KEY`, `SITE_DOMAIN=<ip-dashed>.sslip.io`,
   `PUBLIC_BASE_URL=https://<ip-dashed>.sslip.io`.
4. `./deploy/deploy.sh root@<ip>`. Caddy gets the certificate automatically.
5. Check: `curl https://<ip-dashed>.sslip.io/api/health`, then
   `npm run webhook:test -- https://<ip-dashed>.sslip.io` (needs the same `CONTEXT_WEBHOOK_SECRETS` as the server),
   then `npm run context:smoke -- --monitor` for a real Context.dev webhook, and `-- --cleanup` afterwards.
