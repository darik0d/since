import { publicBase } from "@/lib/env";
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
      telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      smtp: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
      booking_url: Boolean(process.env.BOOKING_URL),
      app_secret: Boolean(process.env.APP_SECRET),
      granola: Boolean(process.env.GRANOLA_API_KEY),
      granola_folder: Boolean(process.env.GRANOLA_FOLDER_ID),
      cala: Boolean(process.env.CALA_API_KEY),
      inbound_email: Boolean(process.env.INBOUND_EMAIL_BASIC && process.env.INVESTOR_EMAILS),
      public_base_url: (publicBase() || null),
    },
    { status: db_error ? 503 : 200 },
  );
}
