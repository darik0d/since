// Runs once when the Next.js server boots (dev and `node server.js`).
// Aiven Runtime has no pre-deploy commands, so migrations run here, before traffic is served.
// The Node-only code lives in instrumentation-node.ts so the edge bundle never sees `pg`.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
