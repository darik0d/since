import { AsyncLocalStorage } from "node:async_hooks";
import { query } from "./db";

// Who is the current Context.dev / Cala call for? Set around checks, parses and syncs;
// every billable call is logged to api_usage so the admin page can show usage per user.
const store = new AsyncLocalStorage<{ userId: number | null }>();

export const withUser = <T>(userId: number | null, fn: () => Promise<T>) => store.run({ userId }, fn);
export const usageUser = () => store.getStore()?.userId ?? null;

export function recordUsage(service: "context" | "cala", kind: string, units = 1) {
  query("INSERT INTO api_usage (user_id, service, kind, units) VALUES ($1, $2, $3, $4)", [usageUser(), service, kind, units]).catch(() => {});
}
