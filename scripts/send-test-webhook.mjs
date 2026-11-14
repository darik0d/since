// Sends a signed fake change.detected webhook to the app, the same way Context.dev signs it.
//   npm run webhook:test                                  -> http://localhost:3000
//   npm run webhook:test -- https://<ip>.sslip.io         -> deployed app
// Signs with the first secret in CONTEXT_WEBHOOK_SECRETS (or whsec_local_test, which the app
// only accepts if it's in its own CONTEXT_WEBHOOK_SECRETS).
import { createHmac, randomUUID } from "node:crypto";

const target = (process.argv[2] || process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const secret = (process.env.CONTEXT_WEBHOOK_SECRETS || "whsec_local_test").split(",")[0].trim();

const id = `evt_test_${randomUUID().slice(0, 8)}`;
const body = JSON.stringify({
  event: "change.detected",
  id,
  created_at: new Date().toISOString(),
  data: {
    change: {
      monitor_id: "mon_test_local",
      summary: "Test: blog post 'Welcome Kallio Logistics, our first enterprise customer' appeared (fictional)",
    },
    run: { monitor_id: "mon_test_local", status: "completed" },
  },
});
const t = Math.floor(Date.now() / 1000);
const v1 = createHmac("sha256", secret).update(`${t}.`).update(body).digest("hex");

const res = await fetch(`${target}/api/webhooks/context`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Context-Signature": `t=${t},v1=${v1}`,
    "X-Context-Event": "change.detected",
    "X-Context-Id": id,
    "X-Context-Delivery-Id": `dlv_${randomUUID().slice(0, 8)}`,
    "X-Context-Attempt": "1",
  },
  body,
});
console.log(res.status, await res.text());
