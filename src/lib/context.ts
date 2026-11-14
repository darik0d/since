// Minimal Context.dev REST client (server-side only).
// Docs: https://docs.context.dev  Base: https://api.context.dev/v1

const BASE = process.env.CONTEXT_API_BASE || "https://api.context.dev/v1";

export class ContextApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    public path: string,
  ) {
    super(`Context.dev ${path} -> ${status}`);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.CONTEXT_API_KEY;
  if (!key) throw new Error("CONTEXT_API_KEY is not set");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new ContextApiError(res.status, json, path);
  return json as T;
}

export type MonitorTarget =
  | { type: "page"; url: string; instructions?: string; include_selectors?: string[]; exclude_selectors?: string[] }
  | { type: "sitemap"; url: string; include?: string[]; exclude?: string[]; max_urls?: number }
  | { type: "extract"; url: string; instructions: string; schema?: unknown; max_pages?: number; max_depth?: number }
  | { type: "search"; query: string; instructions?: string };

export type CreateMonitorInput = {
  name: string;
  target: MonitorTarget;
  change_detection?: { type: "exact" } | { type: "semantic"; confidence_threshold?: number };
  schedule?: { type: "interval"; frequency: number; unit: "minutes" | "hours" | "days" };
  webhook?: { url: string; events?: ("change.detected" | "run.completed")[]; retry?: unknown };
  tags?: string[];
};

export type Monitor = {
  id: string;
  name: string;
  target: MonitorTarget;
  status: "active" | "paused" | "failed";
  webhook?: { url: string; secret?: string; events?: string[] };
  last_run_at?: string | null;
  last_change_at?: string | null;
  next_run_at?: string | null;
  initial_run_id?: string;
};

export const context = {
  usage: () => call<{ credits_remaining: number }>("GET", "/org/usage"),
  monitorLimits: () => call<{ monitors_used: number; monitors_limit: number; plan: string }>("GET", "/monitors/limits"),
  listMonitors: (limit = 100) => call<{ data: Monitor[]; has_more: boolean }>("GET", `/monitors?limit=${limit}`),
  createMonitor: (input: CreateMonitorInput) => call<Monitor>("POST", "/monitors", { mode: "web", ...input }),
  runMonitorNow: (id: string) =>
    call<{ monitor_id: string; run_id: string; queued: boolean }>("POST", `/monitors/${encodeURIComponent(id)}/run`),
  deleteMonitor: (id: string) => call<{ id: string; deleted: boolean }>("DELETE", `/monitors/${encodeURIComponent(id)}`),
  brand: (domain: string) =>
    call<{ brand: { domain: string; title?: string; logos?: { url: string; mode?: string; type?: string }[] } }>(
      "POST",
      "/brand/retrieve",
      { type: "by_domain", domain },
    ),
  newsByDomain: (domain: string, limit = 10) =>
    call<{ data: { url: string; title: string; published_at: string; source: { name: string; domain: string } }[] }>(
      "POST",
      "/news/search",
      { searchBy: { type: "entity", entity: { type: "domain", domain } }, sortBy: "newest", limit },
    ),
  scrapeMarkdown: (url: string) =>
    call<{ markdown?: { success: boolean; data: string } }>("POST", "/web/scrape", { url, formats: { markdown: true } }),
};
