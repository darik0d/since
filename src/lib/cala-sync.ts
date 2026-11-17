import { calaConfigured, takeSnapshot } from "./cala";
import { checkCondition } from "./conditions";
import { query } from "./db";
import { withUser } from "./usage";
import { publicBase } from "./env";
import { getSettings } from "./settings";
import { esc, sendTelegram, telegramConfigured } from "./telegram";

// Cala has no webhooks: this poll (every 30 min + "Check now") is its real-time part.
// Snapshot -> diff (new investors -> Telegram) -> re-check the Cala-verified conditions.
export async function syncCalaStartup(startupId: number, trigger = "cala_poll") {
  const own = await query<{ user_id: number }>("SELECT user_id FROM startups WHERE id = $1", [startupId]);
  const t = await withUser(own[0]?.user_id ?? null, () => takeSnapshot(startupId, { fresh: true }));
  if (!t) return null;
  const s = (await query<{ name: string; user_id: number }>("SELECT COALESCE(name, domain) AS name, user_id FROM startups WHERE id = $1", [startupId]))[0];
  const conds = await query<{ id: number }>(
    "SELECT id FROM conditions WHERE startup_id = $1 AND mechanism IN ('funding_round','team_size')",
    [startupId],
  );
  for (const c of conds) await checkCondition(c.id, { trigger }).catch((e) => console.error("[since] cala check", e));

  if (t.newInvestors.length) {
    const st = await getSettings(s.user_id);
    if (telegramConfigured() && st["telegram.enabled"] && st["telegram.chat_id"]) {
      const link = conds[0] ? `${publicBase()}/conditions/${conds[0].id}` : `${publicBase()}/`;
      for (const i of t.newInvestors) {
        await sendTelegram(st["telegram.chat_id"], `🔔 <b>New investor in ${esc(s.name)}</b>: ${esc(i.name)} (via Cala)`, [{ text: "Open", url: link }]).catch(() => {});
      }
    }
  }
  return { employee_count: t.snap.employee_count?.value ?? null, rounds: t.snap.rounds.length, investors: t.snap.investors.length, new_investors: t.newInvestors.map((i) => i.name) };
}

export async function pollCala() {
  if (!calaConfigured()) return { ok: false, error: "CALA_API_KEY not set" };
  const rows = await query<{ id: number }>("SELECT id FROM startups WHERE cala_entity_id IS NOT NULL");
  let n = 0;
  for (const r of rows) {
    await syncCalaStartup(r.id).then(() => n++).catch((e) => console.error("[since] cala sync", r.id, e));
  }
  return { ok: true, startups: n };
}
