import { NextResponse } from "next/server";
import { syncGranola } from "@/lib/granola";
import { currentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// "Sync now" in Settings: pull the signed-in user's new Granola meeting notes into their inbox.
export async function POST() {
  const r = await syncGranola((await currentUserId())!);
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
