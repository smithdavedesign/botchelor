/**
 * Prompt v2.6, from undressing on: the aside check, the tic guard and the quotes' owners.
 *
 * David's Chud × Juniper night, replayed on v2.5 (#747): 43% of her lines from undressing on were still dry or technical
 * asides (the target is about one in six), the sea crept back in words no sheet has (tide, storm front, squall, fog), she
 * said "'Kay." nine times, and twice she said a line the owner's Direct steer had quoted for Chud.
 *
 * - The aside check (asideMessages, parseAsideReply, asidesToRewrite, checkAsides): one extra short call after each reply,
 *   on the same After Dark text model, that marks which lines are commentary rather than desire, feeling or action (a
 *   deadpan remark, a joke, a metaphor from the sea, the weather, machinery, jobs or reports) and gives a plain rewrite
 *   of each new one it marks. Past about one line in ASIDE_EVERY of a speaker's (the batch and their recent lines), the
 *   excess new ones take their rewrite. It fails open: an error, a timeout or a reply it can't read keeps the lines as
 *   written. lib/adult/scenes.ts runs every rewrite through the guards a written line goes through.
 * - The tic guard (ticsIn, overusedTics): the same short interjection by one speaker ("'Kay.") past TIC_CAP times a
 *   chapter loses that sentence; and a speaker whose recent lines were mostly only an action is told so (the prompt).
 * - The quotes' owners (misattributedQuote, withoutQuote): a Direct steer's quote meant for one of them, said by the
 *   other, is taken out of that line (scenes.ts moves it to the right speaker's next line when it can).
 *
 * Pure except checkAsides, which makes the one call.
 */
import type { ChatMessage, Model, ModelOptions } from "../model";
import { speechOf } from "./continuity";
import { quoteOverlap, QUOTE_KEPT_SHARE, type SteerQuote } from "./quotes";

type Line = { who: "a" | "b"; text: string };

// ---------------------------------------------------------------------------------------------------------------------
// The aside check
// ---------------------------------------------------------------------------------------------------------------------

/** About one of a speaker's lines in ASIDE_EVERY may be an aside (v2.5's prompt rationed them to the same share). */
export const ASIDE_EVERY = 6;
/** How many of the scene's lines before the batch the check reads, so the share counts recent history too. */
export const ASIDE_HISTORY = 12;
/** The check's hard time limit: past it the step keeps its lines as written (a step stays fast). */
export const ASIDE_TIMEOUT_MS = 6000;
/** The check's reply ceiling: a few labels and a rewrite or two. */
export const ASIDE_REPLY_TOKENS = 500;
/** The longest rewrite taken (a rewrite is about as long as the line it replaces). */
const REWRITE_MAX = 400;

/** What a line does (its leading *action*), and what it says. */
export function splitLine(text: string): { action: string; speech: string } {
  const action = /^\s*\*[^*]+\*/.exec(text)?.[0]?.trim() ?? "";
  return { action, speech: text.slice(text.indexOf(action) + action.length).trim() };
}

/** Whether a line says anything out loud (an action-only line is never an aside). */
export const saysSomething = (text: string): boolean => speechOf(text).length > 0;

const ASIDE_SYSTEM = [
  "You are an editor checking lines from a private, adults-only scene between two consenting adults. You check one thing: dry or technical asides.",
  "An aside is a line whose words are commentary on what's happening rather than desire, feeling or action: a deadpan remark, a joke, a wry observation, an observer's or technician's word for it, or a metaphor or comparison from the sea, the weather, machinery, jobs or reports (a tide, a storm front, a squall, fog, engines, an inspection, a protocol, a report).",
  "A line that says what they feel, want or do, plainly, is not an aside, however short or flat it is. Neither is a line that is only an action.",
  "For each NEW line (N1, N2…) you mark, write what it says again, plainly: the same speaker, the same intent, the same heat and about the same length, in their own rhythm, saying what they feel, want or do. Write only the words they say, not the action. Add nothing: no new act, no new body part, no one else, nothing more explicit than the line was, and nothing from the sea, the weather, machinery, jobs or reports. Keep any words in quotes from the owner's steer exactly as they are.",
  'Reply with JSON only, nothing else: {"asides": ["H3", "N2"], "rewrites": {"N2": "the plain line"}}. "asides" lists every line, H or N, that is an aside; "rewrites" has one entry for each N line in "asides".',
].join("\n");

/** The check's two messages: the rules, then the recent lines (H…) and the new ones (N…), each with its speaker. */
export function asideMessages(history: readonly Line[], batch: readonly Line[], names: { a: string; b: string }, quotes: readonly SteerQuote[] = []): ChatMessage[] {
  const first = (who: "a" | "b") => names[who].split(/\s+/)[0];
  const row = (tag: string, l: Line) => `${tag} ${first(l.who)}: ${l.text.replace(/\s+/g, " ").trim()}`;
  const user = [
    history.length ? `Recent lines:\n${history.map((l, i) => row(`H${i + 1}`, l)).join("\n")}` : "",
    `New lines:\n${batch.map((l, i) => row(`N${i + 1}`, l)).join("\n")}`,
    quotes.length ? `The owner's steer quoted these words, which stay as they are: ${quotes.map((q) => `"${q.text}"`).join(", ")}.` : "",
    "Reply with the JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    { role: "system", content: ASIDE_SYSTEM },
    { role: "user", content: user },
  ];
}

export type AsideReply = { history: Set<number>; batch: Set<number>; rewrites: Map<number, string> };

/**
 * The check's reply: which history lines (H, 0-based) and new lines (N, 0-based) are asides, and the rewrites of the new
 * ones. Null when it can't be read (the step then keeps its lines: fail-open).
 */
export function parseAsideReply(raw: string, historyLen: number, batchLen: number): AsideReply | null {
  const t = raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
  const from = t.indexOf("{");
  const to = t.lastIndexOf("}");
  if (from < 0 || to <= from) return null;
  let j: { asides?: unknown; rewrites?: unknown };
  try {
    j = JSON.parse(t.slice(from, to + 1)) as { asides?: unknown; rewrites?: unknown };
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || !Array.isArray(j.asides)) return null;
  const tag = (x: unknown): { kind: "H" | "N"; i: number } | null => {
    const m = /^\s*([HN])\s*(\d+)\s*$/i.exec(String(x));
    if (!m) return null;
    const kind = m[1].toUpperCase() as "H" | "N";
    const i = Number(m[2]) - 1;
    return i >= 0 && i < (kind === "H" ? historyLen : batchLen) ? { kind, i } : null;
  };
  const out: AsideReply = { history: new Set(), batch: new Set(), rewrites: new Map() };
  for (const x of j.asides) {
    const t2 = tag(x);
    if (t2) (t2.kind === "H" ? out.history : out.batch).add(t2.i);
  }
  if (j.rewrites && typeof j.rewrites === "object" && !Array.isArray(j.rewrites)) {
    for (const [k, v] of Object.entries(j.rewrites as Record<string, unknown>)) {
      const t2 = tag(k);
      if (!t2 || t2.kind !== "N" || typeof v !== "string") continue;
      // Only what they say: a stray *action* or a speaker's name in front comes off.
      const text = v
        .replace(/\*[^*]*\*/g, " ")
        .replace(/^\s*[\p{L}' ]{1,30}:\s+/u, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^["“]|["”]$/g, "");
      if (text && text.length <= REWRITE_MAX) out.rewrites.set(t2.i, text);
    }
  }
  return out;
}

/**
 * How many of a speaker's `n` lines may be asides: one in ASIDE_EVERY, rounded down, and at least one. (Rounded to the
 * nearest, the first replay landed at one in four: the check doesn't mark every aside, so the share it holds is a floor.)
 */
export const asideAllowance = (n: number): number => Math.max(1, Math.floor(n / ASIDE_EVERY));

/**
 * The new lines (batch indices) to take their rewrite: per speaker, their recent lines and their new ones that say
 * something, and past asideAllowance of those, the newest marked asides of the batch (the history's asides already used
 * the share). `keep` says which new lines can't be rewritten (a quoted steer line, a move): they count, but stay.
 */
export function asidesToRewrite(history: readonly Line[], batch: readonly Line[], marked: AsideReply, keep: (i: number) => boolean = () => false): number[] {
  const out: number[] = [];
  for (const who of ["a", "b"] as const) {
    const hist = history.map((l, i) => ({ l, i })).filter((x) => x.l.who === who && saysSomething(x.l.text));
    const mine = batch.map((l, i) => ({ l, i })).filter((x) => x.l.who === who && saysSomething(x.l.text));
    const asides = hist.filter((x) => marked.history.has(x.i)).length + mine.filter((x) => marked.batch.has(x.i)).length;
    let excess = asides - asideAllowance(hist.length + mine.length);
    for (const x of [...mine].reverse()) {
      if (excess <= 0) break;
      if (!marked.batch.has(x.i) || keep(x.i) || !marked.rewrites.has(x.i)) continue;
      out.push(x.i);
      excess--;
    }
  }
  return out.sort((x, y) => x - y);
}

/** A rewrite put back on its line: the line's own action, then the plain words. */
export function withRewrite(text: string, rewrite: string): string {
  const { action } = splitLine(text);
  return `${action ? `${action} ` : ""}${rewrite}`.trim();
}

export type AsideCheck = {
  /** Proposed lines: each batch index with the rewrite (action kept); scenes.ts guards them before using any. */
  proposed: Map<number, string>;
  /** How many lines the check marked as asides (history and new), for the step's flags. */
  marked: number;
  failed: boolean;
  ms: number;
  /** Why it failed (a timeout, an error, an unreadable reply), for the log. */
  reason?: string;
};

/**
 * The one extra call: marks the asides and proposes rewrites for the excess. Fail-open: any error, a reply it can't
 * read, or ASIDE_TIMEOUT_MS gone by, and nothing is proposed.
 */
export async function checkAsides(
  model: Model,
  input: { history: readonly Line[]; batch: readonly Line[]; names: { a: string; b: string }; quotes?: readonly SteerQuote[]; keep?: (i: number) => boolean },
  opts: { timeoutMs?: number; onUsage?: ModelOptions["onUsage"]; onServed?: ModelOptions["onServed"]; now?: () => number } = {},
): Promise<AsideCheck> {
  const now = opts.now ?? Date.now;
  const t0 = now();
  const fail = (reason: string): AsideCheck => ({ proposed: new Map(), marked: 0, failed: true, ms: now() - t0, reason });
  if (!input.batch.some((l) => saysSomething(l.text))) return { proposed: new Map(), marked: 0, failed: false, ms: 0 };
  const history = input.history.slice(-ASIDE_HISTORY);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), opts.timeoutMs ?? ASIDE_TIMEOUT_MS);
    });
    const raw = await Promise.race([
      model.complete(asideMessages(history, input.batch, input.names, input.quotes ?? []), {
        temperature: 0.3,
        maxTokens: ASIDE_REPLY_TOKENS,
        ...(opts.onUsage ? { onUsage: opts.onUsage } : {}),
        ...(opts.onServed ? { onServed: opts.onServed } : {}),
      }),
      timeout,
    ]);
    const marked = parseAsideReply(raw, history.length, input.batch.length);
    if (!marked) return fail("unreadable reply");
    const proposed = new Map<number, string>();
    for (const i of asidesToRewrite(history, input.batch, marked, input.keep)) proposed.set(i, withRewrite(input.batch[i].text, marked.rewrites.get(i)!));
    return { proposed, marked: marked.history.size + marked.batch.size, failed: false, ms: now() - t0 };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "error");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The tic guard
// ---------------------------------------------------------------------------------------------------------------------

/** The same short interjection more than this many times a chapter, by one speaker, is a tic ("'Kay." nine times). */
export const TIC_CAP = 2;
/** An interjection: a sentence of at most this many words. */
const TIC_WORDS = 2;

/** The sentences of what a line says (its action out). */
const spokenSentences = (text: string): string[] => splitLine(text).speech.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);

/** The short interjections a line says, normalised ("'Kay." → "kay"), once per sentence. */
export function ticsIn(text: string): string[] {
  return spokenSentences(text)
    .map((s) => speechOf(s).replace(/^'+|'+$/g, "").replace(/(?<=\s)'+|'+(?=\s)/g, ""))
    .filter((s) => s && s.split(" ").length <= TIC_WORDS);
}

/**
 * The line without the interjections its speaker has already said TIC_CAP times this chapter (counting the ones before
 * it in this line), or null when nothing would be left; an action stays, even alone. `seen` is their chapter so far.
 * Words the owner's steer or a whisper says are theirs to ask for, so never cut.
 */
export function withoutTics(text: string, seen: readonly string[], allowed: readonly string[] = []): { text: string | null; cut: string[] } {
  const counts = new Map<string, number>();
  for (const l of seen) for (const t of ticsIn(l)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const free = new Set(allowed.flatMap((s) => speechOf(s).split(" ")).filter(Boolean));
  const { action, speech } = splitLine(text);
  if (!speech) return { text, cut: [] };
  const cut: string[] = [];
  const kept = speech
    .split(/(?<=[.!?…])\s+/)
    .filter((s) => {
      const t = ticsIn(s)[0];
      if (!t || t.split(" ").every((w) => free.has(w))) return true;
      const n = counts.get(t) ?? 0;
      counts.set(t, n + 1);
      if (n < TIC_CAP) return true;
      cut.push(t);
      return false;
    })
    .join(" ")
    .trim();
  if (!cut.length) return { text, cut };
  const out = `${action}${action && kept ? " " : ""}${kept}`.trim();
  return { text: out || null, cut };
}

/** The interjections a speaker has said TIC_CAP times or more this chapter: what the prompt names, like a worn phrase. */
export function overusedTics(lines: readonly Line[], who: "a" | "b"): string[] {
  const counts = new Map<string, number>();
  for (const l of lines) if (l.who === who) for (const t of ticsIn(l.text)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n >= TIC_CAP).sort((x, y) => y[1] - x[1]).map(([t]) => t);
}

/** Of a speaker's last ACTION_ONLY_WINDOW lines, this many only an action, and their next ones are told to say something. */
export const ACTION_ONLY_WINDOW = 6;
export const ACTION_ONLY_MAX = 3;

/** How many of a speaker's last ACTION_ONLY_WINDOW lines were only an action. */
export function actionOnlyRun(lines: readonly Line[], who: "a" | "b"): number {
  return lines
    .filter((l) => l.who === who)
    .slice(-ACTION_ONLY_WINDOW)
    .filter((l) => !saysSomething(l.text)).length;
}

// ---------------------------------------------------------------------------------------------------------------------
// The quotes' owners
// ---------------------------------------------------------------------------------------------------------------------

/** The quote a line says that the steer gave to the other one of them (by name), or null. */
export function misattributedQuote(quotes: readonly SteerQuote[], line: Line): SteerQuote | null {
  return quotes.find((q) => q.who !== null && q.who !== line.who && quoteOverlap(q.text, splitLine(line.text).speech) >= QUOTE_KEPT_SHARE) ?? null;
}

/**
 * The line without the sentences that say the quote (their words mostly the quote's), and those sentences: what can move
 * to the right speaker. When cutting sentences doesn't take the quote out (it runs through them), all of it goes.
 */
export function withoutQuote(text: string, quote: string): { text: string | null; said: string } {
  const { action, speech } = splitLine(text);
  const parts = speech.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const inQuote = (s: string) => quoteOverlap(s, quote) >= 0.5 && quoteOverlap(quote, s) > 0;
  let rest = parts.filter((s) => !inQuote(s));
  let said = parts.filter(inQuote);
  if (quoteOverlap(quote, rest.join(" ")) >= QUOTE_KEPT_SHARE || !said.length) {
    said = parts;
    rest = [];
  }
  const out = `${action}${action && rest.length ? " " : ""}${rest.join(" ")}`.trim();
  return { text: out || null, said: said.join(" ") };
}
