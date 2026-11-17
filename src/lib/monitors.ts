import { publicBase } from "./env";
import { context, type CreateMonitorInput } from "./context";
import { one, query } from "./db";
import type { SiteMap } from "./sources";
import type { DraftCondition, SourceType } from "./types";

// Monitors are TRIGGERS only: when one fires, Since re-runs the deterministic verifier.
// "core" monitors are created whenever there is budget; "extra" ones (e.g. LinkedIn search)
// only once the account has room (the free plan allows 10).

export type PlannedMonitor = {
  role: string;
  source_type: SourceType;
  priority: "core" | "extra";
  input: Omit<CreateMonitorInput, "webhook" | "schedule">;
};

export const DAILY_MINUTES = 1440;
export const PRIORITY_MINUTES = 360;
export const MAX_PRIORITY = 3;

/** Priority on/off: re-schedule the startup's Context.dev monitors (6 h vs daily). */
export async function setPriority(startupId: number, on: boolean) {
  const interval = on ? PRIORITY_MINUTES : DAILY_MINUTES;
  await query("UPDATE startups SET priority = $2 WHERE id = $1", [startupId, on]);
  const mons = await query<{ id: string }>("SELECT m.id FROM monitors m JOIN conditions c ON c.id = m.condition_id WHERE c.startup_id = $1", [startupId]);
  const failed: string[] = [];
  for (const m of mons) {
    try {
      await context.updateMonitor(m.id, { schedule: { type: "interval", frequency: interval, unit: "minutes" } } as never);
      await query("UPDATE monitors SET interval_minutes = $2 WHERE id = $1", [m.id, interval]);
    } catch (e) {
      failed.push(`${m.id}: ${(e as Error).message}`);
    }
  }
  return { monitors: mons.length, failed };
}

export function planMonitors(c: DraftCondition, company: string, site: SiteMap): PlannedMonitor[] {
  const d = site.domain;
  const tag = [`since`, `since:${d}`];
  const out: PlannedMonitor[] = [];
  const name = (role: string) => `since ${d} · ${role}`.slice(0, 120);
  switch (c.mechanism) {
    case "market_launch": {
      out.push({
        role: "site declarations (languages, currencies, countries)",
        source_type: "platform",
        priority: "core",
        input: {
          name: name("market declarations"),
          target: {
            type: "extract",
            url: `https://${d}`,
            instructions: `Languages the site is offered in (language switcher, hreflang), currencies shown on pricing, and countries listed as available. Focus on ${c.params.country ?? "new markets"}.`,
            schema: {
              type: "object",
              properties: {
                languages: { type: "array", items: { type: "string" } },
                currencies: { type: "array", items: { type: "string" } },
                countries_available: { type: "array", items: { type: "string" } },
              },
            },
            max_pages: 3,
          },
          change_detection: { type: "semantic", confidence_threshold: 0.75 },
          tags: tag,
        },
      });
      break;
    }
    case "hiring_push": {
      const board = site.jobBoards[0]?.url ?? site.careers[0] ?? `https://${d}/careers`;
      out.push({
        role: "job board / careers page",
        source_type: site.jobBoards.length ? "platform" : "founder_controlled",
        priority: "core",
        input: { name: name("open roles"), target: { type: "page", url: board, instructions: "Report new or removed job postings." }, change_detection: { type: "exact" }, tags: tag },
      });
      out.push({
        role: "indexed LinkedIn job posts",
        source_type: "independent",
        priority: "extra",
        input: { name: name("linkedin jobs"), target: { type: "search", query: `site:linkedin.com/jobs "${company}"`, instructions: `New job postings by ${company}.` }, tags: tag },
      });
      break;
    }
    case "announcement": {
      const blog = site.blog[0] ?? (c.subtype === "customer" ? site.customers[0] : undefined) ?? `https://${d}`;
      out.push({
        role: "founder blog / newsroom",
        source_type: "founder_controlled",
        priority: "core",
        input: {
          name: name(`${c.subtype} announcements`),
          target: { type: "page", url: blog, instructions: `Report new posts, especially about ${c.subtype === "customer" ? "new customers" : c.subtype}.` },
          change_detection: { type: "exact" },
          tags: tag,
        },
      });
      const q =
        c.subtype === "customer" ? `"${company}" customer OR selects OR partnership` : c.subtype === "revenue" ? `"${company}" ARR OR revenue` : `"${company}" retention`;
      out.push({
        role: "web search (independent coverage)",
        source_type: "independent",
        priority: "core",
        input: { name: name(`${c.subtype} coverage`), target: { type: "search", query: q, instructions: `New articles or posts about ${company}: ${c.plain_words}.` }, tags: tag },
      });
      out.push({
        role: "indexed LinkedIn / X posts",
        source_type: "founder_controlled",
        priority: "extra",
        input: { name: name(`${c.subtype} social`), target: { type: "search", query: `(site:linkedin.com/posts OR site:x.com) "${company}"`, instructions: `Posts announcing ${c.plain_words}.` }, tags: tag },
      });
      break;
    }
    case "product_shipped": {
      if (c.params.github_repo) {
        out.push({
          role: "GitHub releases",
          source_type: "platform",
          priority: "core",
          input: { name: name("releases"), target: { type: "page", url: `https://github.com/${c.params.github_repo}/releases`, instructions: "Report new releases." }, change_detection: { type: "exact" }, tags: tag },
        });
      }
      for (const u of [c.params.app_store_url, c.params.play_store_url].filter(Boolean) as string[]) {
        out.push({ role: "store listing", source_type: "platform", priority: "core", input: { name: name("store listing"), target: { type: "page", url: u }, change_detection: { type: "exact" }, tags: tag } });
      }
      break;
    }
  }
  return out;
}

/** Monitors only make sense with a public HTTPS webhook target. */
export function monitorsEnabled(): { ok: boolean; why?: string } {
  const base = publicBase();
  if (process.env.MONITORS_DISABLED === "true") return { ok: false, why: "MONITORS_DISABLED=true" };
  if (!base.startsWith("https://")) return { ok: false, why: "PUBLIC_BASE_URL is not https (local dev): monitors not created" };
  return { ok: true };
}

export async function createMonitors(conditionId: number, domain: string, planned: PlannedMonitor[]) {
  const en = monitorsEnabled();
  if (!en.ok) return { created: [] as string[], skipped: planned.length, why: en.why };

  const lim = await context.monitorLimits();
  let free = lim.monitors_limit - lim.monitors_used;
  const roomy = lim.monitors_limit > 20;
  const created: string[] = [];
  const errors: string[] = [];
  // cost control: daily by default, every 6 h for priority watches; "extra" monitors only for the owner
  const own = await one<{ user_id: number; priority: boolean }>(
    "SELECT s.user_id, s.priority FROM conditions c JOIN startups s ON s.id = c.startup_id WHERE c.id = $1",
    [conditionId],
  );
  const interval = own?.priority ? PRIORITY_MINUTES : DAILY_MINUTES;
  for (const m of planned) {
    if (m.priority === "extra" && (!roomy || own?.user_id !== 1)) continue;
    if (free <= 0) break;
    // Context.dev: page-target instructions need semantic detection. Founder pages use exact detection
    // (any change -> Since re-checks with its own rules), so instructions are dropped there.
    const target =
      m.input.target.type === "page" && m.input.change_detection?.type !== "semantic"
        ? (({ instructions: _drop, ...t }) => t)(m.input.target)
        : m.input.target;
    try {
      const mon = await context.createMonitor({
        ...m.input,
        target,
        schedule: { type: "interval", frequency: interval, unit: "minutes" },
        webhook: { url: `${publicBase()}/api/webhooks/context`, events: ["change.detected"], retry: {} },
      });
      await query(
        `INSERT INTO monitors (id, condition_id, target_type, target_json, source_type, webhook_secret, name, role, interval_minutes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [mon.id, conditionId, m.input.target.type, JSON.stringify(m.input.target), m.source_type, mon.webhook?.secret ?? null, m.input.name, m.role, interval],
      );
      created.push(mon.id);
      free--;
    } catch (e) {
      errors.push(`${m.role}: ${(e as Error).message}`);
    }
  }
  const skipped = planned.length - created.length;
  if (errors.length) console.error("[since] monitor create:", errors.join("; "));
  return { created, skipped, why: errors.length ? errors.join("; ") : skipped ? `monitor budget: ${lim.monitors_used}/${lim.monitors_limit} used` : undefined };
}
