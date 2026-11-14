import { around, discoverSite, escapeRe, getPage, hostOf, now, sha256 } from "../sources";
import type { CheckContext, CheckResult, EvidenceCandidate, MarketSignal, SourceChecked } from "../types";
import { statusFrom } from "./status";

// market_launch: what the site DECLARES (language offered, prices in the currency, country listed
// as available) + whether the country domain exists and belongs to the company. All rules are code.

const CCTLD: Record<string, string> = { GB: "uk" };

function currencySymbols(code: string): string[] {
  const out = new Set<string>();
  for (const loc of ["en", "de", "fr", "sv", "fi", "pl", "ja"]) {
    try {
      const part = new Intl.NumberFormat(loc, { style: "currency", currency: code }).formatToParts(1).find((p) => p.type === "currency");
      if (part && !/^[A-Z]{3}$/.test(part.value)) out.add(part.value.trim());
    } catch {}
  }
  // "$" / "kr" / "¥" are shared by several currencies: they count only for their main one
  const main: Record<string, string> = { $: "USD", "£": "GBP", "¥": "JPY" };
  return [...out].filter((s) => (s in main ? main[s] === code : !["kr", "kr."].includes(s)));
}

function languageNames(code: string): string[] {
  const names = new Set<string>();
  for (const loc of [code, "en"]) {
    try {
      const n = new Intl.DisplayNames([loc], { type: "language" }).of(code);
      if (n && n.toLowerCase() !== code) names.add(n);
    } catch {}
  }
  return [...names];
}

function countryNames(code: string, lang: string | null, fallback: string | null): string[] {
  const names = new Set<string>();
  if (fallback) names.add(fallback);
  for (const loc of ["en", lang ?? "en"]) {
    try {
      const n = new Intl.DisplayNames([loc], { type: "region" }).of(code);
      if (n && n !== code) names.add(n);
    } catch {}
  }
  return [...names];
}

export async function checkMarket(ctx: CheckContext): Promise<CheckResult> {
  const p = ctx.params;
  const cc = (p.country_code ?? "").toUpperCase();
  const lang = (p.language_code ?? "").toLowerCase() || null;
  const cur = (p.currency ?? "").toUpperCase() || null;
  const accept = new Set<MarketSignal>(p.accept?.length ? p.accept : ["language", "currency", "country_listed", "country_domain"]);
  const site = await discoverSite(ctx.domain, { fresh: ctx.fresh });
  const sources: SourceChecked[] = [];
  const evidence: EvidenceCandidate[] = [];
  const obs: Record<string, unknown> = {};

  sources.push({ url: site.home.url, source_type: "platform", ok: site.home.ok, note: site.home.ok ? "homepage scraped" : site.home.error ?? "failed" });

  // 1) language: <html lang>, hreflang alternates, a language-switcher link named in that language
  if (lang) {
    const html = site.home.html;
    const htmlLang = html.match(/<html[^>]*\blang=["']?([\w-]+)/i)?.[1]?.toLowerCase() ?? null;
    const hreflangs = [...html.matchAll(/<link[^>]+hreflang=["']?([\w-]+)["']?[^>]*>/gi)].map((m) => ({ tag: m[0], code: m[1].toLowerCase() }));
    const hrefOf = (tag: string) => tag.match(/href=["']([^"']+)/i)?.[1] ?? null;
    const hrefMatch = hreflangs.find((h) => h.code === lang || h.code.startsWith(lang + "-"));
    const names = languageNames(lang);
    const switcher = site.links.find((l) => names.some((n) => l.text.toLowerCase() === n.toLowerCase()));
    obs.languages = { html_lang: htmlLang, hreflang: [...new Set(hreflangs.map((h) => h.code))].slice(0, 40) };
    const hit = htmlLang?.startsWith(lang)
      ? { rule: `homepage <html lang="${htmlLang}">`, url: site.home.url, excerpt: `<html lang="${htmlLang}">` }
      : hrefMatch
        ? { rule: `site offers ${lang} (hreflang="${hrefMatch.code}")`, url: hrefOf(hrefMatch.tag) ?? site.home.url, excerpt: hrefMatch.tag.slice(0, 200) }
        : switcher
          ? { rule: `language switcher links to "${switcher.text}"`, url: switcher.href, excerpt: `Link "${switcher.text}" → ${switcher.href}` }
          : null;
    if (hit) {
      evidence.push({
        url: hit.url, source_type: "platform", excerpt: hit.excerpt, snapshot_time: site.home.snapshot_time,
        content_hash: sha256(`lang:${lang}:${hit.rule.toLowerCase()}`), rule_passed: accept.has("language") ? hit.rule : null,
        passes: accept.has("language"), details: { signal: "language" },
      });
    }
  }

  // 2) currency on the pricing page(s) — ISO code or an unambiguous symbol next to a number
  const pricingUrls = site.pricing.length ? site.pricing.slice(0, 2) : [`https://${ctx.domain}/pricing`];
  const pricingPages = await Promise.all(pricingUrls.map((u) => getPage(u, { fresh: ctx.fresh })));
  for (const pg of pricingPages) sources.push({ url: pg.url, source_type: "platform", ok: pg.ok, note: pg.ok ? "pricing page scraped" : "no pricing page" });
  if (cur) {
    const syms = currencySymbols(cur);
    const re = new RegExp(
      [`\\b${cur}\\b`, ...syms.map((s) => `${escapeRe(s)}\\s?\\d|\\d[\\d.,]*\\s?${escapeRe(s)}`)].join("|"),
    );
    obs.currency_checked = { currency: cur, symbols: syms, pages: pricingPages.filter((p) => p.ok).map((p) => p.url) };
    for (const pg of pricingPages.filter((p) => p.ok)) {
      const ex = around(pg.markdown, re);
      if (ex) {
        evidence.push({
          url: pg.url, source_type: "platform", excerpt: ex, snapshot_time: pg.snapshot_time, content_hash: sha256(`cur:${pg.url}:${cur}`),
          rule_passed: accept.has("currency") ? `pricing page shows prices in ${cur}` : null, passes: accept.has("currency"), details: { signal: "currency" },
        });
        break;
      }
    }
  }

  // 3) country listed as available (sentence with the country name + an availability word)
  if (cc) {
    const names = countryNames(cc, lang, p.country ?? null);
    const pages = [site.home, ...pricingPages].filter((x) => x.ok);
    const avail = /(available|availability|launch|live in|now in|markets?|countries|operat|serv(e|ing)|ship|verfügbar)/i;
    outer: for (const pg of pages) {
      for (const sentence of pg.markdown.split(/(?<=[.!?\n])\s+/)) {
        const n = names.find((nm) => new RegExp(`\\b${escapeRe(nm)}\\b`, "i").test(sentence));
        if (n && avail.test(sentence) && sentence.length < 600) {
          const ex = sentence.replace(/\s+/g, " ").trim().slice(0, 320);
          evidence.push({
            url: pg.url, source_type: "platform", excerpt: ex, snapshot_time: pg.snapshot_time, content_hash: sha256(`country:${pg.url}:${n.toLowerCase()}`),
            rule_passed: accept.has("country_listed") ? `site lists ${n} as available` : null, passes: accept.has("country_listed"), details: { signal: "country_listed" },
          });
          break outer;
        }
      }
    }
  }

  // 4) country domain (nordwind.de) exists and belongs to the company (redirects to it or carries its name)
  if (cc) {
    const label = ctx.domain.split(".").slice(0, -1).join(".");
    const tld = CCTLD[cc] ?? cc.toLowerCase();
    const candidate = `${label}.${tld}`;
    if (candidate !== ctx.domain) {
      const r = await countryDomain(candidate, ctx.domain, ctx.company);
      obs.country_domain = { candidate, ...r };
      sources.push({ url: `https://${candidate}`, source_type: "platform", ok: r.exists, note: r.note });
      if (r.exists && r.owned) {
        evidence.push({
          url: r.final_url ?? `https://${candidate}`, source_type: "platform", excerpt: r.note, snapshot_time: now(),
          content_hash: sha256(`domain:${candidate}`),
          rule_passed: accept.has("country_domain") ? `${candidate} is live and belongs to ${ctx.company}` : null,
          passes: accept.has("country_domain"), details: { signal: "country_domain" },
        });
      }
    }
  }

  const passing = evidence.filter((e) => e.passes);
  const signals = [...new Set(passing.map((e) => (e.details as { signal: string }).signal))];
  return {
    status: statusFrom(passing, "confirmed"),
    summary: passing.length
      ? `${p.country ?? cc}: ${signals.join(", ").replace(/_/g, " ")} found on the site`
      : `No ${p.country ?? cc} declaration found yet (checked ${[...accept].join(", ").replace(/_/g, " ")})`,
    evidence,
    sources,
    observations: obs,
  };
}

async function countryDomain(candidate: string, mainDomain: string, company: string) {
  try {
    const res = await fetch(`https://${candidate}`, { redirect: "follow", signal: AbortSignal.timeout(8000) });
    const finalHost = hostOf(res.url);
    const body = (await res.text()).slice(0, 200_000);
    const title = body.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() ?? "";
    const parked = /domain (is )?for sale|buy this domain|parked|sedo|dan\.com|afternic|godaddy/i.test(body.slice(0, 50_000));
    const owned =
      !parked &&
      res.ok &&
      (finalHost === mainDomain || finalHost.endsWith("." + mainDomain) || finalHost === candidate) &&
      (finalHost !== candidate || new RegExp(escapeRe(company), "i").test(title + body.slice(0, 20_000)));
    return {
      exists: res.ok,
      owned,
      final_url: res.url,
      note: !res.ok
        ? `${candidate} answered HTTP ${res.status}`
        : parked
          ? `${candidate} looks parked / for sale`
          : owned
            ? `${candidate} → ${res.url} (title: "${title.slice(0, 80)}")`
            : `${candidate} is live but not clearly ${company}'s (→ ${finalHost})`,
    };
  } catch (e) {
    return { exists: false, owned: false, final_url: null, note: `${candidate} not reachable (${(e as Error).name})` };
  }
}
