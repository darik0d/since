import { after, NextResponse } from "next/server";
import { one, query } from "@/lib/db";
import { findKey, processWebhook } from "@/lib/process-webhook";
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
    parsed?.data?.run?.monitor_id ?? parsed?.data?.change?.monitor_id ?? parsed?.data?.monitor_id ?? (findKey(parsed, "monitor_id") as string | undefined) ?? null;

  const secrets: string[] = [];
  if (monitorId) {
    const row = await one<{ webhook_secret: string | null }>("SELECT webhook_secret FROM monitors WHERE id = $1", [
      monitorId,
    ]);
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
    ? await one<{ id: number }>("SELECT id FROM webhook_events WHERE context_id = $1 AND signature_ok LIMIT 1", [contextId])
    : undefined;

  const inserted = await one<{ id: number }>(
    `INSERT INTO webhook_events (context_id, delivery_id, attempt, event, monitor_id, signature_ok, signature_note, headers_json, body_raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      contextId,
      h.get("x-context-delivery-id"),
      Number(h.get("x-context-attempt")) || null,
      h.get("x-context-event") ?? parsed?.event ?? null,
      monitorId,
      sig.ok,
      duplicate ? `${sig.note}; duplicate of #${duplicate.id}` : sig.note,
      JSON.stringify(headers),
      raw,
    ],
  );
  const logged = inserted?.id;

  if (!sig.ok && process.env.WEBHOOK_ENFORCE_SIGNATURE === "true") {
    return NextResponse.json({ ok: false, error: sig.note, logged }, { status: 401 });
  }
  // answer now (Context.dev wants a 2xx within 15 s), re-verify right after the response
  if (logged) after(() => processWebhook(logged).catch((e) => console.error("[since] webhook processing", e)));
  return NextResponse.json({ ok: true, logged, signature: sig.note });
}

// Recent events (for the Webhook log screen / quick curl checks).
export async function GET() {
  const rows = await query(
    "SELECT id, context_id, event, monitor_id, signature_ok, signature_note, received_at FROM webhook_events ORDER BY id DESC LIMIT 50",
  );
  return NextResponse.json({ events: rows });
}
