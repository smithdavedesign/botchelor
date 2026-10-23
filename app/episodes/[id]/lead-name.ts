/**
 * A line the writer started with the character's own name ("Mira Quell wants a second date…"), without that name, so
 * a page that puts the name (with its face) in front doesn't say it twice. The full name first, then the first name;
 * null when the line doesn't start with either, and the caller puts the name before it as a label. Pure.
 */
export function withoutLeadName(text: string, name: string): string | null {
  const first = name.split(/\s+/)[0];
  for (const n of [name, first]) {
    if (!n) continue;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = text.match(new RegExp(`^\\s*${esc}(?:'s)?\\b`, "i"));
    if (m) {
      // Keep a possessive with the name's place ("Mira's goal…" → "'s goal…").
      const possessive = /'s$/i.test(m[0]);
      return (possessive ? "'s" : "") + text.slice(m[0].length);
    }
  }
  return null;
}
