import { NextResponse } from "next/server";
import { one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pending count for the sidebar badge.
export async function GET() {
  const r = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM inbound_items WHERE status = 'pending'").catch(() => null);
  return NextResponse.json({ pending: r?.n ?? 0 });
}
