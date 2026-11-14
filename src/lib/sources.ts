import { createHash } from "node:crypto";
import { context } from "./context";

export type Page = {
  url: string;
  ok: boolean;
  html: string;
  markdown: string;
  title: string;
  lang: string | null;
  snapshot_time: string;
  content_hash: string;
  error?: string;
};

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const now = () => new Date().toISOString();

// Several conditions of one startup read the same pages: share a scrape for 90 s (even "fresh" ones),
// which also keeps us under Context.dev's 10 fresh scrapes / minute.
const pageCache = new Map<string, { at: number; p: Promise<Page> }>();

/** Scrape one page through Context.dev. Never throws: failures come back as ok=false. */
export function getPage(url: string, opts: { html?: boolean; fresh?: boolean } = {}): Promise<Page> {
  const key = `${url}|${opts.html ? "h" : "m"}`;
  const hit = pageCache.get(key) ?? (opts.html ? undefined : pageCache.get(`${url}|h`));
  if (hit && Date.now() - hit.at < (opts.fresh ? 15_000 : 90_000)) return hit.p; // fresh: only share within one check run
  const p = fetchPage(url, opts).then((pg) => {
    if (!pg.ok) pageCache.delete(key); // don't cache failures
    return pg;
  });
  pageCache.set(key, { at: Date.now(), p });
  return p;
}

async function fetchPage(url: string, opts: { html?: boolean; fresh?: boolean }): Promise<Page> {
  const snapshot_time = now();
  try {
    const r = await context.scrape(url, opts);
    const markdown = r.markdown?.data ?? "";
    const html = r.html?.data ?? "";
    return {
      url,
      ok: Boolean(markdown || html),
      html,
      markdown,
      title: r.metadata?.title ?? "",
      lang: r.metadata?.language ?? null,
      snapshot_time,
      content_hash: sha256(markdown || html),
    };
  } catch (e) {
    return { url, ok: false, html: "", markdown: "", title: "", lang: null, snapshot_time, content_hash: "", error: String((e as Error).message ?? e) };
  }
}

/** text = all text inside the <a>; first = the first text chunk (e.g. the job title before team/location spans) */
export type Link = { href: string; text: string; first: string };

export function extractLinks(html: string, base: string): Link[] {
  const out: Link[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*?href\s*=\s*["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let href: string;
    try {
      href = new URL(m[1].replace(/&amp;/g, "&"), base).toString();
    } catch {
      continue;
    }
    if (!/^https?:/.test(href) || seen.has(href)) continue;
    seen.add(href);
    const chunks = m[2].split(/<[^>]+>/).map((t) => decodeEntities(t).replace(/\s+/g, " ").trim()).filter(Boolean);
    out.push({ href, text: stripTags(m[2]).slice(0, 160), first: (chunks[0] ?? "").slice(0, 160) });
  }
  return out;
}

export const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

export const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Same registrable site: nordwind.io, www.nordwind.io, blog.nordwind.io. */
export const sameSite = (u: string, domain: string) => {
  const h = hostOf(u);
  return h === domain || h.endsWith("." + domain);
};

export const JOB_BOARDS: { kind: string; re: RegExp }[] = [
  { kind: "greenhouse", re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([\w-]+)/i },
  { kind: "lever", re: /jobs(?:\.eu)?\.lever\.co\/([\w-]+)/i },
  { kind: "ashby", re: /jobs\.ashbyhq\.com\/([\w.-]+)/i },
  { kind: "workable", re: /apply\.workable\.com\/([\w-]+)/i },
  { kind: "personio", re: /([\w-]+)\.jobs\.personio\.(?:de|com)/i },
  { kind: "teamtailor", re: /([\w-]+)\.teamtailor\.com/i },
];

export type SiteMap = {
  domain: string;
  home: Page;
  links: Link[];
  pricing: string[];
  careers: string[];
  blog: string[];
  customers: string[];
  jobBoards: { kind: string; token: string; url: string }[];
  github: string[];
};

const KIND_PATTERNS: Record<"pricing" | "careers" | "blog" | "customers", { path: RegExp; text: RegExp }> = {
  pricing: { path: /\/(pricing|plans|prices|preise|tarifs)(\/|$)/i, text: /^(pricing|plans|prices)$/i },
  careers: { path: /\/(careers?|jobs|join(-us)?|work-with-us|open-positions|hiring)(\/|$)/i, text: /^(careers?|jobs|we'?re hiring|join (us|the team))$/i },
  blog: { path: /\/(blog|news|newsroom|press|updates|stories|announcements|insights)(\/|$)/i, text: /^(blog|news|newsroom|press|updates)$/i },
  customers: { path: /\/(customers?|case-stud(y|ies)|clients|success-stories)(\/|$)/i, text: /^(customers|case studies|clients)$/i },
};

const siteCache = new Map<string, { at: number; map: SiteMap }>();

/** Scrape the homepage once and classify its links. Cached 5 min per domain (parse + start share it). */
export async function discoverSite(domain: string, opts: { fresh?: boolean } = {}): Promise<SiteMap> {
  const hit = siteCache.get(domain);
  if (hit && !opts.fresh && Date.now() - hit.at < 300_000) return hit.map;

  const home = await getPage(`https://${domain}`, { html: true, fresh: opts.fresh });
  const links = home.ok ? extractLinks(home.html, `https://${domain}/`) : [];
  const pick = (k: keyof typeof KIND_PATTERNS) => {
    const { path, text } = KIND_PATTERNS[k];
    const urls = links
      .filter((l) => sameSite(l.href, domain) && (path.test(new URL(l.href).pathname) || text.test(l.text)))
      .map((l) => l.href.replace(/\/$/, ""));
    // shortest paths first: the index page, not a single post
    return [...new Set(urls)].sort((a, b) => a.length - b.length).slice(0, 3);
  };

  const jobBoards: SiteMap["jobBoards"] = [];
  for (const l of links) {
    for (const b of JOB_BOARDS) {
      const m = l.href.match(b.re);
      if (m && !jobBoards.some((j) => j.kind === b.kind && j.token === m[1])) jobBoards.push({ kind: b.kind, token: m[1], url: l.href });
    }
  }

  const map: SiteMap = {
    domain,
    home,
    links,
    pricing: pick("pricing"),
    careers: pick("careers"),
    blog: pick("blog"),
    customers: pick("customers"),
    jobBoards,
    github: [...new Set(links.map((l) => l.href.match(/github\.com\/([\w.-]+\/[\w.-]+)/i)?.[1]).filter(Boolean) as string[])].slice(0, 5),
  };
  siteCache.set(domain, { at: Date.now(), map });
  return map;
}

/** Short excerpt around the first match of a regex. */
export function around(text: string, re: RegExp, radius = 160): string {
  const m = re.exec(text);
  if (!m) return "";
  const start = Math.max(0, m.index - radius);
  return (start > 0 ? "…" : "") + text.slice(start, m.index + m[0].length + radius).replace(/\s+/g, " ").trim() + "…";
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
