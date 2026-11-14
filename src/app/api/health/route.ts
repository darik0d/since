import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { monitorsEnabled } from "@/lib/monitors";

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
      llm: Boolean(process.env.OPENAI_API_KEY),
      llm_provider: process.env.LLM_PROVIDER ?? "openai",
      llm_model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      monitors: monitorsEnabled(),
      public_base_url: process.env.PUBLIC_BASE_URL ?? null,
    },
    { status: db_error ? 503 : 200 },
  );
}
