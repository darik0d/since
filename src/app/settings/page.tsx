import { getSettings } from "@/lib/settings";
import { botInfo, telegramConfigured } from "@/lib/telegram";
import { query } from "@/lib/db";
import { SettingsForm } from "./SettingsForm";
import { fmtTime } from "@/lib/time";
import { granolaFolder, granolaKeyFor } from "@/lib/granola";
import { currentUser } from "@/lib/auth";
import { inboxAddress } from "@/lib/inbound";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const user = (await currentUser())!;
  const [s, bot, last] = await Promise.all([
    getSettings(user.id),
    telegramConfigured() ? botInfo().catch(() => null) : Promise.resolve(null),
    query<{ label: string; message: string; ok: boolean; error: string | null; sent_at: string }>(
      `SELECT a.label, a.message, a.ok, a.error, a.sent_at FROM alerts a
       JOIN conditions c ON c.id = a.condition_id JOIN startups st ON st.id = c.startup_id
       WHERE st.user_id = $1 ORDER BY a.id DESC LIMIT 1`,
      [user.id],
    ),
  ]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>Where Since tells you a condition was met, and where it finds new &ldquo;not yet&rdquo;s. Only integrations that work are shown.</p>
        </div>
      </div>
      <SettingsForm
        initial={s}
        telegram={{ configured: telegramConfigured(), bot: bot?.username ?? null, startToken: user.tg_token }}
        granola={{ connected: Boolean(granolaKeyFor(user)), own: Boolean(user.granola_key_enc), folder: user.id === 1 && Boolean(granolaFolder()), last_sync: s["granola.last_sync"] ? fmtTime(s["granola.last_sync"], { alwaysDate: true }) : null }}
        inboundEmail={inboxAddress(user)}
        lastAlert={last[0] ? { ...last[0], sent_at: fmtTime(last[0].sent_at, { alwaysDate: true }) } : null}
      />
    </>
  );
}
