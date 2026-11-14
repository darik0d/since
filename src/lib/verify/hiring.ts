import { discoverSite, extractLinks, getPage, JOB_BOARDS, sha256, now, stripTags } from "../sources";
import type { CheckContext, CheckResult, EvidenceCandidate, SourceChecked } from "../types";

// hiring_push: >= N open roles in one function. Job boards are read through their public JSON/RSS
// feeds (deterministic); the careers page is a fallback. Count is a lower bound: fewer = "watching".

type Role = { title: string; department: string | null; location: string | null; url: string | null };

const FUNCTION_RE: Record<string, RegExp> = {
  engineering: /(engineer(?!ing manager)|engineering manager|developer|software|backend|back-end|frontend|front-end|full[- ]?stack|devops|\bsre\b|infrastructure|\bios\b|android|\bqa\b|test automation|software architect|\bcto\b|tech lead|embedded|firmware)/i,
  sales: /(sales|account executive|\bae\b|sdr|bdr|business development|account manager|partnerships?|revenue|commercial)/i,
  marketing: /(marketing|growth|brand|content|seo|communications|pr\b|demand gen|community)/i,
  product: /(product manager|product owner|head of product|\bpm\b|product lead|product operations)/i,
  design: /(design|ux|ui\b|user research)/i,
  data: /(data scien|data analy|machine learning|\bml\b|\bai\b|analytics|data engineer)/i,
  customer_success: /(customer success|support|customer experience|onboarding|implementation|solutions? engineer)/i,
  operations: /(operations|ops\b|logistics|supply|office manager|chief of staff)/i,
  finance: /(finance|accounting|controller|cfo|fp&a|accountant)/i,
  people: /(people|talent|recruit|hr\b|human resources)/i,
};

async function getJson(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function getText(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

async function readBoard(kind: string, token: string): Promise<{ api: string; roles: Role[] }> {
  switch (kind) {
    case "greenhouse": {
      const api = `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`;
      const j = await getJson(api);
      return { api, roles: (j.jobs ?? []).map((x: any) => ({ title: x.title, department: x.departments?.[0]?.name ?? null, location: x.location?.name ?? null, url: x.absolute_url })) };
    }
    case "lever": {
      const api = `https://api.lever.co/v0/postings/${token}?mode=json`;
      const j = await getJson(api);
      return { api, roles: (j ?? []).map((x: any) => ({ title: x.text, department: x.categories?.team ?? x.categories?.department ?? null, location: x.categories?.location ?? null, url: x.hostedUrl })) };
    }
    case "ashby": {
      const api = `https://api.ashbyhq.com/posting-api/job-board/${token}`;
      const j = await getJson(api);
      return { api, roles: (j.jobs ?? []).map((x: any) => ({ title: x.title, department: x.department ?? x.team ?? null, location: x.location ?? null, url: x.jobUrl })) };
    }
    case "workable": {
      const api = `https://apply.workable.com/api/v1/widget/accounts/${token}`;
      const j = await getJson(api);
      return { api, roles: (j.jobs ?? []).map((x: any) => ({ title: x.title, department: x.department ?? null, location: x.city ?? x.country ?? null, url: x.url })) };
    }
    case "personio": {
      const api = `https://${token}.jobs.personio.de/xml`;
      const xml = await getText(api);
      const roles = [...xml.matchAll(/<position>([\s\S]*?)<\/position>/g)].map((m) => ({
        title: stripTags(m[1].match(/<name>([\s\S]*?)<\/name>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "") ?? ""),
        department: m[1].match(/<department>([\s\S]*?)<\/department>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "") ?? null,
        location: m[1].match(/<office>([\s\S]*?)<\/office>/)?.[1] ?? null,
        url: null,
      }));
      return { api, roles };
    }
    case "teamtailor": {
      const api = `https://${token}.teamtailor.com/jobs.rss`;
      const xml = await getText(api);
      const roles = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({
        title: stripTags(m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "") ?? ""),
        department: m[1].match(/<tt:department>([\s\S]*?)<\/tt:department>/)?.[1] ?? null,
        location: null,
        url: m[1].match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? null,
      }));
      return { api, roles };
    }
  }
  throw new Error(`unknown board ${kind}`);
}

// Dedupe by full title (same role posted in several cities counts once); drop gender tags like (m/w/d).
/** Probe public board APIs with likely tokens. Greenhouse returns the board's name, so it can be verified. */
async function guessBoard(company: string, domain: string): Promise<{ kind: string; token: string; verified: boolean } | null> {
  const label = domain.split(".")[0].toLowerCase();
  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const tokens = [...new Set([slug, label, company.toLowerCase().replace(/[^a-z0-9]+/g, "-")])].filter((t) => t.length > 1);
  const same = (a: string) => a.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(slug);
  for (const t of tokens) {
    try {
      const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${t}`);
      if (j?.name) return { kind: "greenhouse", token: t, verified: same(j.name) };
    } catch {}
  }
  for (const t of tokens) {
    for (const [kind, url] of [
      ["ashby", `https://api.ashbyhq.com/posting-api/job-board/${t}`],
      ["lever", `https://api.lever.co/v0/postings/${t}?mode=json&limit=1`],
    ] as const) {
      try {
        const j = await getJson(url);
        const n = kind === "ashby" ? (j.jobs ?? []).length : (j ?? []).length;
        if (n > 0) return { kind, token: t, verified: false };
      } catch {}
    }
  }
  return null;
}

const normTitle = (t: string) =>
  t
    .toLowerCase()
    .replace(/\((m\/w\/d|m\/f\/d|f\/m\/d|w\/m\/d|all genders)\)/g, "")
    .replace(/\bsr\.?(?=\s)/g, "senior")
    .replace(/\bjr\.?(?=\s)/g, "junior")
    .replace(/\s+/g, " ")
    .trim();

// Not actual openings: talent pools, open applications.
const NOT_A_ROLE = /(talent (community|pool|network)|general application|open application|spontaneous application|initiativbewerbung|future opportunities)/i;

function inFunction(r: Role, fn: string): boolean {
  const re = FUNCTION_RE[fn];
  if (!re) return false;
  if (fn === "engineering" && /(program manag|analyst|recruit)/i.test(r.title)) return false;
  if (r.department) {
    const others = Object.entries(FUNCTION_RE).filter(([k, other]) => k !== fn && other.test(r.department!)).length;
    if (re.test(r.department) && others === 0) return true;
    if (re.test(r.department)) return re.test(r.title); // e.g. "Data Engineering & Analytics": decide by title
    // the department clearly belongs to another function (e.g. "Design"): trust it over title keywords
    if (Object.entries(FUNCTION_RE).some(([k, other]) => k !== fn && other.test(r.department!))) return false;
  }
  return re.test(r.title);
}

export async function checkHiring(ctx: CheckContext): Promise<CheckResult> {
  const fn = ctx.params.job_function ?? "engineering";
  const min = ctx.params.min_roles ?? 1;
  const site = await discoverSite(ctx.domain, { fresh: ctx.fresh });
  const sources: SourceChecked[] = [];
  let boards = [...site.jobBoards];
  let careersPage = null as Awaited<ReturnType<typeof getPage>> | null;

  // careers page: may link the job board
  if (site.careers[0]) {
    careersPage = await getPage(site.careers[0], { html: true, fresh: ctx.fresh });
    sources.push({ url: careersPage.url, source_type: "founder_controlled", ok: careersPage.ok, note: careersPage.ok ? "careers page scraped" : "failed" });
    if (careersPage.ok && !boards.length) {
      const html = careersPage.html;
      for (const b of JOB_BOARDS) {
        const m = html.match(b.re);
        if (m) boards.push({ kind: b.kind, token: m[1], url: m[0] });
      }
    }
  }
  // no careers link on the homepage (often client-rendered): try the conventional path
  if (!site.careers[0] && !boards.length) {
    const guess = await getPage(`https://${ctx.domain}/careers`, { html: true, fresh: ctx.fresh });
    if (guess.ok && /job|career|position|role|join/i.test(guess.markdown.slice(0, 5000))) {
      careersPage = guess;
      sources.push({ url: guess.url, source_type: "founder_controlled", ok: true, note: "careers page found at /careers" });
      for (const b of JOB_BOARDS) {
        const m = guess.html.match(b.re);
        if (m) boards.push({ kind: b.kind, token: m[1], url: m[0] });
      }
    }
  }
  // still nothing: ask the public job-board APIs directly by company name (free, deterministic)
  let guessedBoard: { kind: string; token: string; verified: boolean } | null = null;
  if (!boards.length) {
    guessedBoard = await guessBoard(ctx.company, ctx.domain);
    if (guessedBoard) {
      boards.push({ kind: guessedBoard.kind, token: guessedBoard.token, url: `${guessedBoard.kind}:${guessedBoard.token}` });
      sources.push({
        url: `${guessedBoard.kind}:${guessedBoard.token}`, source_type: "platform", ok: true,
        note: guessedBoard.verified ? "board found by company name (board name matches)" : "board found by name only: needs review",
      });
    }
  }
  boards = boards.filter((b, i) => boards.findIndex((x) => x.kind === b.kind && x.token === b.token) === i);

  const all: (Role & { source: string })[] = [];
  for (const b of boards) {
    try {
      const { api, roles } = await readBoard(b.kind, b.token);
      roles.forEach((r) => all.push({ ...r, source: api }));
      sources.push({ url: api, source_type: "platform", ok: true, note: `${b.kind}: ${roles.length} open roles` });
    } catch (e) {
      sources.push({ url: b.url, source_type: "platform", ok: false, note: `${b.kind}: ${(e as Error).message}` });
    }
  }

  let sourceType: "platform" | "founder_controlled" = "platform";
  if (!all.length && careersPage?.ok) {
    // fallback: the company's own careers site. Follow its job-listing page if the index links one,
    // then count links that point at individual job pages (/jobs/<id>, /positions/<slug>, ...).
    sourceType = "founder_controlled";
    const LISTING = /\/(jobs|positions|open-positions|openings|vacancies|roles|join-us)\/?$/i;
    const DETAIL = /\/(jobs?|positions?|openings|vacancies|roles|careers)\/[^?#]*[\w-]{3,}/i;
    let page = careersPage;
    const listing = extractLinks(page.html, page.url).find((l) => LISTING.test(new URL(l.href).pathname) && l.href !== page.url);
    if (listing) {
      const lp = await getPage(listing.href, { html: true, fresh: ctx.fresh });
      sources.push({ url: lp.url, source_type: "founder_controlled", ok: lp.ok, note: lp.ok ? "job listing page scraped" : "failed" });
      if (lp.ok) page = lp;
    }
    for (const l of extractLinks(page.html, page.url)) {
      const path = new URL(l.href).pathname;
      // link text often carries "Title / Team / Location" in separate elements: the first chunk is the title
      const title = l.first.length >= 5 ? l.first : l.text;
      if (DETAIL.test(path) && !LISTING.test(path) && title.length > 4 && title.length < 140) {
        all.push({ title, department: null, location: null, url: l.href, source: page.url });
      }
    }
  }

  const seen = new Set<string>();
  const matched = all.filter((r) => !NOT_A_ROLE.test(r.title) && inFunction(r, fn)).filter((r) => {
    const k = normTitle(r.title);
    return k && !seen.has(k) && seen.add(k);
  });
  const passes = matched.length >= min;
  const srcUrl = matched[0]?.source ?? boards[0]?.url ?? careersPage?.url ?? site.home.url;
  const excerpt = `${matched.length} open ${fn} role(s) (deduped by title)${matched.length ? ": " + matched.slice(0, 8).map((r) => r.title).join("; ") : ""}`;
  const evidence: EvidenceCandidate[] = matched.length
    ? [{
        url: srcUrl, source_type: sourceType, excerpt, snapshot_time: now(),
        content_hash: sha256(`hiring:${fn}:${[...seen].sort().join("|")}`),
        rule_passed: passes ? `${matched.length} open ${fn} roles ≥ ${min}` : null,
        passes, details: { roles: matched.slice(0, 50), total_open_roles: all.length },
      }]
    : [];
  const unverifiedGuess = guessedBoard && !guessedBoard.verified;
  if (unverifiedGuess && evidence[0]) {
    evidence[0].passes = false; // a board we only matched by name can't confirm on its own
    evidence[0].rule_passed = null;
  }
  return {
    status: passes ? (unverifiedGuess ? "needs_review" : sourceType === "platform" ? "confirmed" : "reported") : "watching",
    summary: `${matched.length} open ${fn} roles seen (need ${min})${boards.length ? "" : all.length ? ", careers page only" : ", no job board found"}`,
    evidence,
    sources,
    observations: { boards: boards.map((b) => `${b.kind}:${b.token}`), total_roles: all.length, matched: matched.length },
  };
}
