import type { CheckContext, CheckResult, Mechanism } from "../types";
import { checkAnnouncement } from "./announcement";
import { checkHiring } from "./hiring";
import { checkMarket } from "./market";
import { checkProduct } from "./product";
import { checkFundingRound, checkTeamSize } from "./cala";

export async function runCheck(mechanism: Mechanism, ctx: CheckContext): Promise<CheckResult> {
  switch (mechanism) {
    case "market_launch":
      return checkMarket(ctx);
    case "announcement":
      return checkAnnouncement(ctx);
    case "hiring_push":
      return checkHiring(ctx);
    case "product_shipped":
      return checkProduct(ctx);
    case "funding_round":
      return checkFundingRound(ctx);
    case "team_size":
      return checkTeamSize(ctx);
    default:
      return { status: "watching", summary: "Not publicly observable", evidence: [], sources: [], observations: {} };
  }
}
