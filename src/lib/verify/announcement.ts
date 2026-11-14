import { context, type NewsItem } from "../context";
import { llmJson, nullable } from "../llm";
import { discoverSite, getPage, hostOf, sameSite, sha256, now, type Page } from "../sources";
import type { CheckContext, CheckResult, EvidenceCandidate, SourceChecked, SourceType } from "../types";
import { statusFrom } from "./status";

// announcement: founder channels (blog / newsroom / customers page) + independent news.
// The LLM only EXTRACTS claims (who / how much) with a verbatim quote; code checks the quote exists
// in the source text and applies the threshold rule. Revenue/retention never exceed "reported".

type Snippet = { id: string; url: string; source_type: SourceType; text: string; snapshot_time: string; title?: string };

const KEYWORDS: Record<string, RegExp> = {
  customer: /(customer|client|partner|selects?|chose|chooses|signs?|signed|deploy|rolls? out|adopt|welcome|contract|agreement|pilot|enterprise)/i,
  revenue: /(ARR|MRR|revenue|run[- ]rate|turnover|liikevaihto|Umsatz|€|\$|£|million|\bM\b|\bk\b|\d ?m\b)/i,
  retention: /(retention|NRR|GRR|net revenue|churn|net dollar)/i,
};

const CLAIMS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["claims"],
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["snippet_id", "kind", "customer_name", "customer_is_enterprise", "enterprise_hint", "amount", "currency", "metric", "quote"],
        properties: {
          snippet_id: { type: "string" },
          kind: { type: "string", enum: ["customer", "revenue", "retention"] },
          customer_name: nullable("string"),
          customer_is_enterprise: nullable("boolean"),
          enterprise_hint: nullable("string"),
          amount: nullable("number"),
          currency: nullable("string"),
          metric: nullable({ type: "string", enum: ["ARR", "MRR", "revenue", "NRR", "GRR", "retention"] }),
          quote: { type: "string" },
        },
      },
    },
  },
};

type Claim = {
  snippet_id: string;
  kind: "customer" | "revenue" | "retention";
  customer_name: string | null;
  customer_is_enterprise: boolean | null;
  enterprise_hint: string | null;
  amount: number | null;
  currency: string | null;
  metric: string | null;
  quote: string;
};

const PRESS_WIRES = /(prnewswire|globenewswire|businesswire|accesswire|einpresswire|newswire|cision|mynewsdesk|presseportal|marketscreener|stocktitan|newsfilecorp|openpr|pressat)\./i;

// Fixed, documented approximation (only used when currencies differ; the rule text says so).
const EUR_PER: Record<string, number> = { EUR: 1, USD: 0.92, GBP: 1.17, SEK: 0.087, NOK: 0.085, DKK: 0.134, CHF: 1.05 };

function paragraphs(md: string): string[] {
  return md
    .split(/\n{2,}/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 30 && s.length < 1500);
}

const norm = (s: string) => s.toLowerCase().replace(/[\s ]+/g, " ").replace(/[“”"’']/g, "").trim();

export async function checkAnnouncement(ctx: CheckContext): Promise<CheckResult> {
  const subtype = ctx.subtype ?? "customer";
  const p = ctx.params;
  const site = await discoverSite(ctx.domain, { fresh: ctx.fresh });
  const sources: SourceChecked[] = [];

  // founder-controlled channels
  const founderUrls = [...new Set([...site.blog, ...(subtype === "customer" ? site.customers : [])])].slice(0, 4);
  const pages: Page[] = await Promise.all(founderUrls.map((u) => getPage(u, { fresh: ctx.fresh })));
  for (const pg of pages) sources.push({ url: pg.url, source_type: "founder_controlled", ok: pg.ok, note: pg.ok ? "scraped" : pg.error ?? "failed" });
  if (!founderUrls.length) sources.push({ url: site.home.url, source_type: "founder_controlled", ok: site.home.ok, note: "no blog/newsroom link found; homepage only" });

  // independent news (Context.dev news search)
  let news: NewsItem[] = [];
  try {
    // natural-language queries (no boolean syntax)
    const q = subtype === "customer" ? `${ctx.company} customer` : subtype === "revenue" ? `${ctx.company} revenue ARR` : `${ctx.company} net revenue retention`;
    const [byDomain, byQuery] = await Promise.all([
      context.newsByDomain(ctx.domain, 10).catch(() => ({ data: [] as NewsItem[] })),
      context.newsSearch(q, 10).catch(() => ({ data: [] as NewsItem[] })),
    ]);
    const seen = new Set<string>();
    news = [...byDomain.data, ...byQuery.data].filter((n) => !seen.has(n.url) && seen.add(n.url));
    sources.push({ url: `news: ${ctx.domain} / ${q}`, source_type: "independent", ok: true, note: `${news.length} articles` });
  } catch (e) {
    sources.push({ url: `news: ${ctx.domain}`, source_type: "independent", ok: false, note: String(e) });
  }

  const kw = KEYWORDS[subtype];
  const companyRe = new RegExp(ctx.company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const snippets: Snippet[] = [];
  for (const pg of [...pages.filter((x) => x.ok), ...(founderUrls.length ? [] : [site.home])]) {
    paragraphs(pg.markdown)
      .filter((t) => kw.test(t))
      .slice(0, 25)
      .forEach((t, i) => snippets.push({ id: `f${snippets.length}_${i}`, url: pg.url, source_type: "founder_controlled", text: t, snapshot_time: pg.snapshot_time }));
  }
  for (const n of news.slice(0, 20)) {
    const text = `${n.title}. ${n.description ?? ""}`.trim();
    if (!companyRe.test(text) && !sameSite(n.url, ctx.domain)) continue; // must be about this company
    // press-release wires are paid distribution of the company's own text: founder-controlled, not independent
    const st: SourceType =
      sameSite(n.url, ctx.domain) || hostOf(n.url).includes(ctx.domain.split(".")[0]) || PRESS_WIRES.test(hostOf(n.url))
        ? "founder_controlled"
        : "independent";
    snippets.push({ id: `n${snippets.length}`, url: n.url, source_type: st, text, snapshot_time: n.published_at || now(), title: n.title });
  }

  const obs: Record<string, unknown> = { founder_pages: founderUrls, news_articles: news.length, snippets: snippets.length };
  if (!snippets.length) {
    return { status: "watching", summary: `No ${subtype} announcement found yet`, evidence: [], sources, observations: obs };
  }

  const claims = await extractClaims(ctx.company, subtype, snippets.slice(0, 60));
  const byId = new Map(snippets.map((s) => [s.id, s]));
  const evidence: EvidenceCandidate[] = [];
  let ambiguous = 0;

  for (const c of claims) {
    const sn = byId.get(c.snippet_id);
    if (!sn || c.kind !== subtype) continue;
    if (!c.quote || !norm(sn.text).includes(norm(c.quote))) continue; // quote must be verbatim: drops hallucinations
    const rule = applyRule(subtype, c, p);
    if (rule === "ambiguous") ambiguous++;
    evidence.push({
      url: sn.url,
      source_type: sn.source_type,
      excerpt: c.quote.slice(0, 400),
      snapshot_time: sn.snapshot_time,
      content_hash: sha256(`${sn.url}:${norm(c.quote)}`),
      rule_passed: typeof rule === "string" && rule !== "ambiguous" ? rule : null,
      passes: typeof rule === "string" && rule !== "ambiguous",
      details: { claim: c, title: sn.title ?? null },
    });
  }

  let passing = evidence.filter((e) => e.passes);
  if (subtype === "customer") {
    // need >= min_customers distinct named customers
    const names = new Set(passing.map((e) => norm((e.details as { claim: Claim }).claim.customer_name ?? "")));
    if (names.size < (p.min_customers ?? 1)) passing = [];
  }
  const cap = subtype === "customer" ? "confirmed" : "reported";
  let status: CheckResult["status"] = statusFrom(passing, cap);
  if (status === "watching" && ambiguous > 0) status = "needs_review";

  obs.claims = claims.length;
  const first = passing[0]?.details as { claim: Claim } | undefined;
  const summary =
    status === "watching"
      ? `No ${subtype} claim meets the bar yet (${claims.length} related mentions)`
      : status === "needs_review"
        ? `Found ${subtype} mentions that need a human look`
        : subtype === "customer"
          ? `${first?.claim.customer_name} named as customer (${passing.some((e) => e.source_type === "independent") ? "independent source" : "founder channel"})`
          : `${first?.claim.metric ?? subtype} ${first?.claim.amount ?? ""} ${first?.claim.currency ?? ""} reported`;
  return { status, summary, evidence, sources, observations: obs };
}

function applyRule(subtype: string, c: Claim, p: CheckContext["params"]): string | "ambiguous" | false {
  if (subtype === "customer") {
    if (!c.customer_name) return false;
    if ((p.customer_kind ?? "any") === "enterprise") {
      if (c.customer_is_enterprise === true) return `named enterprise customer: ${c.customer_name}${c.enterprise_hint ? ` (${c.enterprise_hint})` : ""}`;
      if (c.customer_is_enterprise === null) return "ambiguous";
      return false;
    }
    return `named customer: ${c.customer_name}`;
  }
  if (subtype === "revenue") {
    if (c.amount == null || !p.threshold) return c.amount == null ? false : "ambiguous";
    const annual = c.metric === "MRR" ? c.amount * 12 : c.amount;
    const want = (p.threshold_currency ?? "EUR").toUpperCase();
    const have = (c.currency ?? "").toUpperCase();
    if (!have) return "ambiguous";
    if (have === want) return annual >= p.threshold ? `${c.metric ?? "revenue"} ${fmt(annual)} ${have} ≥ ${fmt(p.threshold)} ${want}` : false;
    if (!EUR_PER[have] || !EUR_PER[want]) return "ambiguous";
    const conv = (annual * EUR_PER[have]) / EUR_PER[want];
    return conv >= p.threshold ? `${c.metric ?? "revenue"} ${fmt(annual)} ${have} ≈ ${fmt(conv)} ${want} ≥ ${fmt(p.threshold)} (fixed FX)` : false;
  }
  if (subtype === "retention") {
    if (c.amount == null || !p.threshold) return false;
    return c.amount >= p.threshold ? `${c.metric ?? "retention"} ${c.amount}% ≥ ${p.threshold}%` : false;
  }
  return false;
}

const fmt = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(n));

async function extractClaims(company: string, subtype: string, snippets: Snippet[]): Promise<Claim[]> {
  const out = await llmJson<{ claims: Claim[] }>({
    name: "claims",
    schema: CLAIMS_SCHEMA,
    system: `You extract factual claims about the startup "${company}" from text snippets. Only extract claims of kind "${subtype}".
- customer: "${company}" gained a specific, named customer (or the customer announced choosing ${company}). customer_name = the customer organisation.
  customer_is_enterprise: true only if the text says enterprise / large corporation / a well-known large company / Fortune / publicly listed; false if clearly a small business; null if unclear.
  enterprise_hint: the words that justify it, else null. Do NOT extract investors, partners that are not buyers, or ${company} itself.
- revenue: a revenue / ARR / MRR figure for ${company}. amount = full number (1.2M -> 1200000), currency = ISO code, metric.
- retention: NRR / GRR / retention percent for ${company}. amount = percent number.
quote: copy the exact sentence from the snippet that states the claim (verbatim, no edits). If nothing qualifies, return an empty list.`,
    user: snippets.map((s) => `[${s.id}] (${s.url})\n${s.text}`).join("\n\n"),
  });
  return out.claims;
}
