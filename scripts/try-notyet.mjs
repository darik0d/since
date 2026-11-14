// Dev helper: parse a "not yet" note, start watching, print each condition's baseline result.
//   node scripts/try-notyet.mjs <domain> "<come back when...>" [baseUrl]
const [domain, text, base = "http://localhost:3000"] = process.argv.slice(2);
if (!domain || !text) {
  console.error('usage: node scripts/try-notyet.mjs <domain> "<come back when...>" [baseUrl]');
  process.exit(1);
}
const post = async (path, body) => {
  const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
  return j;
};

const p = await post("/api/notyet/parse", { domain, text });
console.log(`\n${p.company} (${p.domain})  blog=${p.site.blog.length} careers=${p.site.careers.length} boards=${p.site.job_boards.map((b) => b.kind).join(",") || "-"}`);
for (const c of p.conditions) {
  const params = Object.fromEntries(Object.entries(c.params).filter(([, v]) => v != null));
  console.log(`  • ${c.mechanism}${c.subtype ? "/" + c.subtype : ""}: "${c.original_words}" ${JSON.stringify(params)}`);
}
const s = await post("/api/notyet/start", {
  domain: p.domain, company: p.company, logo_url: p.logo_url, met_on: "2026-11-12", met_where: "test run", text,
  conditions: p.conditions.map(({ preview, ...c }) => c),
});
for (const c of s.conditions) {
  if (c.status === "ask_at_checkin") {
    console.log(`\n#${c.id} ask_at_checkin: ${c.summary}`);
    continue;
  }
  const d = await post(`/api/conditions/${c.id}/check`);
  console.log(`\n#${c.id} ${d.status.toUpperCase()}  (found: ${d.found})  ${d.summary}`);
  for (const e of d.evidence) console.log(`   ${e.passes ? "✓" : "?"} [${e.source_type}] ${e.rule_passed ?? "(no rule passed)"}\n     ${e.url}\n     "${e.excerpt.slice(0, 220)}"`);
  for (const src of d.sources) console.log(`   · ${src.source_type}: ${src.url} — ${src.note}`);
}
