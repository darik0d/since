import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/auth";
import { withUser } from "@/lib/usage";
import { brandFor, normalizeDomain } from "@/lib/brand";
import { preview } from "@/lib/describe";
import { mapConditions } from "@/lib/mapping";
import { discoverSite } from "@/lib/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Step 1 of New "not yet": map the investor's words to conditions (LLM) and show how each is verified.
// Nothing is stored yet; the investor confirms / edits first.
export async function POST(req: Request) {
  const body = await req.json();
  const domain = normalizeDomain(body.domain ?? "");
  const text = String(body.text ?? "").trim();
  if (!domain.includes(".") || !text) return NextResponse.json({ error: "domain and text are required" }, { status: 400 });

  const uid = await currentUserId();
  return withUser(uid, async () => { try {
    const sitePromise = discoverSite(domain);
    const [brand, site] = await Promise.all([brandFor(domain, sitePromise.then((s) => s.home.title)), sitePromise]);
    const conditions = await mapConditions(text, brand.name, domain);
    return NextResponse.json({
      domain,
      company: brand.name,
      logo_url: brand.logo_url,
      site: {
        reachable: site.home.ok,
        pricing: site.pricing,
        careers: site.careers,
        blog: site.blog,
        customers: site.customers,
        job_boards: site.jobBoards,
      },
      conditions: conditions.map((c) => ({ ...c, preview: preview(c, brand.name, site) })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  } });
}
