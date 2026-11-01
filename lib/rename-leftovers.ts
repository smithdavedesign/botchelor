/**
 * After a rename, the free text that still says the old name (#1160, the 2026-10-31-1838 run: renamed from Caspian, the
 * voice's sign-off "Yours, for now, C." kept turning up in its dates). Only the text the show's model reads is checked,
 * and nothing is changed: the reply names each field and what it found, and the owner rewrites it. Pure.
 */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const firstOf = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/** The text fields read, by the name the reply gives them; extras are read as their text values. */
export type RenameFields = Record<string, string | null | undefined>;

/** Text values inside extras (prompt answers, sample lines, hobbies, facts), flattened, keyed "extras.<key>". */
export function extrasText(extras: unknown): RenameFields {
  const out: RenameFields = {};
  if (!extras || typeof extras !== "object") return out;
  const walk = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(walk) : v && typeof v === "object" ? Object.values(v).flatMap(walk) : []);
  for (const [k, v] of Object.entries(extras as Record<string, unknown>)) {
    const text = walk(v).join("\n");
    if (text) out[`extras.${k}`] = text;
  }
  return out;
}

/** One warning per field that still says the old full name, the old first name, or (in the voice and lines) its initial as a sign-off. */
export function renameLeftovers(oldName: string, newName: string, fields: RenameFields): string[] {
  const was = oldName.trim();
  if (!was || was.toLowerCase() === newName.trim().toLowerCase()) return [];
  const oldFirst = firstOf(was);
  const newFirst = firstOf(newName);
  const checks: { label: string; re: RegExp; signOff?: true }[] = [{ label: `'${was}'`, re: new RegExp(`\\b${escape(was)}\\b`, "i") }];
  if (oldFirst.length >= 3 && oldFirst.toLowerCase() !== newFirst.toLowerCase() && oldFirst.toLowerCase() !== was.toLowerCase())
    checks.push({ label: `'${oldFirst}'`, re: new RegExp(`\\b${escape(oldFirst)}\\b`, "i") });
  const initial = oldFirst.charAt(0).toUpperCase();
  if (initial && initial !== newFirst.charAt(0).toUpperCase()) checks.push({ label: `'${initial}.' (a sign-off)`, re: new RegExp(`(?:^|[\\s,—–-])${escape(initial)}\\.(?=\\s*(?:$|["”']))`, "m"), signOff: true });
  const out: string[] = [];
  for (const [field, text] of Object.entries(fields)) {
    if (!text) continue;
    const found = checks.filter((c) => (!c.signOff || field === "voice" || field.startsWith("extras.")) && c.re.test(text)).map((c) => c.label);
    if (found.length) out.push(`${field} still says ${found.join(" and ")}, the old name: the dates read it, so rewrite it if it should go.`);
  }
  return out;
}
