// "Since you passed" block (Cala). Filled in by the Cala step; until then (or with no Cala match) it is hidden.
export type CalaBlock = { items: { text: string; source: string | null; url: string | null }[] };

export async function getCalaBlock(_startupId: number, _metOn: string | null): Promise<CalaBlock | null> {
  return null;
}
