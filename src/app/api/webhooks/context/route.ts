import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyContextSignature } from "@/lib/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// M0: HTTPS webhook logger. Stores EVERY raw payload (verified or not) and answers fast (<15s).
// M2 adds: re-verify -> status -> alerts, driven from the stored row.
export async function POST(req: Request) {
  const raw = await req.text(); // raw bytes first: the signature is over the exact body
  const h = req.headers;

  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {}

  const monitorId: string | null =
    parsed?.data?.run?.monitor_id ?? parsed?.data?.change?.monitor_id ?? parsed?.data?.monitor_id ?? null;

  const conn = db();
  const secrets: string[] = [];
  if (monitorId) {
    const row = conn.prepare("SELECT webhook_secret FROM monitors WHERE id = ?").get(monitorId) as
      | { webhook_secret: string | null }
      | undefined;
    if (row?.webhook_secret) secrets.push(row.webhook_secret);
  }
  for (const s of (process.env.CONTEXT_WEBHOOK_SECRETS || "").split(",")) if (s.trim()) secrets.push(s.trim());

  const sig = verifyContextSignature(raw, h.get("x-context-signature"), secrets);

  const headers: Record<string, string> = {};
  h.forEach((v, k) => {
    if (k.startsWith("x-context") || k === "content-type" || k === "user-agent") headers[k] = v;
  });

  const contextId = h.get("x-context-id") ?? parsed?.id ?? null;
  const duplicate = contextId
    ? conn.prepare("SELECT id FROM webhook_events WHERE context_id = ? AND signature_ok = 1 LIMIT 1").get(contextId)
    : undefined;

  const info = conn
    .prepare(
      `INSERT INTO webhook_events (context_id, delivery_id, attempt, event, monitor_id, signature_ok, signature_note, headers_json, body_raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      contextId,
      h.get("x-context-delivery-id"),
      Number(h.get("x-context-attempt")) || null,
      h.get("x-context-event") ?? parsed?.event ?? null,
      monitorId,
      sig.ok ? 1 : 0,
      duplicate ? `${sig.note}; duplicate of #${(duplicate as { id: number }).id}` : sig.note,
      JSON.stringify(headers),
      raw,
    );

  if (!sig.ok && process.env.WEBHOOK_ENFORCE_SIGNATURE === "true") {
    return NextResponse.json({ ok: false, error: sig.note, logged: info.lastInsertRowid }, { status: 401 });
  }
  return NextResponse.json({ ok: true, logged: Number(info.lastInsertRowid), signature: sig.note });
}

// Recent events (for the Webhook log screen / quick curl checks).
export async function GET() {
  const rows = db()
    .prepare(
      "SELECT id, context_id, event, monitor_id, signature_ok, signature_note, received_at FROM webhook_events ORDER BY id DESC LIMIT 50",
    )
    .all();
  return NextResponse.json({ events: rows });
}
