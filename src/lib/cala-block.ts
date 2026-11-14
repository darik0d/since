import { fmtMoney, latestSnapshot } from "./cala";

// "Since you passed" block (reconnect email + condition page). Facts only, all from Cala snapshots,
// and only things dated after the meeting. Hidden when there is no Cala match (e.g. the fictional demo).
export type CalaBlock = { items: { text: string; source: string | null; url: string | null }[] };

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";

export async function getCalaBlock(startupId: number, metOn: string | null): Promise<CalaBlock | null> {
  const l = await latestSnapshot(startupId).catch(() => null);
  if (!l) return null;
  const { snap, first } = l;
  const after = (d: string | null) => Boolean(d && metOn && d.slice(0, 10) > metOn.slice(0, 10));
  const items: CalaBlock["items"] = [];

  for (const r of snap.rounds.filter((r) => after(r.event_date))) {
    const what = [r.round_type ?? "Funding round", fmtMoney(r.amount, r.currency)].filter(Boolean).join(", ");
    const s = r.sources[0];
    items.push({ text: `${what} on ${day(r.event_date)}`, source: s ? s.name : null, url: s?.url ?? null });
  }
  // only someone with a dated valid_since after the meeting is called "new"
  for (const i of snap.investors.filter((i) => after(i.valid_since))) {
    items.push({ text: `New investor: ${i.name} (since ${day(i.valid_since)})`, source: i.source?.name ?? null, url: i.source?.url ?? null });
  }
  if (snap.employee_count) {
    const was = first?.employee_count?.value;
    const delta = was != null && was !== snap.employee_count.value ? `${was} → ${snap.employee_count.value}` : String(snap.employee_count.value);
    const s = snap.employee_count.source;
    items.push({ text: `Headcount: ${delta}${s?.date ? ` (as of ${day(s.date)})` : ""}`, source: s?.name ?? null, url: s?.url ?? null });
  }
  return items.length ? { items } : null;
}
