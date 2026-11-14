import { context } from "./context";

/** "Nordwind | Route planning" -> "Nordwind" */
export const nameFromTitle = (title: string) => title.split(/\s[|–—:-]\s/)[0].trim();

export async function brandFor(domain: string, homeTitle?: Promise<string>): Promise<{ name: string; logo_url: string | null }> {
  const fallback = async () =>
    nameFromTitle((await homeTitle?.catch(() => "")) ?? "") || domain.split(".")[0].replace(/^./, (c) => c.toUpperCase());
  try {
    const r = await context.brand(domain);
    const logos = r.brand.logos ?? [];
    const logo = logos.find((l) => l.type === "icon") ?? logos.find((l) => l.mode !== "dark") ?? logos[0];
    // brand titles are sometimes "Name | tagline": keep the name part
    const name = nameFromTitle(r.brand.title ?? "") || (await fallback());
    return { name, logo_url: logo?.url ?? null };
  } catch {
    return { name: await fallback(), logo_url: null };
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
