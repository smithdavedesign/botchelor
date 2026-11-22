/**
 * Who a character was when a date was filmed, when that isn't who they are now. A date's lines are written once and
 * kept, with the names and pronouns of the day; a character renamed since (the 2026-11-02 recast of the show's own
 * agent-made characters, or an owner's edit) would otherwise sit over lines that call them something else (2026-11-22
 * audit: "Thorne Bracken × Juniper Vale" over "Hi, I'm Vesper"). The date's page says so (app/episodes/[id]/page.tsx),
 * from the sheet the date kept (setup.sheet_a/b), and the recast keeps the name and pronouns of a character with dates
 * (app/api/admin/recast/route.ts). Pure.
 */
export type FilmedAs = { name: string; pronouns: string | null };

const same = (x: string | null | undefined, y: string | null | undefined): boolean => (x ?? "").trim().toLowerCase() === (y ?? "").trim().toLowerCase();

/** The first word of a name: the one a date's lines call them by ("Hi, I'm Vesper"). */
export const firstNameOf = (name: string): string => name.trim().split(/\s+/)[0] ?? "";

/**
 * The sheet as the date filmed it against today's name and pronouns: the old name (and the old pronouns, when those
 * changed), or null when nothing a viewer would notice changed. A date with no kept sheet (older ones) can't tell.
 */
export function filmedAs(sheet: { name?: string | null; pronouns?: string | null } | null | undefined, now: { name: string; pronouns?: string | null }): FilmedAs | null {
  const was = sheet?.name?.trim();
  if (!was) return null;
  const pronouns = sheet?.pronouns?.trim() || null;
  const renamed = !same(was, now.name);
  const repronouned = Boolean(pronouns && now.pronouns?.trim()) && !same(pronouns, now.pronouns);
  if (!renamed && !repronouned) return null;
  return { name: was, pronouns: repronouned ? pronouns : null };
}

/** The line the date's page shows under its title. */
export function filmedAsLine(now: string, was: FilmedAs): string {
  if (same(was.name, now)) return `${now} went by ${was.pronouns} when this date was filmed.`;
  return `${now} was called ${was.name}${was.pronouns ? ` (${was.pronouns})` : ""} when this date was filmed.`;
}

/** Whether an edit would change what a character's dates call them: their first name, or their pronouns. */
export function changesFilmedName(now: { name: string; pronouns: string | null }, patch: { name?: unknown; pronouns?: unknown }): boolean {
  const name = typeof patch.name === "string" ? patch.name : null;
  const pronouns = typeof patch.pronouns === "string" ? patch.pronouns : null;
  return (name !== null && !same(firstNameOf(name), firstNameOf(now.name))) || (pronouns !== null && !same(pronouns, now.pronouns));
}
