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
