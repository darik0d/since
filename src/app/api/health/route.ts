import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { n } = db().prepare("SELECT COUNT(*) AS n FROM webhook_events").get() as { n: number };
  return NextResponse.json({
    ok: true,
    service: "since",
    time: new Date().toISOString(),
    webhook_events: n,
    context_key: Boolean(process.env.CONTEXT_API_KEY),
    public_base_url: process.env.PUBLIC_BASE_URL ?? null,
  });
}
