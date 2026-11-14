import { llmJson, nullable } from "./llm";
import type { DraftCondition, MarketSignal } from "./types";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["conditions"],
  properties: {
    conditions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["original_words", "plain_words", "mechanism", "subtype", "params", "reason"],
        properties: {
          original_words: { type: "string" },
          plain_words: { type: "string" },
          mechanism: { type: "string", enum: ["product_shipped", "market_launch", "hiring_push", "announcement", "ask_at_checkin"] },
          subtype: nullable({ type: "string", enum: ["customer", "revenue", "retention"] }),
          reason: nullable("string"),
          params: {
            type: "object",
            additionalProperties: false,
            required: [
              "github_repo", "min_version", "app_store_url", "play_store_url",
              "country", "country_code", "language_code", "currency", "accept",
              "job_function", "min_roles",
              "customer_kind", "min_customers", "metric", "threshold", "threshold_currency",
            ],
            properties: {
              github_repo: nullable("string"),
              min_version: nullable("string"),
              app_store_url: nullable("string"),
              play_store_url: nullable("string"),
              country: nullable("string"),
              country_code: nullable("string"),
              language_code: nullable("string"),
              currency: nullable("string"),
              accept: nullable({ type: "array", items: { type: "string", enum: ["language", "currency", "country_listed", "country_domain"] } }),
              job_function: nullable({
                type: "string",
                enum: ["engineering", "sales", "marketing", "product", "design", "data", "customer_success", "operations", "finance", "people"],
              }),
              min_roles: nullable("integer"),
              customer_kind: nullable({ type: "string", enum: ["enterprise", "any"] }),
              min_customers: nullable("integer"),
              metric: nullable({ type: "string", enum: ["ARR", "MRR", "revenue", "NRR", "GRR", "retention"] }),
              threshold: nullable("number"),
              threshold_currency: nullable("string"),
            },
          },
        },
      },
    },
  },
};

const SYSTEM = `You turn an investor's "come back when..." note about a startup into atomic, monitorable conditions.
Split the note into one condition per distinct requirement. Keep original_words as the investor's exact wording for that part.
plain_words: a short neutral restatement, e.g. "First enterprise customer".

Mechanisms (pick exactly one):
- product_shipped: a release or app ships. params: github_repo ("org/repo") and min_version if given; app_store_url / play_store_url if given.
- market_launch: selling / launching / available in a country. params: country (English name), country_code (ISO 3166-1 alpha-2),
  language_code (main ISO 639-1 language of that country), currency (ISO 4217 used there),
  accept: which public declarations count. Default ["language","currency","country_listed","country_domain"] unless the investor narrows it.
- hiring_push: hiring N people / N open roles in one function. params: job_function, min_roles.
- announcement with subtype:
  - customer: landing a (first / enterprise / named) customer. params: customer_kind ("enterprise" if they said enterprise/large/corporate, else "any"), min_customers (default 1).
  - revenue: revenue / ARR / MRR threshold. params: metric, threshold (a plain number, e.g. 1000000 for "1M"), threshold_currency (ISO 4217).
  - retention: NRR / GRR / retention / churn threshold. params: metric, threshold (percent number).
- ask_at_checkin: anything with no public signal (burn rate, runway, cap table, team quality, unit economics, founder commitment, a "feeling").
  reason: one short line why it cannot be watched publicly.

Never invent numbers, repos or URLs the investor did not give. All params not relevant to the chosen mechanism must be null.`;

export async function mapConditions(text: string, company: string, domain: string): Promise<DraftCondition[]> {
  const out = await llmJson<{ conditions: DraftCondition[] }>({
    name: "conditions",
    schema: SCHEMA,
    system: SYSTEM,
    user: `Startup: ${company} (${domain})\nInvestor's note:\n"""${text}"""`,
  });
  return out.conditions.map(normalize);
}

const ALL_SIGNALS: MarketSignal[] = ["language", "currency", "country_listed", "country_domain"];

/** Deterministic clean-up of whatever the LLM returned. */
export function normalize(c: DraftCondition): DraftCondition {
  const p = { ...c.params };
  if (c.mechanism === "market_launch") {
    p.country_code = p.country_code?.toUpperCase() ?? null;
    p.language_code = p.language_code?.toLowerCase() ?? null;
    p.currency = p.currency?.toUpperCase() ?? null;
    p.accept = p.accept && p.accept.length ? p.accept : ALL_SIGNALS;
  }
  if (c.mechanism === "hiring_push") p.min_roles = Math.max(1, p.min_roles ?? 1);
  if (c.mechanism === "announcement" && c.subtype === "customer") {
    p.customer_kind = p.customer_kind ?? "any";
    p.min_customers = Math.max(1, p.min_customers ?? 1);
  }
  if (c.mechanism === "announcement" && c.subtype === "revenue") p.threshold_currency = p.threshold_currency?.toUpperCase() ?? null;
  if (c.mechanism === "product_shipped" && p.github_repo) {
    p.github_repo = p.github_repo.replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "").split("/").slice(0, 2).join("/");
  }
  const subtype = c.mechanism === "announcement" ? c.subtype ?? "customer" : null;
  return { ...c, subtype, params: p, reason: c.mechanism === "ask_at_checkin" ? c.reason ?? "No public signal." : null };
}
