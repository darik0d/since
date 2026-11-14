import { planMonitors } from "./monitors";
import type { SiteMap } from "./sources";
import { bestPossibleEvidence, type DraftCondition } from "./types";

export type ConditionPreview = {
  how: string;
  sources: { label: string; url: string | null; source_type: string }[];
  best_evidence: "confirmed" | "reported" | null;
  best_evidence_note: string | null;
  monitors: { role: string; priority: string }[];
};

/** Deterministic "How we verify" copy for a condition card. */
export function preview(c: DraftCondition, company: string, site: SiteMap): ConditionPreview {
  const p = c.params;
  const best = bestPossibleEvidence(c.mechanism, c.subtype);
  const monitors = planMonitors(c, company, site).map((m) => ({ role: m.role, priority: m.priority }));
  const sources: ConditionPreview["sources"] = [];
  let how = "";
  let note: string | null = null;

  switch (c.mechanism) {
    case "market_launch": {
      const acc = (p.accept ?? []).map((a) => ({ language: `site offered in ${p.language_code}`, currency: `prices in ${p.currency}`, country_listed: `${p.country} listed as available`, country_domain: `${site.domain.split(".")[0]}.${(p.country_code ?? "").toLowerCase()} live` })[a]);
      how = `Any of: ${acc.join(" · ")}. Read from the site's own HTML (lang / hreflang / switcher) and pricing page, plus a country-domain check.`;
      sources.push({ label: "Homepage", url: site.home.url, source_type: "platform" });
      site.pricing.slice(0, 1).forEach((u) => sources.push({ label: "Pricing", url: u, source_type: "platform" }));
      break;
    }
    case "hiring_push": {
      how = `Count open ${p.job_function} roles (deduped by title) on the job board; ≥ ${p.min_roles} confirms. Fewer keeps watching.`;
      site.jobBoards.forEach((b) => sources.push({ label: `Job board (${b.kind})`, url: b.url, source_type: "platform" }));
      site.careers.slice(0, 1).forEach((u) => sources.push({ label: "Careers page", url: u, source_type: "founder_controlled" }));
      sources.push({ label: "Indexed LinkedIn job posts", url: null, source_type: "independent" });
      break;
    }
    case "announcement": {
      if (c.subtype === "customer") {
        how = `Look for a named ${p.customer_kind === "enterprise" ? "enterprise " : ""}customer on the founder's channels (reported), then on independent news or the customer's own site (confirmed).`;
      } else if (c.subtype === "revenue") {
        how = `Extract ${p.metric ?? "revenue"} figures and compare with ${p.threshold?.toLocaleString("en")} ${p.threshold_currency ?? ""}.`;
        note = "Revenue is usually founder-reported; it is confirmed only by official filings (months late).";
      } else {
        how = `Extract ${p.metric ?? "retention"} figures and compare with ${p.threshold}%.`;
        note = "Retention is only ever founder-reported.";
      }
      site.blog.slice(0, 2).forEach((u) => sources.push({ label: "Founder blog / newsroom", url: u, source_type: "founder_controlled" }));
      if (c.subtype === "customer") site.customers.slice(0, 1).forEach((u) => sources.push({ label: "Customers page", url: u, source_type: "founder_controlled" }));
      sources.push({ label: "News search (Context.dev)", url: null, source_type: "independent" });
      sources.push({ label: "Web search monitor", url: null, source_type: "independent" });
      break;
    }
    case "product_shipped": {
      how = p.github_repo
        ? `GitHub release ${p.min_version ? `≥ ${p.min_version}` : "published"} on ${p.github_repo}.`
        : p.app_store_url || p.play_store_url
          ? "Store listing goes live."
          : "Add a GitHub repo or App Store / Google Play URL.";
      if (p.github_repo) sources.push({ label: "GitHub releases", url: `https://github.com/${p.github_repo}/releases`, source_type: "platform" });
      break;
    }
    case "funding_round":
      how = `A ${p.round_series ?? "new funding round"} dated after the meeting in Cala's company data (with its source document) confirms.`;
      sources.push({ label: "Cala: funding rounds + investors", url: null, source_type: "independent" });
      break;
    case "team_size":
      how = `Cala headcount ≥ ${p.min_employees}, with a source dated after the meeting, confirms (an estimate).`;
      note = "Headcount is an estimate from Cala's sources.";
      sources.push({ label: "Cala: employee count", url: null, source_type: "independent" });
      break;
    case "ask_at_checkin":
      how = c.reason ?? "No public signal: ask at the next check-in.";
      break;
  }
  return { how, sources, best_evidence: best, best_evidence_note: note, monitors };
}
