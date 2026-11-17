import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { publicBase } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const res = NextResponse.redirect(`${publicBase() || new URL(req.url).origin}/welcome`, 303);
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
