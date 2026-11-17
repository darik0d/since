import { NextResponse, type NextRequest } from "next/server";

// Verifies the signed session cookie (no DB) and passes the user id on as x-since-user.
// Logged-out visitors see the landing page; protected APIs get 401.
const PUBLIC = [
  /^\/welcome$/,
  /^\/api\/auth\//,
  /^\/api\/webhooks\//,
  /^\/api\/inbound\/email$/,
  /^\/api\/health$/,
  /^\/api\/demo\//,
  /^\/startups\/\d+\/reconnect$/, // protected by its own per-startup token
  /^\/api\/startups\/\d+\/reconnect\//,
];

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function verify(cookie: string | undefined): Promise<number | null> {
  const secret = process.env.APP_SECRET;
  if (!cookie || !secret) return null;
  const [uid, exp, sig] = cookie.split(".");
  if (!uid || !exp || !sig || Number(exp) * 1000 < Date.now()) return null;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = b64url(await crypto.subtle.sign("HMAC", key, enc.encode(`${uid}.${exp}`)));
  if (want.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? Number(uid) : null;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const uid = await verify(req.cookies.get("since_session")?.value);
  const h = new Headers(req.headers);
  h.delete("x-since-user"); // never trust a client-sent one
  if (uid) h.set("x-since-user", String(uid));
  if (!uid && !PUBLIC.some((r) => r.test(path))) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "sign in first" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/welcome";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (uid && path === "/welcome") {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return NextResponse.next({ request: { headers: h } });
}

export const config = {
  matcher: ["/((?!_next/|icon.png|logo.png|favicon|.*\\.(?:png|jpg|svg|mp4|webm|ico|txt)$).*)"],
};
