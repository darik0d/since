// Runs once when the Next.js server boots (dev and `node server.js`).
// Aiven Runtime has no pre-deploy commands, so migrations run here, before traffic is served.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.DATABASE_URL) {
    console.warn("[since] DATABASE_URL not set: skipping migrations");
    return;
  }
  const { migrate } = await import("./lib/migrations");
  try {
    await migrate();
    console.log("[since] database schema up to date");
  } catch (e) {
    console.error("[since] migrations failed, exiting:", e);
    process.exit(1); // fail the deploy loudly instead of serving with a broken schema
  }
}
