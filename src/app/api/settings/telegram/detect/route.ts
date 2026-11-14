import { NextResponse } from "next/server";
import { setSettings } from "@/lib/settings";
import { detectChat } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The investor sends any message to the bot, then clicks "Detect chat": we read getUpdates.
export async function POST() {
  try {
    const chat = await detectChat();
    if (!chat) return NextResponse.json({ ok: false, error: "No messages yet: send /start to the bot first" }, { status: 404 });
    await setSettings({ "telegram.chat_id": chat.id, "telegram.chat_title": chat.title, "telegram.enabled": true });
    return NextResponse.json({ ok: true, chat });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
