import { migrate } from "./lib/migrations";

if (!process.env.DATABASE_URL) {
  console.warn("[since] DATABASE_URL not set: skipping migrations");
} else {
  try {
    await migrate();
    await (await import("./lib/auth")).ensureOwner();
    console.log("[since] database schema up to date");
  } catch (e) {
    console.error("[since] migrations failed, exiting:", e);
    process.exit(1); // fail the deploy loudly instead of serving with a broken schema
  }
}

// Granola: poll new meeting notes every 2 minutes (no webhooks on our plan). One timer per process.
// A note only appears once Granola has its summary, so a pass shows up in the Inbox a few minutes after the call.
const g = globalThis as unknown as { __sinceGranolaTimer?: ReturnType<typeof setInterval> };
if (process.env.DATABASE_URL && !g.__sinceGranolaTimer) {
  const run = () =>
    import("./lib/granola")
      .then((m) => m.syncAllGranola())
      .then((all) => { for (const [u, r] of Object.entries(all)) console.log(`[since] granola sync user ${u}: ${r.ok ? `${r.seen} notes, ${r.pending} new pending` : r.error}`); })
      .catch((e) => console.error("[since] granola sync failed", e));
  g.__sinceGranolaTimer = setInterval(run, 2 * 60_000);
  setTimeout(run, 30_000);
}

// Telegram: bind "/start <token>" messages to accounts (getUpdates, no webhook), every 15 s.
const gt = globalThis as unknown as { __sinceTgTimer?: ReturnType<typeof setInterval> };
// only the deployed app polls (a laptop running the same bot would consume its updates)
if (process.env.TELEGRAM_BOT_TOKEN && process.env.DATABASE_URL && (process.env.PUBLIC_BASE_URL ?? "").startsWith("https://") && !gt.__sinceTgTimer) {
  gt.__sinceTgTimer = setInterval(() => {
    import("./lib/telegram").then((m) => m.processUpdates()).catch((e) => console.error("[since] telegram updates", e));
  }, 15_000);
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
