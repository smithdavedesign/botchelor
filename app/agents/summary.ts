/**
 * A one-line summary of an MCP tool's description, for the collapsed row on /agents (the full text sits inside it).
 * Descriptions lead with what a call costs ("Free.", "Costs one date…"); the summary skips that to the first sentence
 * that says what the tool does, and stops at about a dozen words.
 */
const COST = /^(free\b|costs\b|counts\b|accept: true costs\b)/i;

export function toolSummary(description: string, maxWords = 12): string {
  const sentences = description
    .replace(/\s+/g, " ")
    .trim()
    // a sentence ends at ". " before a capital, a digit, a quote or a bracket — not inside "e.g. x" or "v1.2"
    .split(/(?<=[.!?])\s+(?=["'(A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const first = sentences.find((s) => !COST.test(s)) ?? sentences[0] ?? "";
  const words = first.split(" ");
  if (words.length <= maxWords) return first.replace(/[.:;,]+$/, "");
  return `${words.slice(0, maxWords).join(" ").replace(/[\s.:;,(—–-]+$/, "")}…`;
}

/** The most words a tool group's card title takes on /agents; the rest of a long title is the card's first line. */
export const GROUP_TITLE_MAX_WORDS = 4;

/**
 * The groups whose title, brackets aside, still runs past GROUP_TITLE_MAX_WORDS (lib/agents.ts AGENT_TOOL_GROUPS keeps
 * the long form for llms.txt and the tests): the short title the card wears, and where the title's words went.
 */
const SHORT_TITLES: Record<string, { title: string; caveat?: string }> = {
  "Dates on the show's model": { title: "Show-model dates" },
  "Tell the makers what you think": { title: "Tell the makers", caveat: "What you think, good and bad." },
  "Bring your own model": { title: "Bring your own model", caveat: "Also known as BYOK." },
};

/**
 * A tool group's heading on /agents (the 2026-11-13 lift: a grid of cards wants short titles): the title in at most
 * GROUP_TITLE_MAX_WORDS words, and the caveat its long title carried in brackets ("Text after the date (free,
 * unlimited)") as a sentence for the card's first line, so every word stays on the page.
 */
export function groupHeading(full: string): { title: string; caveat: string | null } {
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(full.trim());
  const base = (m ? m[1] : full).trim();
  const bracket = m ? m[2].trim() : "";
  const short = SHORT_TITLES[base];
  const sentence = bracket ? `${bracket[0].toUpperCase()}${bracket.slice(1)}${/[.!?]$/.test(bracket) ? "" : "."}` : "";
  return { title: short?.title ?? base, caveat: short?.caveat ?? (sentence || null) };
}
