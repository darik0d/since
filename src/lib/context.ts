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

// Limits seen on this account: 500 concurrent requests, but fresh scrapes (maxAgeMs: 0) are capped at
// 10 per minute (429 RATE_LIMITED + retry-after). Keep a small concurrency and honor retry-after.
const MAX_CONCURRENT = Number(process.env.CONTEXT_MAX_CONCURRENT || 4);
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.CONTEXT_API_KEY;
  if (!key) throw new Error("CONTEXT_API_KEY is not set");
  let res!: Response;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await slot(() =>
      fetch(`${BASE}${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      }),
    );
    if (res.status !== 429 || attempt === 2) break;
    const wait = Math.min(40, Number(res.headers.get("retry-after")) || 2 + attempt * 3);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
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
    call<{ data: NewsItem[] }>(
      "POST",
      "/news/search",
      { searchBy: { type: "entity", entity: { type: "domain", domain } }, limit },
    ),
  scrapeMarkdown: (url: string) =>
    call<{ markdown?: { success: boolean; data: string } }>("POST", "/web/scrape", { url, formats: { markdown: true } }),
  scrape: (url: string, opts: { html?: boolean; fresh?: boolean } = {}) =>
    call<ScrapeResponse>("POST", "/web/scrape", {
      url,
      formats: { markdown: true, html: Boolean(opts.html) },
      // fresh = live page now (re-checks); otherwise accept a cache up to 10 min old
      maxAgeMs: opts.fresh ? 0 : 600_000,
    }),
  newsSearch: (query: string, limit = 10) =>
    call<{ data: NewsItem[] }>("POST", "/news/search", {
      searchBy: { type: "natural_language", query },
      limit,
    }),
};

export type NewsItem = {
  url: string;
  title: string;
  description?: string | null;
  published_at: string;
  source: { name: string; domain: string; direct?: boolean };
};

export type ScrapeResponse = {
  url: string;
  html?: { success: boolean; data: string | null };
  markdown?: { success: boolean; data: string | null };
  metadata?: { title?: string; description?: string; language?: string; canonicalUrl?: string };
  cache_metadata?: Record<string, unknown>;
};
