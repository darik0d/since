import { createHmac, timingSafeEqual } from "node:crypto";
import { one, query } from "./db";
import { publicBase } from "./env";
import { llmJson } from "./llm";
import { getSettings } from "./settings";
import { getCalaBlock, type CalaBlock } from "./cala-block";

// Reconnect email (M4 Step 1). Every fact (quote, dates, links, statuses) comes from the DB and is
// placed by the template. The LLM only writes subject, a 1-2 sentence opener and a 1-sentence ask.

/** HMAC-SHA256(startup_id, APP_SECRET), hex, first 32 chars. null when APP_SECRET is unset. */
export function reconnectToken(startupId: number): string | null {
  const secret = process.env.APP_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(String(startupId)).digest("hex").slice(0, 32);
}

export function checkToken(startupId: number, t: string | null | undefined): boolean {
  const want = reconnectToken(startupId);
  if (!want || !t || t.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(t));
}

export function reconnectUrl(startupId: number): string | null {
  const t = reconnectToken(startupId);
  return t ? `${publicBase()}/startups/${startupId}/reconnect?t=${t}` : null;
}

/** Relative link for in-app buttons. */
export function reconnectPath(startupId: number): string | null {
  const t = reconnectToken(startupId);
  return t ? `/startups/${startupId}/reconnect?t=${t}` : null;
}

export const smtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

type CondFact = {
  id: number;
  original_words: string;
  plain_words: string | null;
  status: string;
  reason: string | null;
  ev_url: string | null;
  ev_source_type: string | null;
  ev_at: string | null;
  ev_rule: string | null;
};
export type Facts = {
  startup: {
    id: number; name: string; domain: string; display_domain: string | null; logo_url: string | null;
    met_on: string | null; met_where: string | null; original_text: string | null;
    founder_name: string | null; founder_email: string | null;
  };
  conditions: (CondFact & { source_name: string | null })[];
  since: { at: string; text: string; url: string | null; source_name: string | null }[];
  cala: CalaBlock | null;
  investor: { name: string | null; fund: string | null };
  booking_url: string | null;
};

export async function loadFacts(startupId: number): Promise<Facts | null> {
  const s = await one<Facts["startup"] & { met_on_raw: string | null }>(
    `SELECT id, COALESCE(name, domain) AS name, domain, display_domain, logo_url, to_char(met_on, 'FMDD Mon YYYY') AS met_on,
            met_on::text AS met_on_raw, met_where, original_text, founder_name, founder_email
     FROM startups WHERE id = $1`,
    [startupId],
  );
  if (!s) return null;
  const conds = await query<CondFact & { params_json: { customer_sites?: { name: string; domain: string }[] } }>(
    `SELECT c.id, c.original_words, c.plain_words, c.status, c.reason, c.params_json,
            e.url AS ev_url, e.source_type AS ev_source_type, COALESCE(e.snapshot_time, e.created_at) AS ev_at, e.rule_passed AS ev_rule
     FROM conditions c
     LEFT JOIN LATERAL (
       SELECT * FROM evidence WHERE condition_id = c.id AND passes AND NOT marked_wrong
       ORDER BY (source_type <> 'founder_controlled') DESC, created_at DESC LIMIT 1
     ) e ON true
     WHERE c.startup_id = $1 ORDER BY c.id`,
    [startupId],
  );
  const customers = conds.flatMap((c) => c.params_json?.customer_sites ?? []);
  const sourceName = (url: string | null) => {
    if (!url) return null;
    let host = "";
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
    if (host === s.domain || host.endsWith("." + s.domain)) return s.display_domain ?? s.domain;
    if (host === "github.com") return "GitHub";
    const cust = customers.find((k) => host === k.domain || host.endsWith("." + k.domain));
    if (cust) return `${cust.name}'s newsroom`;
    return host;
  };

  // "Since then": evidence that counted + status changes, oldest first
  const ev = await query<{ at: string; url: string; source_type: string; rule_passed: string | null; words: string }>(
    `SELECT COALESCE(e.snapshot_time, e.created_at) AS at, e.url, e.source_type, e.rule_passed, COALESCE(c.plain_words, c.original_words) AS words
     FROM evidence e JOIN conditions c ON c.id = e.condition_id
     WHERE c.startup_id = $1 AND e.passes AND NOT e.marked_wrong ORDER BY at`,
    [startupId],
  );
  const changes = await query<{ at: string; to: string; words: string }>(
    `SELECT t.at, t.detail->>'to' AS to, COALESCE(c.plain_words, c.original_words) AS words
     FROM timeline_events t JOIN conditions c ON c.id = t.condition_id
     WHERE c.startup_id = $1 AND t.kind = 'status_changed' AND t.detail->>'to' IN ('reported','confirmed') ORDER BY t.at`,
    [startupId],
  );
  const SRC: Record<string, string> = { founder_controlled: "founder's own channel", independent: "independent source", platform: "platform" };
  const since = [
    ...ev.map((e) => ({
      at: e.at,
      text: `${e.rule_passed ?? "Evidence found"} (${SRC[e.source_type] ?? e.source_type})`,
      url: e.url,
      source_name: sourceName(e.url),
    })),
    ...changes.map((c) => ({
      at: c.at,
      text: `Since marked “${c.words}” as ${c.to === "reported" ? "founder-reported" : "confirmed"}`,
      url: null,
      source_name: null,
    })),
  ]
    .sort((a, b) => a.at.localeCompare(b.at))
    // the same finding seen on several checks (different snapshots) appears once, at its first sighting
    .filter((e, i, all) => all.findIndex((x) => x.text === e.text && x.url === e.url) === i);

  const st = await getSettings();
  const { met_on_raw, ...startup } = s;
  return {
    startup,
    conditions: conds.map(({ params_json, ...c }) => ({ ...c, source_name: sourceName(c.ev_url) })),
    since,
    cala: await getCalaBlock(startupId, met_on_raw).catch(() => null),
    investor: { name: st["investor.name"], fund: st["investor.fund"] },
    booking_url: process.env.BOOKING_URL || null,
  };
}

/** Can the investor reconnect? At least one reported/confirmed; "all" when every non-ask one is confirmed. */
export function readiness(statuses: string[]) {
  const live = statuses.filter((s) => s !== "ask_at_checkin");
  return {
    any: statuses.some((s) => s === "reported" || s === "confirmed"),
    all: live.length > 0 && live.every((s) => s === "confirmed"),
  };
}

// ---------- LLM copy ----------

export type Copy = { subject: string; opener: string; ask: string };

export function fallbackCopy(f: Facts): Copy {
  const latest = [...f.conditions].filter((c) => c.status === "confirmed" || c.status === "reported").pop();
  const hi = f.startup.founder_name ? `Hi ${f.startup.founder_name.split(" ")[0]},` : "Hi,";
  return {
    subject: `${f.startup.name}: catching up since ${f.startup.met_where ?? "we met"}`,
    opener: `${hi} congratulations${latest ? ` on ${latest.plain_words ?? latest.original_words}` : ""}. I've been following your progress.`,
    ask: "Would you have 20 minutes in the next two weeks to catch up?",
  };
}

export async function draftCopy(f: Facts): Promise<Copy> {
  const fb = fallbackCopy(f);
  const facts = [
    `Startup: ${f.startup.name}`,
    f.startup.founder_name ? `Founder: ${f.startup.founder_name}` : "",
    `Met: ${f.startup.met_where ?? "?"} on ${f.startup.met_on ?? "?"}`,
    `Investor's words then: "${f.startup.original_text ?? ""}"`,
    ...f.conditions.map((c) => `Condition "${c.plain_words ?? c.original_words}": ${c.status.replace(/_/g, " ")}${c.ev_rule ? ` (${c.ev_rule}${c.source_name ? `, ${c.source_name}` : ""})` : ""}`),
    f.investor.name ? `Investor: ${f.investor.name}${f.investor.fund ? `, ${f.investor.fund}` : ""}` : "",
  ].filter(Boolean).join("\n");
  try {
    const r = await Promise.race([
      llmJson<Copy>({
        name: "reconnect",
        schema: {
          type: "object", additionalProperties: false, required: ["subject", "opener", "ask"],
          properties: { subject: { type: "string" }, opener: { type: "string" }, ask: { type: "string" } },
        },
        system: `You write the connective sentences of a short, warm, professional email from an investor to a founder they told "not yet".
The email body (quote, checklist with sources, timeline) is filled in by a template: do NOT restate numbers, dates, links or lists.
- subject: max 8 words, personal, no clickbait.
- opener: 1-2 sentences. Greet the founder by first name if given, congratulate on the most recent CONFIRMED milestone (or a founder-reported one, worded as "I saw you announced"). Use only facts given.
- ask: exactly 1 sentence asking for a short call. No promises about investing.`,
        user: facts,
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 12000)),
    ]);
    return { subject: r.subject || fb.subject, opener: r.opener || fb.opener, ask: r.ask || fb.ask };
  } catch {
    return fb;
  }
}

// ---------- rendering ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const norm = (x: string) => x.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').toLowerCase();
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/Helsinki", day: "numeric", month: "short", year: "numeric" }) : "";

/** The full sentence split into plain / highlighted segments (every condition's words). */
export function highlightSegments(full: string, parts: string[]): { text: string; hl: boolean }[] {
  const n = norm(full);
  const ranges: [number, number][] = [];
  for (const p of parts) {
    const i = n.indexOf(norm(p));
    if (p && i >= 0) ranges.push([i, i + p.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const out: { text: string; hl: boolean }[] = [];
  let pos = 0;
  for (const [a, b] of ranges) {
    if (a < pos) continue;
    if (a > pos) out.push({ text: full.slice(pos, a), hl: false });
    out.push({ text: full.slice(a, b), hl: true });
    pos = b;
  }
  if (pos < full.length) out.push({ text: full.slice(pos), hl: false });
  return out;
}

const COLORS = {
  confirmed: { fg: "#047857", bg: "#d1fae5", icon: "✓", label: "Confirmed" },
  reported: { fg: "#b45309", bg: "#fef3c7", icon: "◐", label: "Founder-reported" },
  ask_at_checkin: { fg: "#475569", bg: "#e2e8f0", icon: "?", label: "Ask at check-in" },
  open: { fg: "#6b7280", bg: "#f3f4f6", icon: "○", label: "Still open" },
} as const;
const kind = (s: string) => (s === "confirmed" ? "confirmed" : s === "reported" ? "reported" : s === "ask_at_checkin" ? "ask_at_checkin" : "open");

/** "burn rate" -> "How is burn rate looking?" (template, not LLM) */
const asQuestion = (c: CondFact) => {
  const w = (c.plain_words ?? c.original_words).replace(/[.?!]+$/, "");
  return /\?$/.test(c.original_words) ? c.original_words : `How is “${w}” looking?`;
};

export function renderEmail(f: Facts, copy: Copy): { html: string; text: string } {
  const S = f.startup;
  const F = "font-family:Inter,Arial,Helvetica,sans-serif;";
  const parts = f.conditions.map((c) => c.original_words);
  const segs = S.original_text ? highlightSegments(S.original_text, parts) : parts.map((p) => ({ text: p + " ", hl: true }));
  const quoteHtml = segs.map((x) => (x.hl ? `<span style="background:#dbeafe;color:#1e3a8a;border-radius:3px;padding:0 2px;">${esc(x.text)}</span>` : esc(x.text))).join("");
  const metLine = `When we met${S.met_where ? ` at ${S.met_where}` : ""}${S.met_on ? ` on ${S.met_on}` : ""}, I said:`;

  const rows = f.conditions.map((c) => {
    const k = COLORS[kind(c.status)];
    const what = c.status === "ask_at_checkin" ? asQuestion(c) : c.plain_words ?? c.original_words;
    let detail = "";
    if (c.status === "confirmed" || c.status === "reported") {
      const src = [c.source_name, day(c.ev_at)].filter(Boolean).join(", ");
      detail = `${c.ev_rule ? esc(c.ev_rule) : ""}${src ? ` · ${c.ev_url ? `<a href="${esc(c.ev_url)}" style="color:#1d4ed8;">${esc(src)}</a>` : esc(src)}` : ""}${c.status === "reported" ? " · founder-reported" : ""}`;
    } else if (c.status === "ask_at_checkin") detail = "Let's cover this when we talk.";
    else detail = "still open";
    return `<tr><td style="padding:8px 0;border-bottom:1px solid #eef0f3;vertical-align:top;width:28px;">
<span style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;border-radius:10px;background:${k.bg};color:${k.fg};font-weight:700;font-size:12px;">${k.icon}</span></td>
<td style="padding:8px 0 8px 6px;border-bottom:1px solid #eef0f3;${F}font-size:14px;color:#111827;">
<div style="font-weight:600;">${esc(what)} <span style="font-weight:600;font-size:11px;color:${k.fg};background:${k.bg};border-radius:8px;padding:1px 7px;margin-left:4px;">${k.label}</span></div>
<div style="font-size:12.5px;color:${c.status === "confirmed" || c.status === "reported" ? "#4b5563" : "#9ca3af"};margin-top:2px;">${detail}</div></td></tr>`;
  });

  const sinceRows = f.since.map(
    (e) => `<tr><td style="padding:4px 10px 4px 0;${F}font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;font-family:Menlo,Consolas,monospace;">${esc(day(e.at))}</td>
<td style="padding:4px 0;${F}font-size:13px;color:#374151;">${esc(e.text)}${e.url ? ` · <a href="${esc(e.url)}" style="color:#1d4ed8;">${esc(e.source_name ?? "source")}</a>` : ""}</td></tr>`,
  );

  const cala = f.cala && f.cala.items.length
    ? `<tr><td style="padding:18px 0 4px;${F}font-size:13px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:.04em;">Since you passed</td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${f.cala.items
        .map(
          (i) => `<tr><td style="padding:4px 0;${F}font-size:13px;color:#374151;">${esc(i.text)}${i.url ? ` · <a href="${esc(i.url)}" style="color:#1d4ed8;">${esc(i.source ?? "source")}</a>` : i.source ? ` · <span style="color:#6b7280;">${esc(i.source)}</span>` : ""}</td></tr>`,
        )
        .join("")}</table>
<div style="${F}font-size:11px;color:#9ca3af;padding-top:4px;">Company data via Cala</div></td></tr>`
    : "";

  const sig = [f.investor.name, f.investor.fund].filter(Boolean).map((x) => esc(x!)).join("<br>");
  const book = f.booking_url
    ? `<tr><td style="padding:14px 0 4px;"><a href="${esc(f.booking_url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;${F}font-size:14px;font-weight:600;padding:10px 18px;border-radius:999px;">Book 20 minutes</a></td></tr>`
    : "";
  const logo = S.logo_url
    ? `<tr><td style="padding-bottom:14px;"><img src="${esc(S.logo_url)}" width="36" height="36" alt="${esc(S.name)}" style="border-radius:8px;display:block;"></td></tr>`
    : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(copy.subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f7f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;">
<tr><td style="padding:28px 28px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${logo}
<tr><td style="${F}font-size:15px;line-height:1.55;color:#111827;padding-bottom:16px;">${esc(copy.opener)}</td></tr>
<tr><td style="${F}font-size:14px;color:#374151;padding-bottom:6px;">${esc(metLine)}</td></tr>
<tr><td style="${F}font-size:15px;line-height:1.55;color:#111827;border-left:3px solid #2563eb;padding:4px 0 4px 12px;font-style:italic;">“${quoteHtml.trim()}”</td></tr>
<tr><td style="padding:18px 0 4px;${F}font-size:13px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:.04em;">Where things stand</td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table></td></tr>
${sinceRows.length ? `<tr><td style="padding:18px 0 4px;${F}font-size:13px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:.04em;">Since then</td></tr>
<tr><td><table role="presentation" cellpadding="0" cellspacing="0">${sinceRows.join("")}</table></td></tr>` : ""}
${cala}
<tr><td style="${F}font-size:15px;line-height:1.55;color:#111827;padding-top:20px;">${esc(copy.ask)}</td></tr>
${book}
<tr><td style="${F}font-size:14px;line-height:1.5;color:#111827;padding-top:18px;">Best,<br>${sig}</td></tr>
</table></td></tr></table>
<div style="${F}font-size:11px;color:#9ca3af;padding-top:10px;">Progress tracked with Since</div>
</td></tr></table></body></html>`;

  const L: string[] = [copy.opener, "", metLine, `"${S.original_text ?? parts.join(" ")}"`, "", "WHERE THINGS STAND"];
  for (const c of f.conditions) {
    const k = COLORS[kind(c.status)];
    if (c.status === "confirmed" || c.status === "reported")
      L.push(`${k.icon} ${c.plain_words ?? c.original_words} [${k.label}]: ${c.ev_rule ?? ""}${c.source_name ? ` (${c.source_name}, ${day(c.ev_at)})` : ""}${c.ev_url ? ` ${c.ev_url}` : ""}`);
    else if (c.status === "ask_at_checkin") L.push(`? ${asQuestion(c)}`);
    else L.push(`○ ${c.plain_words ?? c.original_words}: still open`);
  }
  if (f.since.length) {
    L.push("", "SINCE THEN");
    for (const e of f.since) L.push(`${day(e.at)}  ${e.text}${e.url ? ` ${e.url}` : ""}`);
  }
  if (f.cala?.items.length) {
    L.push("", "SINCE YOU PASSED");
    for (const i of f.cala.items) L.push(`- ${i.text}${i.source ? ` (${i.source})` : ""}${i.url ? ` ${i.url}` : ""}`);
    L.push("Company data via Cala");
  }
  L.push("", copy.ask);
  if (f.booking_url) L.push(`Book 20 minutes: ${f.booking_url}`);
  L.push("", "Best,", ...[f.investor.name, f.investor.fund].filter((x): x is string => Boolean(x)));
  return { html, text: L.join("\n") };
}

// ---------- sending ----------

export async function sendReconnect(startupId: number, msg: { to: string; subject: string; opener: string; ask: string; html: string; text: string }) {
  const n = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM reconnects WHERE status = 'sent' AND sent_at > now() - interval '1 hour'"))?.n ?? 0;
  if (n >= 10) throw new Error("Send limit reached (10 per hour). Try again later.");
  const nodemailer = (await import("nodemailer")).default;
  const port = Number(process.env.SMTP_PORT || 465);
  const tx = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const info = await tx.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
  const row = await one<{ id: number; sent_at: string }>(
    `INSERT INTO reconnects (startup_id, to_email, subject, opener, ask, html, text, status, sent_at, smtp_message_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'sent',now(),$8) RETURNING id, sent_at`,
    [startupId, msg.to, msg.subject, msg.opener, msg.ask, msg.html, msg.text, info.messageId ?? null],
  );
  // "Reconnected" on every condition's timeline of this startup
  await query(
    `INSERT INTO timeline_events (condition_id, kind, detail)
     SELECT id, 'reconnected', $2::jsonb FROM conditions WHERE startup_id = $1`,
    [startupId, JSON.stringify({ to: msg.to, subject: msg.subject, reconnect_id: row!.id })],
  );
  return row!;
}
