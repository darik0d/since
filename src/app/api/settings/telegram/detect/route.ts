import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { processUpdates } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The investor opens t.me/<bot>?start=<their token> and presses Start; we bind that chat via getUpdates.
export async function POST() {
  const userId = (await currentUserId())!;
  try {
    await processUpdates();
    const s = await getSettings(userId);
    if (!s["telegram.chat_id"]) return NextResponse.json({ ok: false, error: "Not connected yet: open the bot link and press Start" }, { status: 404 });
    return NextResponse.json({ ok: true, chat: { id: s["telegram.chat_id"], title: s["telegram.chat_title"] } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
