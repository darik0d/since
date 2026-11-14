# Since (Junction 2026, Context.dev challenge)

## One-liner
Investors say "not yet, come back when X" to most startups and never follow up.
Since turns the investor's own "not yet" conditions into monitored conditions and
sends an alert with evidence the moment the live web shows a condition was met.

Pitch line: "Investors say 'not yet' and promise to keep in touch. They never do. Since does."

## Deadline
Final submission: Sunday Nov 15, 10:00 Helsinki time. Feature freeze: Saturday 21:00.

## Frozen scope (do NOT add features unless asked)
- User: an investor who told a startup "not yet".
- Input: startup domain + meeting date/place + "come back when..." in plain words.
  The LLM maps each condition to a supported type; the investor confirms/edits before monitoring starts.
- Four mechanisms (all publicly observable):
  1. product_shipped: GitHub release >= version, or App Store / Google Play listing exists.
     (Lowest priority for the demo.)
  2. market_launch: what the site DECLARES, not URLs: languages offered (language switcher,
     hreflang / lang tags), currencies on the pricing page, countries under "available in";
     plus an existence check for a country domain (e.g. nordwind.de). A German site may have no /de.
     The investor picks what counts (German site / EUR pricing / Germany listed; any of them).
  3. hiring_push: >= N open roles in one function. Sources: careers page + the job board it links to
     (Teamtailor, Greenhouse, Lever, Ashby, Workable, Personio) + a search monitor for indexed
     LinkedIn job posts (site:linkedin.com/jobs "<company>"). Dedupe by title.
     The count is a lower bound: seeing >= N confirms; fewer keeps "watching", never "failed".
  4. announcement, subtypes customer | revenue | retention: watch the founder's channels
     (blog, newsroom, customers page), news search, and indexed LinkedIn/X posts via search monitors.
     Extract the claim (who / how much), then a deterministic rule checks it against the threshold.
- "Best possible evidence" is shown on every condition card:
  - customer: can reach confirmed (the customer's own site/newsroom, or independent news).
  - revenue: usually reported (confirmed only via official filings, e.g. Finnish public
    financial statements: annual and months late). Press quoting the founder = still reported.
  - retention: reported at most.
- "Ask at check-in": only conditions with no public signal at all (burn rate, cap table, ...).
  Anything the LLM cannot map to a mechanism goes here with a one-line reason; investor can edit.
- Statuses:
  - watching: monitors active, no evidence yet.
  - reported: claim found ONLY on founder-controlled sources.
  - confirmed: a deterministic rule passes on a platform or independent source
    (reported -> confirmed upgrade when independent evidence appears).
  - needs_review: ambiguous or conflicting evidence. No alert.
  - ask_at_checkin, expired (after the deadline).
- Alerts: confirmed = always; reported = on by default, labeled "founder-reported";
  needs_review = off by default. Each alert: original wording, evidence URL, snapshot time,
  detection time, rule that passed, source type. Buttons: "Open in Since", "Mark as wrong".
- Alert channels: Slack incoming webhook, Telegram bot, email. Settings page with toggles.
  Build Telegram first (demo), then Slack, then email. Show only toggles that actually work.
- LinkedIn: NEVER scrape linkedin.com. Only search monitors over search-indexed results.
  Indexing takes days and is partial: fine for weeks-long watching, not for the live demo.
- The LLM never decides a status. It only maps conditions, extracts claims, writes alert sentences.
- Out of scope for now: momentum scoring, deck fact-check reports, LinkedIn scraping,
  auto actions, payments/blockchain, pre-meeting briefs.

## Evidence record (per status change)
url, source_type (platform | independent | founder_controlled), snapshot_time,
content_hash, excerpt, detected_at, webhook_received_at, verified_at, rule_passed,
raw_webhook_id. Keep every raw webhook payload (needed for the timeline and honest replay).

## Event timeline (shown in the UI, real timestamps)
condition created -> baseline captured -> change detected -> webhook received
-> evidence checked (source type) -> status changed -> alert sent (channels).

## Context.dev facts (checked 2026-11-14)
- Account: ~51,000 credits (hackathon grant, confirmed via get-usage at 08:19).
  Monitor limit: up to 500 concurrent promised, but get-monitor-limits still reported
  10 (plan "free") at 08:19. Re-check get-monitor-limits before creating more than 10.
- Monitor schedule minimum interval: 10 minutes. Use 10 min for demo-critical monitors, 30 min for the rest.
- run-monitor-now queues an immediate check and fires the webhook if a change is found.
  Use it for the live demo and for the "Re-check now" button.
- Monitor target types:
  - page: one URL; include_selectors / exclude_selectors cut noise; instructions -> semantic detection.
  - sitemap: confirmed URL additions/removals; include globs.
  - extract: structured data with a JSON schema + semantic change detection
    (confidence_threshold, default 0.75). Fits market_launch declarations and hiring role lists.
  - search: runs a web query every check, reports new matching results (instructions filter
    what matters). Fits announcements and indexed LinkedIn posts.
- News search tool exists (by company name/domain or query). Fits announcements.
- Webhook events: change.detected, run.completed. Changes include diffs and evidence.
  Webhook secret can be rotated; verify signatures. Slack webhook URLs get formatted messages.
- web-scrape has prebuilt parsers incl. app-store and google-play (version, details).
- Browser actions need a paid plan: don't rely on them.
- MCP for coding agents: https://mcp.context.dev/mcp
  Claude Code: `claude mcp add --transport http context https://mcp.context.dev/mcp`, then `/mcp` to sign in.
- App/server uses the REST API with an API key (Authorization: Bearer <CONTEXT_API_KEY>).
  Check docs.context.dev for the REST equivalents of the MCP tools.

## Condition -> monitors mapping
1. product_shipped: page monitor on github.com/<org>/<repo>/releases (selector on the release list),
   verifier parses the version. App store variant: web-scrape prebuilt parser.
2. market_launch: extract monitor on homepage + pricing, schema
   {languages:[...], currencies:[...], countries_available:[...]}; plus country-domain check.
3. hiring_push: extract monitor on careers page and job board, schema {roles:[{title, department, location}]};
   search monitor for site:linkedin.com/jobs "<company>". Verifier counts deduped roles in the function.
4. announcement: page/extract monitor on founder blog/newsroom/customers page (founder_controlled),
   search monitor + news search for independent coverage, and for customer subtype a page monitor
   on the customer's own newsroom once a customer is named (independent).

## UI (4 screens; layout drafted in Google Stitch)
Style: calm, data-dense (Linear/Attio-like), light theme, one accent (deep indigo), Inter,
monospace for timestamps/URLs. Status chips: Watching (gray), Reported (amber), Confirmed (green),
Needs review (orange outline), Ask at check-in (blue-gray), Expired (light gray, strikethrough).
1. Watchlist: startups said "not yet" to; columns: logo+name+domain (logo via Context.dev brand data),
   said-not-yet date+place, condition chips, latest change, last checked. Banner "N conditions met this week".
2. New "not yet": form (domain, meeting date, where, "Come back when..." textarea) -> parsed condition
   cards (plain words, "How we verify", sources, editable fields, best possible evidence, preview chip;
   unmappable ones as gray "Ask at check-in" cards) -> "Start watching (N monitors)" -> baseline strip.
3. Condition detail: investor's original words + date; status chip with upgrade note; evidence cards
   (source-type badge, URL, excerpt, snapshot time); right column vertical timeline with real timestamps;
   buttons "Re-check now" and "Mark as wrong"; footer "Monitored with Context.dev".
4. Settings > Notifications: Email / Slack / Telegram channel cards with toggles; "Alert me when a
   condition becomes": Confirmed (locked on), Reported (on), Needs review (off); alert preview.

## Demo story (all fictional, always say so)
- Investor "Anna K., Northstar Ventures" met Nordwind (nordwind.io) at Slush on Nov 12 and said:
  "Come back when you have your first enterprise customer and you're selling in Germany.
   And when revenue is over €1M ARR."
- Assets we control: Nordwind site (blog, pricing, careers) and fictional customer
  Kallio Logistics site with a newsroom (kallio.fi-style). Label both fictional in the demo.
- These test projects live OUTSIDE this repo, in sibling folders next to since/:
  ../nordwind and ../kallio. Never create them inside since/. Build them only after the
  platform core works (see milestones). Serve them as static sites (separate small nginx
  containers on Aiven Runtime, or the fallback server).
- Live beat 1: Nordwind blog posts "Welcome Kallio Logistics, our first enterprise customer"
  -> Re-check now -> status Reported -> alert labeled "founder-reported".
- Live beat 2: Kallio newsroom posts "Kallio selects Nordwind" -> Re-check now
  -> status upgrades to Confirmed -> second alert "Confirmed by the customer".
- Real startups monitored overnight: show only neutral, verified facts. Never "contradicted" on a real company.
- Monitor budget: ~6 for Nordwind/Kallio; 20-30 real startups overnight once the higher limit is active.

## Architecture
- One Next.js service in one Docker container.
- LLM: OpenAI (OPENAI_API_KEY, LLM_PROVIDER=openai), a small current model with structured
  JSON outputs. Used only to map "come back when..." into conditions and to write alert sentences.
- Database: Aiven PostgreSQL (DATABASE_URL from env). Migrate off SQLite/better-sqlite3 NOW:
  Aiven Runtime containers are stateless, and Postgres is what makes the Aiven entry meaningful
  (evidence ledger, raw webhook log, status history/timeline).
- POST /api/webhooks/context: verify secret, store raw event, re-verify, update status, send alerts.
- POST /api/conditions/:id/recheck: calls run-monitor-now for that condition's monitors.
- Deploy (decided 09:30): Aiven Runtime + Aiven PostgreSQL. Vultr is OUT.
  - Aiven Runtime builds and deploys from the GitHub repo using our Dockerfile; public endpoint is
    always HTTPS on 443 (*.aiven.app), Aiven terminates TLS -> no Caddy needed there.
    Redeploy = "Deploy latest commit". Runtime may need access approval: ask at the Aiven booth.
  - Fallback if Runtime access is not granted quickly: Verda CPU instance (free at Junction) with our
    existing Docker Compose + Caddy plan, still using Aiven PostgreSQL.
  - Until deployed: develop locally, use a tunnel for Context.dev webhooks.
  - Secrets only in .env / Aiven env vars (never commit .env).

## Prize entries (one project, several entries)
- Main: Context.dev "The Web Is Your Real-Time Database".
- Tech challenge "Best Use of Context.dev: Fully Structured Web" (EUR 750 / 250 / swag): Context.dev must be
  in the core flow and visibly drive the demo. Submit: GitHub repo + demo + a short note on which
  Context.dev endpoints we used and why. Keep a running list in README.md.
- Tech challenge "Best Use of Aiven" (EUR 1000 / 750 / 500): Aiven PostgreSQL + Aiven Runtime as a
  meaningful part of the solution.
- Cala "Make Unicorns Real": decide after the 11:00 workshop.
- The repo must live on GitHub (Runtime deploys from it; submissions need it).

## Milestones (Saturday, subject to change)
- M0 07:50-09:50 (home): scaffold the Since app, Context.dev API tests, HTTPS webhook logger (local + tunnel until hosting is decided).
  No test projects yet.
- M1 12:00-15:00 core: data model, condition mapping (LLM) + confirm step, verifiers for the
  4 mechanisms (announcement + market_launch first), evidence store.
  Done when: checks on 3 real startups are correct.
- M1.5 ~15:00 (30 min max): test projects in ../nordwind and ../kallio (plain static HTML:
  Nordwind home/blog/pricing/careers, Kallio newsroom), deployed as static sites on the deploy server.
- M2 15:00-18:00 real-time loop: monitors -> webhook -> re-verify -> status -> Telegram -> timeline.
  Done when: live beat 1 and 2 work end to end. Start real-startup monitors by 18:00.
- M3 18:30-21:00 UI: the 4 screens (Settings can be minimal), Slack/email if time.
- 21:00 feature freeze + deploy. 22:30 demo video v1 + deck v1 + submit.
