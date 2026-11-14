import { NextResponse } from "next/server";
import { one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const r = await one("UPDATE inbound_items SET status = 'dismissed' WHERE id = $1 AND status = 'pending' RETURNING id", [id]);
  return NextResponse.json({ ok: Boolean(r) }, { status: r ? 200 : 404 });
}
