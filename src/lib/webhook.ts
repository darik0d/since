import { createHmac, timingSafeEqual } from "node:crypto";

// Context.dev signs webhooks with: X-Context-Signature: t=<unix seconds>,v1=<hex>
// v1 = hex(HMAC-SHA256(secret, `${t}.${rawBody}`)); secret used as-is (incl. "whsec_").
const TOLERANCE_SECONDS = 300;

export type SignatureResult = { ok: boolean; note: string; secretIndex?: number };

export function verifyContextSignature(
  rawBody: string,
  header: string | null,
  secrets: string[],
  nowSeconds = Date.now() / 1000,
): SignatureResult {
  if (!header) return { ok: false, note: "missing X-Context-Signature" };
  const parts = Object.fromEntries(
    header.split(",").map((s) => {
      const i = s.indexOf("=");
      return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return { ok: false, note: "malformed signature header" };
  if (Math.abs(nowSeconds - t) > TOLERANCE_SECONDS) return { ok: false, note: "timestamp outside 5 min tolerance" };
  if (secrets.length === 0) return { ok: false, note: "no secret known for this monitor" };

  const actual = Buffer.from(parts.v1, "hex");
  for (let i = 0; i < secrets.length; i++) {
    const expected = createHmac("sha256", secrets[i]).update(`${t}.`).update(rawBody).digest();
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
      return { ok: true, note: "valid", secretIndex: i };
    }
  }
  return { ok: false, note: "signature mismatch" };
}

export function signForTest(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest("hex");
  return `t=${t},v1=${v1}`;
}
