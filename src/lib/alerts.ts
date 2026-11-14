import { one, query } from "./db";
import { llmJson } from "./llm";
import { getSettings } from "./settings";
import { esc, sendTelegram, telegramConfigured } from "./telegram";
import type { Status } from "./types";

// Alert rules (CLAUDE.md): confirmed = always; reported = on by default, labeled "founder-reported";
// needs_review = off by default. Each alert: original wording, evidence URL, snapshot time,
// detection time, rule that passed, source type. Buttons: "Open in Since", "Mark as wrong".

type Ev = { id: number; url: string; source_type: string; snapshot_time: string | null; detected_at: string | null; excerpt: string | null; rule_passed: string | null };

const LABEL: Record<string, string> = { confirmed: "✅ Confirmed", reported: "🟡 Founder-reported", needs_review: "🟠 Needs review" };
const SOURCE: Record<string, string> = { platform: "platform", independent: "independent source", founder_controlled: "founder-controlled source" };

export async function maybeAlert(conditionId: number, from: Status, to: Status, note: string | null) {
  if (!["confirmed", "reported", "needs_review"].includes(to)) return;
  const s = await getSettings();
  if (to === "reported" && !s["alerts.reported"]) return;
  if (to === "needs_review" && !s["alerts.needs_review"]) return;

  const c = await one<{ original_words: string; plain_words: string | null; company: string; domain: string; met_on: string | null; met_where: string | null }>(
    `SELECT c.original_words, c.plain_words, COALESCE(s.name, s.domain) AS company, s.domain,
            to_char(s.met_on, 'YYYY-MM-DD') AS met_on, s.met_where
     FROM conditions c JOIN startups s ON s.id = c.startup_id WHERE c.id = $1`,
    [conditionId],
  );
  if (!c) return;
  // best evidence for this status: independent/platform first, newest first
  const ev = await one<Ev>(
    `SELECT id, url, source_type, snapshot_time, detected_at, excerpt, rule_passed FROM evidence
     WHERE condition_id = $1 AND passes AND NOT marked_wrong
     ORDER BY (source_type <> 'founder_controlled') DESC, created_at DESC LIMIT 1`,
    [conditionId],
  );

  const sentence = await alertSentence(c.company, c.original_words, to, ev?.excerpt ?? "", note);
  const base = process.env.PUBLIC_BASE_URL ?? "";
  const link = `${base}/conditions/${conditionId}`;
  const html = [
    `<b>${LABEL[to]} · ${esc(c.company)}</b>`,
    esc(sentence),
    "",
    `<i>You said${c.met_on ? ` on ${c.met_on}` : ""}${c.met_where ? ` at ${esc(c.met_where)}` : ""}:</i> “${esc(c.original_words)}”`,
    ev
      ? [
          `<b>Evidence</b> (${SOURCE[ev.source_type] ?? ev.source_type}): <a href="${esc(ev.url)}">${esc(ev.url.replace(/^https?:\/\//, "").slice(0, 70))}</a>`,
          ev.excerpt ? `“${esc(ev.excerpt.slice(0, 280))}”` : "",
          `<b>Rule</b>: ${esc(ev.rule_passed ?? "—")}`,
          `<b>Snapshot</b>: ${fmt(ev.snapshot_time)} · <b>Detected</b>: ${fmt(ev.detected_at)}`,
        ].filter(Boolean).join("\n")
      : "",
    note ? `<i>${esc(note)}</i>` : "",
    base.startsWith("https://") ? "" : `\n${esc(link)}`,
  ].filter((x) => x !== "").join("\n");

  const label = to === "reported" ? "founder-reported" : to;
  if (!telegramConfigured() || !s["telegram.enabled"] || !s["telegram.chat_id"]) {
    await record(conditionId, ev?.id ?? null, "telegram", label, html, false, !telegramConfigured() ? "TELEGRAM_BOT_TOKEN not set" : "Telegram not connected or disabled");
    return;
  }
  try {
    await sendTelegram(s["telegram.chat_id"], html, [
      { text: "Open in Since", url: link },
      ...(ev ? [{ text: "Mark as wrong", url: `${link}?wrong=${ev.id}` }] : []),
    ]);
    await record(conditionId, ev?.id ?? null, "telegram", label, html, true, null);
  } catch (e) {
    await record(conditionId, ev?.id ?? null, "telegram", label, html, false, (e as Error).message);
  }
}

async function record(conditionId: number, evidenceId: number | null, channel: string, label: string, message: string, ok: boolean, error: string | null) {
  await query(
    "INSERT INTO alerts (condition_id, evidence_id, channel, label, message, ok, error) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [conditionId, evidenceId, channel, label, message, ok, error],
  );
  await query("INSERT INTO timeline_events (condition_id, kind, detail) VALUES ($1, 'alert_sent', $2)", [
    conditionId,
    JSON.stringify({ channel, label, ok, error }),
  ]);
}

const fmt = (iso: string | null) => (iso ? iso.replace("T", " ").replace(/:\d\d(\.\d+)?Z$/, " UTC") : "—");

/** One neutral sentence (LLM writes it; falls back to a template). It never decides anything. */
async function alertSentence(company: string, words: string, to: Status, excerpt: string, note: string | null): Promise<string> {
  const fallback =
    to === "confirmed" ? `${company} met your condition, confirmed by ${note ? "the customer" : "an independent or platform source"}.`
    : to === "reported" ? `${company} says it met your condition (founder-reported, not yet independently confirmed).`
    : `${company} may have met your condition; the evidence needs a human look.`;
  try {
    const r = await Promise.race([
      llmJson<{ sentence: string }>({
        name: "alert",
        schema: { type: "object", additionalProperties: false, required: ["sentence"], properties: { sentence: { type: "string" } } },
        system: `Write ONE short, neutral sentence (max 25 words) telling an investor what changed. Status is "${to}" (already decided; do not change it).
"reported" means only the founder says so: say it is founder-reported. "confirmed" means an independent or platform source shows it. No hype, no advice.`,
        user: `Startup: ${company}\nInvestor's condition: "${words}"\nEvidence excerpt: "${excerpt.slice(0, 400)}"${note ? `\nNote: ${note}` : ""}`,
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
    ]);
    return r.sentence || fallback;
  } catch {
    return fallback;
  }
}
