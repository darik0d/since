import { one } from "./db";
import { publicBase } from "./env";
import { llmJson, nullable } from "./llm";
import { getSettings } from "./settings";
import { esc, sendTelegram, telegramConfigured } from "./telegram";

// Inbound "not yet"s (paste / email / Granola). One extractor for all sources.
// Nothing starts watching automatically: a found item becomes PENDING and the investor confirms it.

export type InboundSource = "paste" | "email" | "granola";
export const SOURCE_LABEL: Record<string, string> = { paste: "Pasted", email: "Email", granola: "Meeting notes" };

export type Extracted = {
  found: boolean;
  startup_name: string | null;
  startup_domain: string | null;
  founder_name: string | null;
  founder_email: string | null;
  met_on: string | null; // YYYY-MM-DD
  quote: string | null; // the investor's own "not yet / come back when" words, verbatim
  conditions_text: string | null;
};

export type InboundRow = {
  id: number;
  source: InboundSource;
  external_id: string;
  received_at: string;
  sender: string | null;
  title: string | null;
  meeting_at: string | null;
  raw_text: string | null;
  extracted_json: Extracted | null;
  status: "pending" | "accepted" | "dismissed" | "none";
  note: string | null;
  startup_id: number | null;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["found", "startup_name", "startup_domain", "founder_name", "founder_email", "met_on", "quote", "conditions_text"],
  properties: {
    found: { type: "boolean" },
    startup_name: nullable("string"),
    startup_domain: nullable("string"),
    founder_name: nullable("string"),
    founder_email: nullable("string"),
    met_on: nullable("string"),
    quote: nullable("string"),
    conditions_text: nullable("string"),
  },
};

/** Whitespace + quote-style normalization used by the verbatim guard. */
export const norm = (s: string) =>
  s.replace(/[’‘`]/g, "'").replace(/[“”«»]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();

const MAX_CHARS = 60_000;

export async function extract(rawText: string, hint: { title?: string | null; meeting_at?: string | null; sender?: string | null }): Promise<Extracted> {
  return llmJson<Extracted>({
    name: "inbound_not_yet",
    schema: SCHEMA,
    system: `You read an investor's email or meeting notes/transcript and find whether the INVESTOR told a startup "not yet" with conditions to come back ("come back when...", "let's talk again once...", "we'd want to see...").
Return found=false if there is no such pass-with-conditions by the investor.
- quote: the investor's words that state the conditions, copied VERBATIM from the text (exact characters, one contiguous span, max ~400 chars). Never paraphrase, never stitch pieces together.
- conditions_text: the same conditions as one clean "Come back when ..." sentence in plain words (may rephrase lightly, no new facts).
- startup_name / startup_domain / founder_name / founder_email: only if stated or obvious in the text (domain from an email address or URL of the startup; never the investor's own fund). Else null.
- met_on: the meeting date as YYYY-MM-DD if stated or given as the meeting time; else null.
Never invent facts.`,
    user: [
      hint.title ? `Title: ${hint.title}` : "",
      hint.sender ? `From: ${hint.sender}` : "",
      hint.meeting_at ? `Meeting time: ${hint.meeting_at}` : "",
      "",
      rawText.slice(0, MAX_CHARS),
    ].filter((x, i) => x || i === 3).join("\n"),
  });
}

/** Deterministic guard: the quote must literally appear in the raw text. Returns the original-cased span. */
export function verbatimQuote(raw: string, quote: string | null): string | null {
  if (!quote) return null;
  const q = norm(quote);
  if (q.length < 8) return null;
  return norm(raw).includes(q) ? quote.trim() : null;
}

export type IngestInput = {
  source: InboundSource;
  external_id: string;
  sender?: string | null;
  title?: string | null;
  meeting_at?: string | null;
  raw_text: string;
  /** Facts known from metadata (e.g. the meeting's external attendee): they override the LLM. */
  known?: { startup_domain?: string | null; startup_name?: string | null; founder_name?: string | null; founder_email?: string | null } | null;
};

/** Store an inbound item (idempotent per source+external_id), extract, and ping Telegram for new pending ones. */
export async function ingest(item: IngestInput): Promise<{ id: number; status: InboundRow["status"]; created: boolean; note: string | null }> {
  const inserted = await one<{ id: number }>(
    `INSERT INTO inbound_items (source, external_id, sender, title, meeting_at, raw_text, status)
     VALUES ($1,$2,$3,$4,$5,$6,'pending') ON CONFLICT (source, external_id) DO NOTHING RETURNING id`,
    [item.source, item.external_id, item.sender ?? null, item.title ?? null, item.meeting_at ?? null, item.raw_text],
  );
  if (!inserted) {
    const ex = await one<{ id: number; status: InboundRow["status"]; note: string | null }>(
      "SELECT id, status, note FROM inbound_items WHERE source = $1 AND external_id = $2",
      [item.source, item.external_id],
    );
    return { id: ex!.id, status: ex!.status, created: false, note: ex!.note };
  }

  let status: InboundRow["status"] = "pending";
  let note: string | null = null;
  let ex: Extracted | null = null;
  try {
    ex = await extract(item.raw_text, item);
    if (!ex.found) {
      status = "none";
      note = "No “not yet” with conditions found";
    } else {
      const q = verbatimQuote(item.raw_text, ex.quote);
      if (!q) {
        status = "none";
        note = "Quote not found verbatim in the text (blocked)";
      } else ex.quote = q;
    }
    if (ex.met_on && !/^\d{4}-\d{2}-\d{2}$/.test(ex.met_on)) ex.met_on = null;
    if (!ex.met_on && item.meeting_at) ex.met_on = item.meeting_at.slice(0, 10);
    // the calendar knows who the meeting was with: that beats anything read from the text
    const k = item.known ?? {};
    if (k.startup_domain) {
      if (ex.startup_domain && ex.startup_domain.replace(/^www\./, "") !== k.startup_domain) ex.startup_name = null;
      ex.startup_domain = k.startup_domain;
    }
    if (k.founder_email) ex.founder_email = k.founder_email;
    if (k.founder_name) ex.founder_name = k.founder_name;
    if (!ex.startup_name && k.startup_name) ex.startup_name = k.startup_name;
    if (ex.startup_domain) ex.startup_domain = ex.startup_domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  } catch (e) {
    status = "none";
    note = `Extraction failed: ${(e as Error).message.slice(0, 200)}`;
  }
  await one("UPDATE inbound_items SET extracted_json = $2, status = $3, note = $4 WHERE id = $1 RETURNING id", [
    inserted.id, ex ? JSON.stringify(ex) : null, status, note,
  ]);

  if (status === "pending" && ex?.quote) await ping(item.source, ex.quote, ex.startup_name ?? ex.startup_domain).catch((e) => console.error("[since] inbox ping", e));
  return { id: inserted.id, status, created: true, note };
}

async function ping(source: InboundSource, quote: string, startup: string | null) {
  if (!telegramConfigured()) return;
  const s = await getSettings();
  if (!s["telegram.enabled"] || !s["telegram.chat_id"]) return;
  const q = quote.length > 300 ? quote.slice(0, 297) + "…" : quote;
  await sendTelegram(s["telegram.chat_id"], `📥 New 'not yet'${startup ? ` for <b>${esc(startup)}</b>` : ""} from ${esc(SOURCE_LABEL[source] ?? source)}: “${esc(q)}”`, [
    { text: "Review", url: `${publicBase()}/inbox` },
  ]);
}
