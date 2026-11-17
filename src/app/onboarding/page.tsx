import { currentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { botInfo, telegramConfigured } from "@/lib/telegram";
import { inboxAddress } from "@/lib/inbound";
import { Onboarding } from "./Onboarding";

export const dynamic = "force-dynamic";

// Two-minute onboarding for pilot investors: Telegram -> forwarding address -> first "not yet".
export default async function OnboardingPage() {
  const user = (await currentUser())!;
  const s = await getSettings(user.id);
  const bot = telegramConfigured() ? await botInfo().catch(() => null) : null;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Welcome to Since</h1>
          <p>Two minutes: where alerts go, where to forward pass emails, and your first &ldquo;not yet&rdquo;.</p>
        </div>
      </div>
      <Onboarding
        botLink={bot ? `https://t.me/${bot.username}?start=${user.tg_token}` : null}
        connected={Boolean(s["telegram.chat_id"])}
        chatTitle={s["telegram.chat_title"]}
        forwardAddress={inboxAddress(user)}
        name={s["investor.name"]}
        fund={s["investor.fund"]}
      />
    </>
  );
}
