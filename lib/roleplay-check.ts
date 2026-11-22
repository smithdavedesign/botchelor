/**
 * Checking a roleplay someone wrote for a date (lib/roleplays.ts is the catalog and the picker's helpers): the server's,
 * since it runs the content filter (lib/safety.ts), whose word lists the picker's code in the browser doesn't need
 * (2026-11-22 audit). The routes that take one (lib/date-roleplays.ts, the Create library) call it.
 */
import { DATE_ROLEPLAY_NEVER, suggestiveIn } from "./roleplays";
import { checkShowText, excludedTheme } from "./safety";

/**
 * A roleplay written for a date (or saved safe in the Create library, lib/studio/library.ts): PG, adults, no real people,
 * nothing suggestive and none of the never-list. Null when it's fine.
 */
export function checkCustomRoleplay(t: { title: string; premise: string; roles: [string, string] | null }): string | null {
  const fields = { title: t.title, premise: t.premise, ...(t.roles ? { role_a: t.roles[0], role_b: t.roles[1] } : {}) };
  const r = checkShowText(fields);
  if (!r.ok) {
    return r.reason === "minor"
      ? "That roleplay can't be used: everyone in it is an adult, with nothing suggesting otherwise."
      : r.reason === "real_person"
        ? "That roleplay can't be used: no real or famous people (made-up ones are fine)."
        : "That roleplay can't be used: the show is PG, so nothing sexual and no innuendo.";
  }
  const all = Object.values(fields).join(" ");
  const suggestive = suggestiveIn(all);
  if (suggestive) return `That roleplay can't be used: the show is PG, so nothing sexual and no innuendo ("${suggestive}").`;
  if (excludedTheme(all) || DATE_ROLEPLAY_NEVER.test(all)) {
    return "That roleplay can't be used: two adults who both want to be there, never family, school or a babysitter, nobody with a say over the other's job, and nobody drunk, trapped or kept from saying no.";
  }
  return null;
}
