import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ingest } from "@/lib/inbound";
import { one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Postmark inbound webhook (JSON). The investor forwards or BCCs their own pass email to INBOUND_EMAIL_ADDRESS.
// Auth: HTTP basic auth from the credentials in the webhook URL, compared with INBOUND_EMAIL_BASIC ("user:pass").
// Only mail FROM an address in INVESTOR_EMAILS is accepted. Nothing starts watching: the item becomes pending.
type Addr = { Email: string; Name?: string };
type Postmark = {
  MessageID?: string; MailboxHash?: string; Subject?: string; Date?: string; TextBody?: string; StrippedTextReply?: string;
  FromFull?: Addr; ToFull?: Addr[]; CcFull?: Addr[]; BccFull?: Addr[];
};

function authorized(req: Request) {
  const want = process.env.INBOUND_EMAIL_BASIC;
  const h = req.headers.get("authorization") ?? "";
  if (!want || !h.startsWith("Basic ")) return false;
  const got = Buffer.from(Buffer.from(h.slice(6), "base64").toString("utf8"));
  const exp = Buffer.from(want);
  return got.length === exp.length && timingSafeEqual(got, exp);
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "WWW-Authenticate": 'Basic realm="since"' } });
  const m = (await req.json().catch(() => null)) as Postmark | null;
  if (!m?.MessageID) return NextResponse.json({ error: "not a Postmark inbound message" }, { status: 400 });

  // routed by the plus-address (since+<inbox_token>@...); the plain address belongs to the owner
  const owner = await one<{ id: number; email: string }>(
    m.MailboxHash ? "SELECT id, email FROM users WHERE inbox_token = $1" : "SELECT id, email FROM users WHERE id = 1",
    m.MailboxHash ? [m.MailboxHash.toLowerCase()] : [],
  );
  const investors = [
    owner?.email,
    ...(owner?.id === 1 ? (process.env.INVESTOR_EMAILS ?? "").split(",") : []),
  ].map((x) => (x ?? "").trim().toLowerCase()).filter(Boolean);
  const from = m.FromFull?.Email?.toLowerCase() ?? "";
  // only the investor's own address is accepted; 200 so Postmark doesn't retry
  if (!owner || !investors.includes(from)) return NextResponse.json({ ok: true, ignored: "unknown mailbox or sender is not the account's own email" });

  const inbound = (process.env.INBOUND_EMAIL_ADDRESS ?? "").toLowerCase();
  const skip = (a: Addr) => {
    const e = a.Email.toLowerCase();
    return e === inbound || (inbound && e.split("@")[1] === inbound.split("@")[1]) || investors.includes(e) || e.endsWith("@inbound.postmarkapp.com");
  };
  // the founder: original To/Cc of a BCC'd mail, or the To:/Cc: lines of a forwarded one (the extractor reads those)
  const direct = [...(m.ToFull ?? []), ...(m.CcFull ?? [])].filter((a) => !skip(a));
  const fmt = (a: Addr) => (a.Name ? `${a.Name} <${a.Email}>` : a.Email);
  const body = m.TextBody ?? m.StrippedTextReply ?? "";
  const raw = [
    `Subject: ${m.Subject ?? ""}`,
    `From: ${fmt(m.FromFull!)}`,
    direct.length ? `To: ${direct.map(fmt).join(", ")}` : "",
    m.Date ? `Date: ${m.Date}` : "",
    "",
    body, // forwarded messages keep the investor's words below "Forwarded message"
  ].filter((x, i) => x !== "" || i === 4).join("\n");

  const meeting = m.Date && !Number.isNaN(Date.parse(m.Date)) ? new Date(m.Date).toISOString() : null;
  const r = await ingest({ user_id: owner.id, source: "email", external_id: m.MessageID, sender: fmt(m.FromFull!), title: m.Subject ?? "Email", meeting_at: meeting, raw_text: raw });
  return NextResponse.json({ ok: true, ...r });
}
