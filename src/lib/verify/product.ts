import { getPage, sha256, now } from "../sources";
import type { CheckContext, CheckResult, EvidenceCandidate, SourceChecked } from "../types";

// product_shipped: GitHub release >= version (public GitHub API), or an App Store / Google Play
// listing that exists (scraped through Context.dev).

const parseVer = (v: string) => (v.match(/\d+(?:\.\d+){0,3}/)?.[0] ?? "").split(".").map(Number);
function cmpVer(a: string, b: string) {
  const x = parseVer(a), y = parseVer(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export async function checkProduct(ctx: CheckContext): Promise<CheckResult> {
  const p = ctx.params;
  const sources: SourceChecked[] = [];
  const evidence: EvidenceCandidate[] = [];
  const obs: Record<string, unknown> = {};

  if (p.github_repo) {
    const api = `https://api.github.com/repos/${p.github_repo}/releases?per_page=20`;
    try {
      const r = await fetch(api, { headers: { Accept: "application/vnd.github+json", "User-Agent": "since-app" }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rels = ((await r.json()) as any[]).filter((x) => !x.draft && !x.prerelease);
      sources.push({ url: `https://github.com/${p.github_repo}/releases`, source_type: "platform", ok: true, note: `${rels.length} releases` });
      const best = rels.filter((x) => parseVer(x.tag_name).length && (!p.min_version || cmpVer(x.tag_name, p.min_version) >= 0))
        .sort((a, b) => cmpVer(b.tag_name, a.tag_name))[0];
      obs.latest = rels[0]?.tag_name ?? null;
      if (best) {
        evidence.push({
          url: best.html_url, source_type: "platform", excerpt: `${best.name || best.tag_name} published ${best.published_at}`,
          snapshot_time: now(), content_hash: sha256(`gh:${best.tag_name}`),
          rule_passed: p.min_version ? `release ${best.tag_name} ≥ ${p.min_version}` : `release ${best.tag_name} exists`, passes: true,
        });
      }
    } catch (e) {
      sources.push({ url: `https://github.com/${p.github_repo}/releases`, source_type: "platform", ok: false, note: (e as Error).message });
    }
  }

  for (const [store, url] of [["App Store", p.app_store_url], ["Google Play", p.play_store_url]] as const) {
    if (!url) continue;
    const pg = await getPage(url, { fresh: ctx.fresh });
    const live = pg.ok && !/not available|could not be found|we're sorry|item not found/i.test(pg.markdown.slice(0, 3000));
    sources.push({ url, source_type: "platform", ok: pg.ok, note: live ? "listing live" : "no live listing" });
    if (live) {
      evidence.push({
        url, source_type: "platform", excerpt: pg.title || pg.markdown.slice(0, 200), snapshot_time: pg.snapshot_time,
        content_hash: sha256(`store:${url}`), rule_passed: `${store} listing is live`, passes: true,
      });
    }
  }

  if (!p.github_repo && !p.app_store_url && !p.play_store_url) {
    return { status: "watching", summary: "Add a GitHub repo or store URL to watch", evidence, sources, observations: obs };
  }
  return {
    status: evidence.length ? "confirmed" : "watching",
    summary: evidence.length ? evidence.map((e) => e.rule_passed).join("; ") : `No qualifying release yet${obs.latest ? ` (latest ${obs.latest})` : ""}`,
    evidence,
    sources,
    observations: obs,
  };
}
