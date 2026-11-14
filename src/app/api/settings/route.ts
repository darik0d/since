import { NextResponse } from "next/server";
import { getSettings, setSettings, type Settings } from "@/lib/settings";
import { botInfo, telegramConfigured } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSettings();
  const bot = telegramConfigured() ? await botInfo().catch(() => null) : null;
  return NextResponse.json({ settings: s, telegram: { configured: telegramConfigured(), bot: bot?.username ?? null } });
}

export async function PATCH(req: Request) {
  const patch = (await req.json()) as Partial<Settings>;
  // "Confirmed" alerts are always on and not a setting; only these can change from the UI
  const allowed: (keyof Settings)[] = ["alerts.reported", "alerts.needs_review", "telegram.enabled"];
  const clean = Object.fromEntries(Object.entries(patch).filter(([k, v]) => allowed.includes(k as keyof Settings) && typeof v === "boolean"));
  return NextResponse.json({ settings: await setSettings(clean) });
}
