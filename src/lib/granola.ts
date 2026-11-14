import { ingest } from "./inbound";
import { getSettings, setSettings } from "./settings";

// Granola public REST API (read-only). Polls new meeting notes and feeds summary + transcript into
// the inbound extractor. Only notes with a finished AI summary are returned by Granola.
const BASE = "https://public-api.granola.ai";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const granolaConfigured = () => Boolean(process.env.GRANOLA_API_KEY);
export const granolaFolder = () => process.env.GRANOLA_FOLDER_ID?.trim() || null;

type ListResp = { notes: { id: string; title: string | null; created_at: string }[]; hasMore: boolean; cursor: string | null };
type TranscriptItem = { speaker?: { source?: string; attribution?: string; name?: string }; text: string };
type Note = {
  id: string;
  title: string | null;
  created_at: string;
  owner?: { name?: string; email?: string };
  web_url?: string;
  calendar_event?: { event_title?: string; scheduled_start_time?: string; organiser?: string | null; invitees?: { email: string; name?: string }[] } | null;
  attendees?: { name?: string; email?: string }[];
  folder_membership?: { id: string; name: string }[];
  summary_text?: string | null;
  summary_markdown?: string | null;
  transcript?: TranscriptItem[] | null;
};

class GranolaError extends Error {
  constructor(public status: number, public code: string, msg: string) {
    super(msg);
  }
}

async function get<T>(path: string): Promise<T> {
  await sleep(250); // ~5 req/s limit
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(BASE + path, {
      headers: { Authorization: `Bearer ${process.env.GRANOLA_API_KEY}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (r.status === 429 && attempt < 3) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new GranolaError(r.status, j.code ?? String(r.status), `Granola ${path.split("?")[0]}: ${j.code ?? r.status} ${j.message ?? ""}`.trim());
    return j as T;
  }
}

async function fullTranscript(id: string): Promise<TranscriptItem[]> {
  const out: TranscriptItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 40; page++) {
    const q = new URLSearchParams({ page_size: "100" });
    if (cursor) q.set("cursor", cursor);
    const r = await get<{ transcript: TranscriptItem[]; hasMore: boolean; cursor: string | null }>(`/v1/notes/${id}/transcript?${q}`);
    out.push(...(r.transcript ?? []));
    if (!r.hasMore || !r.cursor) break;
    cursor = r.cursor;
  }
  return out;
}

async function getNote(id: string): Promise<Note> {
  try {
    return await get<Note>(`/v1/notes/${id}?include=transcript`);
  } catch (e) {
    if (e instanceof GranolaError && e.code === "TRANSCRIPT_TOO_LARGE") {
      const n = await get<Note>(`/v1/notes/${id}`);
      return { ...n, transcript: await fullTranscript(id).catch(() => []) };
    }
    throw e;
  }
}

// Personal mailboxes say nothing about which company someone is from.
const PERSONAL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "me.com", "yahoo.com", "proton.me", "protonmail.com", "hey.com", "aol.com", "gmx.com", "gmx.de", "web.de"]);
const domainOf = (e: string) => e.toLowerCase().split("@")[1] ?? "";
/** "inferencemay.be" + title "Daria x Jesse @ InferenceMay" -> "InferenceMay" (the title's casing), else "Inferencemay". */
const nameFromDomain = (d: string, title?: string | null) => {
  const label = d.split(".")[0];
  const m = title?.match(new RegExp(`\\b${label.replace(/[^a-z0-9-]/gi, "")}\\b`, "i"));
  return m ? m[0] : label.replace(/^./, (c) => c.toUpperCase());
};

/**
 * Who was the meeting with? The first attendee/invitee outside the investor's own domain(s).
 * e.g. a meeting with bryan@nordwind.io -> startup nordwind.io, founder bryan@nordwind.io. Deterministic, not LLM.
 */
export function meetingCounterpart(n: Note) {
  const own = new Set(
    [n.owner?.email, ...(process.env.INVESTOR_EMAILS ?? "").split(",")]
      .map((e) => (e ?? "").trim().toLowerCase())
      .filter(Boolean)
      .map(domainOf)
      .filter((d) => d && !PERSONAL.has(d)),
  );
  const ownEmails = new Set([n.owner?.email, ...(process.env.INVESTOR_EMAILS ?? "").split(",")].map((e) => (e ?? "").trim().toLowerCase()).filter(Boolean));
  const people = [
    ...(n.attendees ?? []),
    ...(n.calendar_event?.invitees ?? []),
    ...(n.calendar_event?.organiser ? [{ email: n.calendar_event.organiser }] : []),
  ].filter((p): p is { email: string; name?: string } => Boolean(p?.email));
  const external = people.filter((p) => !ownEmails.has(p.email.toLowerCase()) && !own.has(domainOf(p.email)));
  const company = external.find((p) => !PERSONAL.has(domainOf(p.email)));
  const who = company ?? external[0];
  if (!who) return null;
  const d = company ? domainOf(company.email) : null;
  return {
    startup_domain: d,
    startup_name: d ? nameFromDomain(d, n.title ?? n.calendar_event?.event_title) : null,
    founder_email: who.email.toLowerCase(),
    founder_name: who.name?.trim() || null,
  };
}

function noteText(n: Note): string {
  const who = (t: TranscriptItem) =>
    t.speaker?.name ?? (t.speaker?.attribution === "me" || t.speaker?.source === "microphone" ? "Investor (me)" : "Them");
  const transcript = (n.transcript ?? []).map((t) => `${who(t)}: ${t.text}`).join("\n");
  return [
    n.title ? `Meeting: ${n.title}` : "",
    n.attendees?.length ? `Attendees: ${n.attendees.map((a) => [a.name, a.email && `<${a.email}>`].filter(Boolean).join(" ")).join(", ")}` : "",
    n.calendar_event?.invitees?.length ? `Invitees: ${n.calendar_event.invitees.map((a) => a.email).join(", ")}` : "",
    "",
    "Summary:",
    n.summary_markdown || n.summary_text || "",
    "",
    transcript ? `Transcript:\n${transcript}` : "",
  ].join("\n").trim();
}

let syncing: Promise<GranolaSyncResult> | null = null;
export type GranolaSyncResult = { ok: boolean; seen: number; new_items: number; pending: number; error?: string; last_sync: string };

/** Pull notes created since the last sync (first sync: 14 days back) and ingest them. One sync at a time. */
export function syncGranola(): Promise<GranolaSyncResult> {
  if (!syncing) syncing = doSync().finally(() => (syncing = null));
  return syncing;
}

async function doSync(): Promise<GranolaSyncResult> {
  const started = new Date().toISOString();
  if (!granolaConfigured()) return { ok: false, seen: 0, new_items: 0, pending: 0, error: "GRANOLA_API_KEY not set", last_sync: started };
  const s = await getSettings();
  // overlap one hour: notes appear only once their summary is ready, so created_at can be before the last sync
  const after = s["granola.last_sync"]
    ? new Date(new Date(s["granola.last_sync"]).getTime() - 3600_000).toISOString()
    : new Date(Date.now() - 14 * 86400_000).toISOString();
  let seen = 0, newItems = 0, pending = 0;
  try {
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const q = new URLSearchParams({ created_after: after, page_size: "30" });
      if (granolaFolder()) q.set("folder_id", granolaFolder()!);
      if (cursor) q.set("cursor", cursor);
      const list = await get<ListResp>(`/v1/notes?${q}`);
      for (const item of list.notes ?? []) {
        seen++;
        const n = await getNote(item.id);
        const folder = granolaFolder();
        if (folder && n.folder_membership && !n.folder_membership.some((f) => f.id === folder)) continue; // privacy: folder only
        const r = await ingest({
          source: "granola",
          external_id: n.id,
          sender: n.owner?.name ?? n.owner?.email ?? null,
          title: n.title ?? n.calendar_event?.event_title ?? "Granola meeting",
          meeting_at: n.calendar_event?.scheduled_start_time ?? n.created_at,
          raw_text: noteText(n),
          known: meetingCounterpart(n),
        });
        if (r.created) newItems++;
        if (r.created && r.status === "pending") pending++;
      }
      if (!list.hasMore || !list.cursor) break;
      cursor = list.cursor;
    }
    await setSettings({ "granola.last_sync": started });
    return { ok: true, seen, new_items: newItems, pending, last_sync: started };
  } catch (e) {
    return { ok: false, seen, new_items: newItems, pending, error: (e as Error).message, last_sync: s["granola.last_sync"] ?? "" };
  }
}
