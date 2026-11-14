import { migrate } from "./lib/migrations";

if (!process.env.DATABASE_URL) {
  console.warn("[since] DATABASE_URL not set: skipping migrations");
} else {
  try {
    await migrate();
    console.log("[since] database schema up to date");
  } catch (e) {
    console.error("[since] migrations failed, exiting:", e);
    process.exit(1); // fail the deploy loudly instead of serving with a broken schema
  }
}

// Granola: poll new meeting notes every 2 minutes (no webhooks on our plan). One timer per process.
// A note only appears once Granola has its summary, so a pass shows up in the Inbox a few minutes after the call.
const g = globalThis as unknown as { __sinceGranolaTimer?: ReturnType<typeof setInterval> };
if (process.env.GRANOLA_API_KEY && process.env.DATABASE_URL && !g.__sinceGranolaTimer) {
  const run = () =>
    import("./lib/granola")
      .then((m) => m.syncGranola())
      .then((r) => console.log(`[since] granola sync: ${r.ok ? `${r.seen} notes, ${r.pending} new pending` : r.error}`))
      .catch((e) => console.error("[since] granola sync failed", e));
  g.__sinceGranolaTimer = setInterval(run, 2 * 60_000);
  setTimeout(run, 30_000);
}

// Cala: no webhooks, so poll company snapshots every 30 minutes (diff -> new-investor alert, re-check).
const gc = globalThis as unknown as { __sinceCalaTimer?: ReturnType<typeof setInterval> };
if (process.env.CALA_API_KEY && process.env.DATABASE_URL && !gc.__sinceCalaTimer) {
  const runCala = () =>
    import("./lib/cala-sync")
      .then((m) => m.pollCala())
      .then((r) => console.log(`[since] cala poll: ${r.ok ? `${r.startups} startups` : r.error}`))
      .catch((e) => console.error("[since] cala poll failed", e));
  gc.__sinceCalaTimer = setInterval(runCala, 30 * 60_000);
}
