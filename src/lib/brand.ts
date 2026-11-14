import { context } from "./context";

export async function brandFor(domain: string): Promise<{ name: string; logo_url: string | null }> {
  const fallback = domain.split(".")[0].replace(/^./, (c) => c.toUpperCase());
  try {
    const r = await context.brand(domain);
    const logos = r.brand.logos ?? [];
    const logo = logos.find((l) => l.type === "icon") ?? logos.find((l) => l.mode !== "dark") ?? logos[0];
    // brand titles are sometimes "Name | tagline": keep the name part
    const name = (r.brand.title ?? "").split(/\s[|–—:-]\s/)[0].trim() || fallback;
    return { name, logo_url: logo?.url ?? null };
  } catch {
    return { name: fallback, logo_url: null };
  }
}

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
}
