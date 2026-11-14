import type { EvidenceCandidate } from "../types";

/**
 * Deterministic status from passing evidence:
 *  - a rule passes on a platform or independent source -> confirmed
 *  - passes only on founder-controlled sources          -> reported
 *  - nothing passes                                      -> watching
 * `cap` limits the best reachable status (revenue/retention: reported).
 */
export function statusFrom(passing: EvidenceCandidate[], cap: "confirmed" | "reported"): "watching" | "reported" | "confirmed" {
  if (passing.some((e) => e.source_type !== "founder_controlled")) return cap === "confirmed" ? "confirmed" : "reported";
  if (passing.length) return "reported";
  return "watching";
}
