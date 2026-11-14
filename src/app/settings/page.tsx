import { getSettings } from "@/lib/settings";
import { botInfo, telegramConfigured } from "@/lib/telegram";
import { query } from "@/lib/db";
import { SettingsForm } from "./SettingsForm";
import { fmtTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const [s, bot, last] = await Promise.all([
    getSettings(),
    telegramConfigured() ? botInfo().catch(() => null) : Promise.resolve(null),
    query<{ label: string; message: string; ok: boolean; error: string | null; sent_at: string }>(
      "SELECT label, message, ok, error, sent_at FROM alerts ORDER BY id DESC LIMIT 1",
    ),
  ]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>Where Since tells you a condition was met. Only channels that work are shown.</p>
        </div>
      </div>
      <SettingsForm
        initial={s}
        telegram={{ configured: telegramConfigured(), bot: bot?.username ?? null }}
        lastAlert={last[0] ? { ...last[0], sent_at: fmtTime(last[0].sent_at, { alwaysDate: true }) } : null}
      />
    </>
  );
}
