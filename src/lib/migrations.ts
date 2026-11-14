import { pool } from "./db";

// Append-only list. Never edit an applied migration: add a new one.
// Applied at server startup (src/instrumentation.ts); Aiven Runtime has no pre-deploy hook.
const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "001_init",
    sql: `
CREATE TABLE startups (
  id            BIGSERIAL PRIMARY KEY,
  domain        TEXT NOT NULL UNIQUE,
  name          TEXT,
  logo_url      TEXT,
  met_on        DATE,                 -- the "not yet" meeting
  met_where     TEXT,
  original_text TEXT,                 -- investor's "come back when..." words
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conditions (
  id             BIGSERIAL PRIMARY KEY,
  startup_id     BIGINT NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  original_words TEXT NOT NULL,
  mechanism      TEXT NOT NULL,   -- product_shipped | market_launch | hiring_push | announcement | ask_at_checkin
  subtype        TEXT,            -- customer | revenue | retention (announcement)
  params_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  status         TEXT NOT NULL DEFAULT 'watching'
                 CHECK (status IN ('watching','reported','confirmed','needs_review','ask_at_checkin','expired')),
  best_evidence  TEXT,            -- confirmed | reported
  reason         TEXT,            -- for ask_at_checkin
  deadline       DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX conditions_startup ON conditions(startup_id);

CREATE TABLE monitors (
  id             TEXT PRIMARY KEY,   -- Context.dev monitor id
  condition_id   BIGINT REFERENCES conditions(id) ON DELETE SET NULL,
  target_type    TEXT NOT NULL,      -- page | sitemap | extract | search
  target_json    JSONB NOT NULL,
  source_type    TEXT,               -- platform | independent | founder_controlled
  webhook_secret TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX monitors_condition ON monitors(condition_id);

-- Every raw webhook, verified or not. Never deleted: timeline + honest replay.
CREATE TABLE webhook_events (
  id             BIGSERIAL PRIMARY KEY,
  context_id     TEXT,               -- X-Context-Id (stable across retries)
  delivery_id    TEXT,
  attempt        INTEGER,
  event          TEXT,
  monitor_id     TEXT,
  signature_ok   BOOLEAN NOT NULL DEFAULT false,
  signature_note TEXT,
  headers_json   JSONB NOT NULL,
  body_raw       TEXT NOT NULL,      -- exact bytes as received (signature is over these)
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at   TIMESTAMPTZ
);
CREATE INDEX webhook_events_context_id ON webhook_events(context_id);
CREATE INDEX webhook_events_monitor ON webhook_events(monitor_id);

CREATE TABLE evidence (
  id                  BIGSERIAL PRIMARY KEY,
  condition_id        BIGINT NOT NULL REFERENCES conditions(id) ON DELETE CASCADE,
  url                 TEXT NOT NULL,
  source_type         TEXT NOT NULL CHECK (source_type IN ('platform','independent','founder_controlled')),
  snapshot_time       TIMESTAMPTZ,
  content_hash        TEXT,
  excerpt             TEXT,
  detected_at         TIMESTAMPTZ,
  webhook_received_at TIMESTAMPTZ,
  verified_at         TIMESTAMPTZ,
  rule_passed         TEXT,
  raw_webhook_id      BIGINT REFERENCES webhook_events(id),
  marked_wrong        BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX evidence_condition ON evidence(condition_id);

-- condition created -> baseline captured -> change detected -> webhook received
-- -> evidence checked -> status changed -> alert sent
CREATE TABLE timeline_events (
  id           BIGSERIAL PRIMARY KEY,
  condition_id BIGINT REFERENCES conditions(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  detail       JSONB,
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX timeline_condition ON timeline_events(condition_id, at);

CREATE TABLE alerts (
  id           BIGSERIAL PRIMARY KEY,
  condition_id BIGINT REFERENCES conditions(id) ON DELETE CASCADE,
  evidence_id  BIGINT REFERENCES evidence(id),
  channel      TEXT NOT NULL,     -- telegram | slack | email
  label        TEXT,              -- confirmed | founder-reported | needs_review
  message      TEXT,
  ok           BOOLEAN NOT NULL DEFAULT false,
  error        TEXT,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
`,
  },
  {
    id: "002_m1_checks",
    sql: `
ALTER TABLE conditions
  ADD COLUMN plain_words     TEXT,
  ADD COLUMN status_note     TEXT,             -- e.g. "Upgraded from Reported: confirmed by an independent source"
  ADD COLUMN last_checked_at TIMESTAMPTZ,
  ADD COLUMN last_check      JSONB;            -- latest CheckResult (summary, sources, observations)

ALTER TABLE evidence
  ADD COLUMN passes  BOOLEAN NOT NULL DEFAULT true,  -- false = observed but no rule passed (needs review)
  ADD COLUMN details JSONB;
CREATE UNIQUE INDEX evidence_dedupe ON evidence(condition_id, url, content_hash);

ALTER TABLE monitors
  ADD COLUMN name TEXT,
  ADD COLUMN role TEXT;                        -- what this monitor watches, e.g. "founder blog"
`,
  },
  {
    id: "003_display_domain",
    sql: `
-- What the UI shows instead of the real host (demo sites live on *.aiven.app, the story says nordwind.io).
ALTER TABLE startups ADD COLUMN display_domain TEXT;
`,
  },
  {
    id: "004_reconnect",
    sql: `
ALTER TABLE startups ADD COLUMN founder_name TEXT;
ALTER TABLE startups ADD COLUMN founder_email TEXT;
CREATE TABLE reconnects (
  id              SERIAL PRIMARY KEY,
  startup_id      INTEGER NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  to_email        TEXT,
  subject         TEXT,
  opener          TEXT,
  ask             TEXT,
  html            TEXT,
  text            TEXT,
  status          TEXT NOT NULL DEFAULT 'draft',   -- draft | sent
  sent_at         TIMESTAMPTZ,
  smtp_message_id TEXT
);
CREATE INDEX reconnects_startup ON reconnects (startup_id, created_at DESC);
`,
  },
  {
    id: "005_inbound",
    sql: `
-- Inbound "not yet"s from paste / email / Granola. Nothing starts watching automatically.
CREATE TABLE inbound_items (
  id             SERIAL PRIMARY KEY,
  source         TEXT NOT NULL,                 -- paste | email | granola
  external_id    TEXT NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sender         TEXT,
  title          TEXT,
  meeting_at     TIMESTAMPTZ,
  raw_text       TEXT,
  extracted_json JSONB,
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | dismissed | none
  note           TEXT,
  startup_id     INTEGER REFERENCES startups(id) ON DELETE SET NULL,
  UNIQUE (source, external_id)
);
`,
  },
  {
    id: "006_cala",
    sql: `
ALTER TABLE startups ADD COLUMN cala_entity_id TEXT;
ALTER TABLE startups ADD COLUMN cala_match TEXT;          -- auto | picked | not_found
CREATE TABLE cala_cache (key TEXT PRIMARY KEY, json JSONB NOT NULL, fetched_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE cala_snapshots (
  id         SERIAL PRIMARY KEY,
  startup_id INTEGER NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  entity_id  TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_json  JSONB NOT NULL
);
CREATE INDEX cala_snapshots_startup ON cala_snapshots (startup_id, fetched_at DESC);
`,
  },
];

const LOCK_KEY = 7_041_202_6; // arbitrary constant: one migrator at a time across instances

export async function migrate(log: (m: string) => void = console.log) {
  const client = await pool().connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const done = new Set((await client.query("SELECT id FROM schema_migrations")).rows.map((r) => r.id as string));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
        await client.query("COMMIT");
        log(`[since] migration applied: ${m.id}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${m.id} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    client.release();
  }
}
