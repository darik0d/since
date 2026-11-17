import { currentUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pending count for the sidebar badge.
export async function GET() {
  const uid = (await currentUserId())!;
  const r = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM inbound_items WHERE status = 'pending' AND user_id = $1", [uid]).catch(() => null);
  return NextResponse.json({ pending: r?.n ?? 0 });
}
