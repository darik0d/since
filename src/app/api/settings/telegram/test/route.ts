import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { sendTelegram } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const s = await getSettings();
  if (!s["telegram.chat_id"]) return NextResponse.json({ ok: false, error: "Telegram chat not connected" }, { status: 400 });
  try {
    const base = process.env.PUBLIC_BASE_URL ?? "";
    await sendTelegram(
      s["telegram.chat_id"],
      "<b>Since is connected.</b>\nYou'll get a message here when one of your “not yet” conditions is met, with the evidence.",
      [{ text: "Open Since", url: base }],
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
