// Context.dev REST smoke test.
//   npm run context:smoke                       -> usage, limits, monitors, brand, news, scrape (read-only, ~12 credits)
//   npm run context:smoke -- --domain wolt.com  -> pick the domain for brand/news/scrape
//   npm run context:smoke -- --monitor          -> also create a 10-min page monitor (tag since-m0) whose webhook
//                                                  points at PUBLIC_BASE_URL/api/webhooks/context, then run it now
//   npm run context:smoke -- --cleanup          -> delete all monitors tagged since-m0
const BASE = process.env.CONTEXT_API_BASE || "https://api.context.dev/v1";
const KEY = process.env.CONTEXT_API_KEY;
if (!KEY) {
  console.error("CONTEXT_API_KEY missing (put it in .env)");
  process.exit(1);
}
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const domain = opt("--domain", "wolt.com");

async function call(method, path, body) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  const ms = Date.now() - t0;
  const tag = res.ok ? "OK " : "ERR";
  console.log(`\n[${tag}] ${method} ${path} -> ${res.status} (${ms} ms)`);
  if (!res.ok) console.log(JSON.stringify(json, null, 2).slice(0, 1200));
  return { ok: res.ok, status: res.status, json };
}

const results = [];
const step = async (name, fn) => {
  try {
    const ok = await fn();
    results.push([name, ok !== false]);
  } catch (e) {
    console.log(`  ! ${e.message}`);
    results.push([name, false]);
  }
};

await step("usage", async () => {
  const r = await call("GET", "/org/usage");
  if (r.ok) console.log(`  credits_remaining: ${r.json.credits_remaining}`, r.json.next_refill ?? "");
  return r.ok;
});

await step("monitor limits", async () => {
  const r = await call("GET", "/monitors/limits");
  if (r.ok) console.log(`  monitors: ${r.json.monitors_used}/${r.json.monitors_limit} (plan ${r.json.plan})`);
  return r.ok;
});

await step("list monitors", async () => {
  const r = await call("GET", "/monitors?limit=100");
  if (r.ok) for (const m of r.json.data) console.log(`  - ${m.id} [${m.status}] ${m.target?.type} ${m.name} -> ${m.webhook?.url ?? "no webhook"}`);
  return r.ok;
});

await step("brand", async () => {
  const r = await call("POST", "/brand/retrieve", { type: "by_domain", domain });
  if (r.ok) console.log(`  ${r.json.brand?.title} logo: ${r.json.brand?.logos?.[0]?.url ?? "none"}`);
  return r.ok;
});

await step("news search", async () => {
  const r = await call("POST", "/news/search", {
    searchBy: { type: "entity", entity: { type: "domain", domain } },
    sortBy: "newest",
    limit: 5,
  });
  if (r.ok) for (const a of r.json.data) console.log(`  - ${a.published_at?.slice(0, 10)} ${a.source?.domain}: ${a.title}`);
  return r.ok;
});

await step("scrape", async () => {
  const r = await call("POST", "/web/scrape", { url: `https://${domain}`, formats: { markdown: true } });
  if (r.ok) console.log(`  markdown ${r.json.markdown?.success ? "ok" : "failed"}, ${r.json.markdown?.data?.length ?? 0} chars`);
  return r.ok && r.json.markdown?.success;
});

if (flag("--monitor")) {
  await step("create monitor + run now", async () => {
    const pub = process.env.PUBLIC_BASE_URL;
    if (!pub || !pub.startsWith("https://")) throw new Error("PUBLIC_BASE_URL must be the https URL of the deployed app");
    const r = await call("POST", "/monitors", {
      mode: "web",
      name: `since-m0 ${domain}`,
      target: { type: "page", url: opt("--url", `https://${domain}`) },
      change_detection: { type: "exact" },
      schedule: { type: "interval", frequency: 10, unit: "minutes" },
      webhook: { url: `${pub}/api/webhooks/context`, events: ["change.detected", "run.completed"], retry: {} },
      tags: ["since-m0"],
    });
    if (!r.ok) return false;
    console.log(`  monitor ${r.json.id}, initial run ${r.json.initial_run_id}`);
    console.log(`  webhook secret: ${r.json.webhook?.secret ? r.json.webhook.secret.slice(0, 10) + "…" : "(not returned)"}`);
    console.log("  -> add the full secret to CONTEXT_WEBHOOK_SECRETS on the server to see 'verified' in the log.");
    if (r.json.webhook?.secret && flag("--print-secret")) console.log(`  full secret: ${r.json.webhook.secret}`);
    const run = await call("POST", `/monitors/${r.json.id}/run`);
    if (run.ok) console.log(`  queued run ${run.json.run_id}`);
    return run.ok;
  });
}

if (flag("--cleanup")) {
  await step("cleanup since-m0 monitors", async () => {
    const r = await call("GET", "/monitors?limit=100&tag=since-m0");
    if (!r.ok) return false;
    for (const m of r.json.data) await call("DELETE", `/monitors/${m.id}`);
    return true;
  });
}

console.log("\nSummary");
for (const [n, ok] of results) console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
