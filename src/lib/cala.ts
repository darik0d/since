import { one, query } from "./db";

// Cala (https://docs.cala.ai): verified, sourced company data. Server only. REST, header X-API-KEY.
// Every response is cached in cala_cache for 1 hour. Cala has no webhooks: a 30-minute poll of
// snapshots (plus "Check now") is its real-time part.
const BASE = "https://api.cala.ai/v1";
const TTL_MS = 60 * 60_000;

export const calaConfigured = () => Boolean(process.env.CALA_API_KEY);

async function cala<T>(method: "GET" | "POST", path: string, body?: unknown, opts: { fresh?: boolean } = {}): Promise<T> {
  if (!calaConfigured()) throw new Error("CALA_API_KEY is not set");
  const key = `${method} ${path} ${body ? JSON.stringify(body) : ""}`;
  if (!opts.fresh) {
    const hit = await one<{ json: T }>("SELECT json FROM cala_cache WHERE key = $1 AND fetched_at > now() - ($2 || ' milliseconds')::interval", [key, String(TTL_MS)]);
    if (hit) return hit.json;
  }
  const r = await fetch(BASE + path, {
    method,
    headers: { "X-API-KEY": process.env.CALA_API_KEY!, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Cala ${r.status}: ${j?.error?.message ?? JSON.stringify(j).slice(0, 200)}`);
  await query(
    "INSERT INTO cala_cache (key, json, fetched_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET json = EXCLUDED.json, fetched_at = now()",
    [key, JSON.stringify(j)],
  );
  return j as T;
}

type Src = { name: string; document: string; date: string };
type Prop<T> = { value: T; sources?: Src[] } | undefined;
type Rel = { id: string; name: string; entity_type: string; properties?: { sources?: Src[]; valid_since?: string; event_date?: string; role?: string } };
type Entity = {
  id: string; name: string; entity_type: string; description: string | null;
  properties: Record<string, Prop<any>>;
  relationships?: { outgoing?: Record<string, Rel[]>; incoming?: Record<string, Rel[]> };
};

export type CalaCandidate = { id: string; name: string; entity_type: string; description: string | null; website: string | null };

export async function searchEntities(name: string): Promise<CalaCandidate[]> {
  const r = await cala<{ entities: { id: string; name: string; entity_type: string; description: string | null }[] }>(
    "GET", `/entities?name=${encodeURIComponent(name.slice(0, 100))}&limit=5`,
  );
  const orgs = r.entities.filter((e) => e.entity_type === "Company" || e.entity_type === "Organization");
  return Promise.all(
    orgs.map(async (e) => {
      const d = await cala<Entity>("POST", `/entities/${e.id}`, { properties: ["website"] }).catch(() => null);
      return { ...e, website: (d?.properties?.website?.value as string | undefined) ?? null };
    }),
  );
}

const bareHost = (s: string) => s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];

/**
 * Entity match: auto-accept ONLY when Cala's website equals the startup's domain.
 * Never auto-pick by name alone (Fracttal has a parent and subsidiaries with the same name).
 */
export async function matchStartup(startupId: number): Promise<{ status: "matched" | "candidates" | "not_found"; entity_id?: string; candidates?: CalaCandidate[] }> {
  const s = await one<{ domain: string; name: string | null }>("SELECT domain, name FROM startups WHERE id = $1", [startupId]);
  if (!s) throw new Error("startup not found");
  const candidates = await searchEntities(s.name ?? s.domain.split(".")[0]);
  const hit = candidates.find((c) => c.website && bareHost(c.website) === bareHost(s.domain));
  if (hit) {
    await query("UPDATE startups SET cala_entity_id = $2, cala_match = 'auto' WHERE id = $1", [startupId, hit.id]);
    return { status: "matched", entity_id: hit.id, candidates };
  }
  if (!candidates.length) {
    await query("UPDATE startups SET cala_match = 'not_found' WHERE id = $1", [startupId]);
    return { status: "not_found", candidates };
  }
  return { status: "candidates", candidates };
}

// ---------- snapshots ----------

export type SourceRef = { name: string; url: string | null; date: string | null };
export type Snapshot = {
  entity_id: string;
  name: string;
  employee_count: { value: number; source: SourceRef | null } | null;
  rounds: { id: string; event_date: string | null; round_type: string | null; amount: number | null; currency: string | null; sources: SourceRef[] }[];
  investors: { name: string; valid_since: string | null; source: SourceRef | null }[];
  presence: string[];
  hq: string[];
  industry: string[];
};

const ref = (s?: Src[]): SourceRef | null => {
  const x = s?.find((y) => y.document) ?? s?.[0];
  return x ? { name: x.name, url: x.document || null, date: x.date || null } : null;
};

/** Normalized investor key: "Kayyak" == "Kayyak Ventures", "RIVERWOOD" == "RIVERWOOD CAPITAL LP". */
const invKey = (n: string) =>
  n.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(ventures?|capital|partners|management|lp|llc|ltd|inc|fund|vc|andaluc a|andalucia)\b/g, " ").replace(/\s+/g, " ").trim();

export async function fetchSnapshot(entityId: string, opts: { fresh?: boolean } = {}): Promise<Snapshot> {
  const e = await cala<Entity>(
    "POST",
    `/entities/${entityId}`,
    {
      properties: ["name", "website", "employee_count", "founding_date"],
      relationships: {
        outgoing: { PARTICIPATES_IN_CORPORATE_EVENT: { limit: 30 }, HAS_PRESENCE_IN: { limit: 30 }, HAS_HEADQUARTERS_IN: { limit: 5 }, OPERATES_IN_INDUSTRY: { limit: 5 } },
        incoming: { INVESTED_IN: { limit: 50 } },
      },
    },
    opts,
  );
  const out = e.relationships?.outgoing ?? {};
  const inc = e.relationships?.incoming ?? {};

  const rounds = await Promise.all(
    (out.PARTICIPATES_IN_CORPORATE_EVENT ?? [])
      .filter((r) => r.entity_type === "PrivateCompanyFundingRound" || r.entity_type === "FundingRound")
      .map(async (r) => {
        const d = await cala<Entity>("POST", `/entities/${r.id}`, { properties: ["round_type", "event_date", "transaction_value", "transaction_value_units"] }, opts).catch(() => null);
        const p = d?.properties ?? {};
        const srcs = [...(p.event_date?.sources ?? []), ...(r.properties?.sources ?? [])];
        const seen = new Set<string>();
        return {
          id: r.id,
          event_date: (p.event_date?.value as string | undefined) ?? r.properties?.event_date ?? null,
          round_type: (p.round_type?.value as string | undefined) ?? null,
          amount: typeof p.transaction_value?.value === "number" ? (p.transaction_value.value as number) : null,
          currency: (p.transaction_value_units?.value as string | undefined) ?? null,
          sources: srcs
            .map((s) => ({ name: s.name, url: s.document || null, date: s.date || null }))
            .filter((s) => (s.url ? !seen.has(s.url) && seen.add(s.url) : false)),
        };
      }),
  );

  // investors: dedupe near-duplicates, keep the earliest valid_since we know
  const inv = new Map<string, Snapshot["investors"][number]>();
  for (const r of inc.INVESTED_IN ?? []) {
    if (bareHost(r.name) === bareHost(e.name) || invKey(r.name) === invKey(e.name)) continue; // the company itself
    const k = invKey(r.name).split(" ")[0] || r.name.toLowerCase();
    const cur = inv.get(k);
    const vs = r.properties?.valid_since ?? null;
    if (!cur) inv.set(k, { name: r.name, valid_since: vs, source: ref(r.properties?.sources) });
    else {
      if (r.name.length > cur.name.length && !/[A-Z]{4,}/.test(r.name)) cur.name = r.name; // prefer the fuller, non-shouting name
      if (vs && (!cur.valid_since || vs < cur.valid_since)) { cur.valid_since = vs; cur.source = ref(r.properties?.sources) ?? cur.source; }
    }
  }

  const ec = e.properties.employee_count;
  return {
    entity_id: e.id,
    name: e.name,
    employee_count: typeof ec?.value === "number" ? { value: ec.value, source: ref(ec.sources) } : null,
    rounds: rounds.sort((a, b) => (b.event_date ?? "").localeCompare(a.event_date ?? "")),
    investors: [...inv.values()],
    presence: (out.HAS_PRESENCE_IN ?? []).map((r) => r.name),
    hq: (out.HAS_HEADQUARTERS_IN ?? []).map((r) => r.name),
    industry: (out.OPERATES_IN_INDUSTRY ?? []).map((r) => r.name),
  };
}

/** Fetch + store a snapshot; returns it with the previous one (for diffs). */
export async function takeSnapshot(startupId: number, opts: { fresh?: boolean } = {}) {
  const s = await one<{ cala_entity_id: string | null }>("SELECT cala_entity_id FROM startups WHERE id = $1", [startupId]);
  if (!s?.cala_entity_id) return null;
  const prev = await one<{ data_json: Snapshot }>("SELECT data_json FROM cala_snapshots WHERE startup_id = $1 ORDER BY fetched_at DESC LIMIT 1", [startupId]);
  const snap = await fetchSnapshot(s.cala_entity_id, opts);
  await query("INSERT INTO cala_snapshots (startup_id, entity_id, data_json) VALUES ($1,$2,$3)", [startupId, s.cala_entity_id, JSON.stringify(snap)]);
  const known = new Set((prev?.data_json.investors ?? []).map((i) => invKey(i.name).split(" ")[0]));
  const newInvestors = prev ? snap.investors.filter((i) => !known.has(invKey(i.name).split(" ")[0])) : [];
  return { snap, prev: prev?.data_json ?? null, newInvestors };
}

/** Latest stored snapshot (fetching one if none is stored yet). */
export async function latestSnapshot(startupId: number): Promise<{ snap: Snapshot; first: Snapshot | null } | null> {
  const s = await one<{ cala_entity_id: string | null }>("SELECT cala_entity_id FROM startups WHERE id = $1", [startupId]);
  if (!s?.cala_entity_id || !calaConfigured()) return null;
  let last = await one<{ data_json: Snapshot }>(
    "SELECT data_json FROM cala_snapshots WHERE startup_id = $1 AND entity_id = $2 ORDER BY fetched_at DESC LIMIT 1",
    [startupId, s.cala_entity_id],
  );
  if (!last) {
    const t = await takeSnapshot(startupId);
    if (!t) return null;
    last = { data_json: t.snap };
  }
  const first = await one<{ data_json: Snapshot }>(
    "SELECT data_json FROM cala_snapshots WHERE startup_id = $1 AND entity_id = $2 ORDER BY fetched_at ASC LIMIT 1",
    [startupId, s.cala_entity_id],
  );
  return { snap: last.data_json, first: first?.data_json ?? null };
}

export const fmtMoney = (amount: number | null, currency: string | null) => {
  if (amount == null) return null;
  const v = amount >= 1e6 ? `${(amount / 1e6).toFixed(amount >= 1e7 ? 0 : 1)}M` : amount >= 1e3 ? `${Math.round(amount / 1e3)}K` : String(amount);
  return `~${v} ${currency ?? ""}`.trim();
};
