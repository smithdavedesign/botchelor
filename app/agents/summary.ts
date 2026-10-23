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
