import { NextResponse } from "next/server";
import { SESSION_COOKIE, signSession, verifyLogin } from "@/lib/auth";
import { publicBase } from "@/lib/env";
import { one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const base = publicBase() || new URL(req.url).origin;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const user = token ? await verifyLogin(token) : null;
  if (!user) return NextResponse.redirect(`${base}/welcome?error=link`);
  // new pilot users go through the two-minute onboarding first
  const hasWatch = await one("SELECT 1 FROM startups WHERE user_id = $1 LIMIT 1", [user.id]);
  const s = signSession(user.id);
  const res = NextResponse.redirect(`${base}${hasWatch || user.is_admin ? "/" : "/onboarding"}`);
  res.cookies.set(SESSION_COOKIE, s.value, { httpOnly: true, sameSite: "lax", secure: base.startsWith("https://"), path: "/", maxAge: s.maxAge });
  return res;
}
