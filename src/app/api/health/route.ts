import { NextResponse } from "next/server";
import { one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let webhook_events: number | null = null;
  let db_error: string | null = null;
  try {
    webhook_events = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM webhook_events"))?.n ?? 0;
  } catch (e) {
    db_error = (e as Error).message;
  }
  return NextResponse.json(
    {
      ok: db_error === null,
      service: "since",
      time: new Date().toISOString(),
      db: db_error ?? "ok",
      webhook_events,
      context_key: Boolean(process.env.CONTEXT_API_KEY),
      public_base_url: process.env.PUBLIC_BASE_URL ?? null,
    },
    { status: db_error ? 503 : 200 },
  );
}
