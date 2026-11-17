import { query } from "./db";

// Small key/value settings in Postgres. Secrets (bot token) stay in env vars, never here.
export type Settings = {
  "alerts.reported": boolean; // founder-reported: on by default
  "alerts.needs_review": boolean; // off by default
  "telegram.enabled": boolean;
  "telegram.chat_id": string | null;
  "telegram.chat_title": string | null;
  "investor.name": string | null; // email signature
  "investor.fund": string | null;
  "granola.last_sync": string | null; // ISO time of the last Granola sync
};

const DEFAULTS: Settings = {
  "alerts.reported": true,
  "alerts.needs_review": false,
  "telegram.enabled": true,
  "telegram.chat_id": null,
  "telegram.chat_title": null,
  "investor.name": "Daria Matviichuk",
  "investor.fund": "Northstar Ventures",
  "granola.last_sync": null,
};

export async function getSettings(userId: number): Promise<Settings> {
  const rows = await query<{ key: string; value: unknown }>("SELECT key, value FROM settings WHERE user_id = $1", [userId]);
  const s = { ...DEFAULTS, "investor.name": userId === 1 ? DEFAULTS["investor.name"] : null, "investor.fund": userId === 1 ? DEFAULTS["investor.fund"] : null } as Record<string, unknown>;
  for (const r of rows) if (r.key in DEFAULTS) s[r.key] = r.value;
  // the owner's env chat id works without the UI step
  if (userId === 1 && !s["telegram.chat_id"] && process.env.TELEGRAM_CHAT_ID) s["telegram.chat_id"] = process.env.TELEGRAM_CHAT_ID;
  return s as Settings;
}

export async function setSettings(userId: number, patch: Partial<Settings>) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULTS)) continue;
    await query(
      "INSERT INTO settings (user_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value",
      [userId, k, JSON.stringify(v)],
    );
  }
  return getSettings(userId);
}
