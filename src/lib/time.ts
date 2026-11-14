// All user-facing times in Helsinki time (the demo is at Junction, Helsinki).
const TZ = "Europe/Helsinki";
const full = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const short = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dayKey = (d: Date) => d.toLocaleDateString("en-GB", { timeZone: TZ });

/** "14 Nov, 14:23:46" (Helsinki). Same day as now -> "14:23:46" unless alwaysDate. */
export function fmtTime(iso: string | null | undefined, opts: { alwaysDate?: boolean } = {}): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return !opts.alwaysDate && dayKey(new Date()) === dayKey(d) ? short.format(d) : full.format(d);
}

/** "3 min ago" */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}
