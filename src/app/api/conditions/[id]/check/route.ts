import { currentUserId } from "@/lib/auth";
import { ownsCondition } from "@/lib/conditions";
import { NextResponse } from "next/server";
import { checkCondition } from "@/lib/conditions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// "Check now" (testing): run this condition's verifier once against the live web via Context.dev
// scrape / news search. No monitor is involved. Returns the evidence and the resulting status.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!(await ownsCondition(id, await currentUserId()))) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const r = await checkCondition(id, { fresh: true, trigger: "check now (direct)" });
    return NextResponse.json({
      ok: true,
      status: r.condition.status,
      changed: r.changed,
      found: r.result?.status ?? null,
      summary: r.result?.summary ?? null,
      evidence: r.result?.evidence ?? [],
      sources: r.result?.sources ?? [],
      observations: r.result?.observations ?? {},
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
