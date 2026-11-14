import { NextResponse } from "next/server";
import { syncGranola } from "@/lib/granola";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// "Sync now" in Settings: pull new Granola meeting notes into the inbox.
export async function POST() {
  const r = await syncGranola();
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
