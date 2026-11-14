export const MECHANISMS = ["product_shipped", "market_launch", "hiring_push", "announcement", "funding_round", "team_size", "ask_at_checkin"] as const;
export type Mechanism = (typeof MECHANISMS)[number];
export type Subtype = "customer" | "revenue" | "retention";
export type SourceType = "platform" | "independent" | "founder_controlled";
export type Status = "watching" | "reported" | "confirmed" | "needs_review" | "ask_at_checkin" | "expired";
export type MarketSignal = "language" | "currency" | "country_listed" | "country_domain";

// One flat bag of parameters; each mechanism reads only its own fields.
export type ConditionParams = {
  // product_shipped
  github_repo?: string | null; // "org/repo"
  min_version?: string | null;
  app_store_url?: string | null;
  play_store_url?: string | null;
  // market_launch
  country?: string | null; // "Germany"
  country_code?: string | null; // "DE"
  language_code?: string | null; // "de"
  currency?: string | null; // "EUR"
  accept?: MarketSignal[] | null; // any of these counts
  // hiring_push
  job_function?: string | null; // engineering | sales | ...
  min_roles?: number | null;
  // announcement
  customer_kind?: "enterprise" | "any" | null;
  min_customers?: number | null;
  metric?: string | null; // ARR | MRR | revenue | NRR | GRR | retention
  threshold?: number | null; // 1000000 or 120 (percent)
  threshold_currency?: string | null;
  // funding_round (Cala)
  round_series?: string | null; // "Seed" | "Series A" | null = any new round
  // team_size (Cala)
  min_employees?: number | null;
  // set by Since once a named customer's own site is found (not by the LLM)
  customer_sites?: { name: string; domain: string }[];
};

export type DraftCondition = {
  original_words: string;
  plain_words: string;
  mechanism: Mechanism;
  subtype: Subtype | null;
  params: ConditionParams;
  reason: string | null; // ask_at_checkin only
};

export type EvidenceCandidate = {
  url: string;
  source_type: SourceType;
  excerpt: string;
  snapshot_time: string;
  content_hash: string;
  rule_passed: string | null; // null = observed but no rule passed (ambiguous)
  passes: boolean;
  details?: unknown;
};

export type SourceChecked = { url: string; source_type: SourceType; ok: boolean; note: string };

export type CheckResult = {
  status: "watching" | "reported" | "confirmed" | "needs_review";
  summary: string; // one neutral line: what we saw
  evidence: EvidenceCandidate[];
  sources: SourceChecked[];
  observations: Record<string, unknown>;
  note?: string; // shown as the status note on an upgrade, e.g. "Confirmed by the customer"
};

export type CheckContext = {
  domain: string;
  company: string;
  params: ConditionParams;
  subtype: Subtype | null;
  fresh?: boolean; // bypass Context.dev scrape cache
};

/** Best possible evidence per mechanism (shown on every card). Deterministic, not LLM. */
export function bestPossibleEvidence(m: Mechanism, s: Subtype | null): "confirmed" | "reported" | null {
  if (m === "ask_at_checkin") return null;
  if (m === "announcement" && (s === "revenue" || s === "retention")) return "reported";
  return "confirmed";
}
