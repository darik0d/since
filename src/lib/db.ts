import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// One SQLite file, one process. Schema is created on first use (idempotent).
const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS startups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  domain        TEXT NOT NULL UNIQUE,
  name          TEXT,
  logo_url      TEXT,
  met_on        TEXT,            -- ISO date of the "not yet" meeting
  met_where     TEXT,
  original_text TEXT,            -- investor's "come back when..." words
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS conditions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  startup_id    INTEGER NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  original_words TEXT NOT NULL,
  mechanism     TEXT NOT NULL,   -- product_shipped | market_launch | hiring_push | announcement | ask_at_checkin
  subtype       TEXT,            -- customer | revenue | retention (announcement)
  params_json   TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'watching',
                -- watching | reported | confirmed | needs_review | ask_at_checkin | expired
  best_evidence TEXT,            -- confirmed | reported
  reason        TEXT,            -- for ask_at_checkin
  deadline      TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS monitors (
  id             TEXT PRIMARY KEY,   -- Context.dev monitor id
  condition_id   INTEGER REFERENCES conditions(id) ON DELETE SET NULL,
  target_type    TEXT NOT NULL,      -- page | sitemap | extract | search
  target_json    TEXT NOT NULL,
  source_type    TEXT,               -- platform | independent | founder_controlled
  webhook_secret TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Every raw webhook, verified or not. Never deleted: timeline + honest replay.
CREATE TABLE IF NOT EXISTS webhook_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  context_id     TEXT,               -- X-Context-Id (stable across retries)
  delivery_id    TEXT,
  attempt        INTEGER,
  event          TEXT,
  monitor_id     TEXT,
  signature_ok   INTEGER NOT NULL DEFAULT 0,
  signature_note TEXT,
  headers_json   TEXT NOT NULL,
  body_raw       TEXT NOT NULL,
  received_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processed_at   TEXT
);
CREATE INDEX IF NOT EXISTS webhook_events_context_id ON webhook_events(context_id);

CREATE TABLE IF NOT EXISTS evidence (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  condition_id        INTEGER NOT NULL REFERENCES conditions(id) ON DELETE CASCADE,
  url                 TEXT NOT NULL,
  source_type         TEXT NOT NULL,   -- platform | independent | founder_controlled
  snapshot_time       TEXT,
  content_hash        TEXT,
  excerpt             TEXT,
  detected_at         TEXT,
  webhook_received_at TEXT,
  verified_at         TEXT,
  rule_passed         TEXT,
  raw_webhook_id      INTEGER REFERENCES webhook_events(id),
  marked_wrong        INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- condition created -> baseline captured -> change detected -> webhook received
-- -> evidence checked -> status changed -> alert sent
CREATE TABLE IF NOT EXISTS timeline_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  condition_id INTEGER REFERENCES conditions(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  detail       TEXT,
  at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  condition_id INTEGER REFERENCES conditions(id) ON DELETE CASCADE,
  evidence_id  INTEGER REFERENCES evidence(id),
  channel      TEXT NOT NULL,     -- telegram | slack | email
  label        TEXT,              -- confirmed | founder-reported | needs_review
  message      TEXT,
  ok           INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  sent_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

declare global {
  // eslint-disable-next-line no-var
  var __sinceDb: Database.Database | undefined;
}

export function db(): Database.Database {
  if (!globalThis.__sinceDb) {
    const file = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "since.db");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const conn = new Database(file);
    conn.exec(SCHEMA);
    globalThis.__sinceDb = conn;
  }
  return globalThis.__sinceDb;
}

export type WebhookEventRow = {
  id: number;
  context_id: string | null;
  delivery_id: string | null;
  attempt: number | null;
  event: string | null;
  monitor_id: string | null;
  signature_ok: number;
  signature_note: string | null;
  headers_json: string;
  body_raw: string;
  received_at: string;
  processed_at: string | null;
};
