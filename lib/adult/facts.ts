/**
 * After Dark's structured memory (David, 2026-10-21: after a night the memory was "two generic sentences… your hearts
 * intertwined", with no facts in it). When a chapter closes or a night is saved, one small call on the After Dark text
 * model (temperature 0.3, JSON) pulls out 3 to 8 concrete facts per character about the other: who said what (quoted when
 * it can be), running jokes, pet names, promises, likes, boundaries, things that happened. No vibes. They're kept in
 * adult_facts, deduped against what's there, about FACTS_PER_PAIR a character-pair (the least used and oldest go first).
 *
 * Each scene step brings back FACTS_IN_PROMPT of them: the ones whose words the last few lines share, then the newest,
 * with a nudge for one never used yet. The prompt numbers them ("[F12] Sable calls Rafe “chef”"), a line's private
 * "memory" cites one, and a cited fact's uses and last_used_at go up. A citation of something that isn't in the list is
 * flagged in the metrics (lib/adult/quality.ts), never dropped.
 *
 * After Dark only: the show's PG note (lib/adult/memory.ts afterDarkNote) is untouched, and nothing here reaches a date,
 * a text or a page. Extraction, dedupe, the cap, retrieval and citation are pure, so the eval route
 * (/api/jobs/eval-after-dark, memory "extracted") runs exactly what production runs, in memory.
 *
 * A new pair has none of it (prompt v2.1; David's review of Star Dust × Sable Quist, 2026-10-21: memory null on all 59
 * lines, and whys that only said "Sable is warm"). With no facts shown and nothing remembered, the prompt lists a few of
 * each one's own sheet details instead (sheetMemories: their job, a hobby, a tell, a line of their bio), numbered [S1]…
 * for a line's memory to cite; such a citation is founded, and counted apart (lib/adult/quality.ts sheet_citations).
 */
import type { Character } from "../character";
import type { Db } from "../db";
import { publicExtras } from "../extras";
import type { ChatMessage, Model, ModelOptions } from "../model";
import { contentWords } from "../quality";
import { checkAdultText } from "../safety";
import { NEAR_DUPLICATE, overlap, speechOf } from "./continuity";
import { adultModel } from "./mode";
import { memoryFounded } from "./observer";
import { distinctiveStems, stockPhrasesIn } from "./quality";
import type { SceneLine } from "./scenes";

export const FACT_KINDS = ["said", "joke", "pet_name", "promise", "like", "boundary", "event"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/** One remembered fact: whose memory it is (character_id), about whom (other_id), and how often a line has drawn on it. */
export type AdultFact = {
  id: string;
  character_id: string;
  other_id: string;
  kind: FactKind;
  fact: string;
  quote: string | null;
  source: "after_dark" | "date";
  created_at: string;
  last_used_at: string | null;
  uses: number;
};
export type NewFact = Pick<AdultFact, "character_id" | "other_id" | "kind" | "fact" | "quote">;

export const FACT_MAX = 200;
export const QUOTE_MAX = 160;
/** Facts one extraction keeps per character, at most. */
export const FACTS_PER_SIDE = 8;
/** Facts kept per character-pair (one character's memory of the other). */
export const FACTS_PER_PAIR = 40;
/** Facts a scene step shows, and the lines it matches them against. */
export const FACTS_IN_PROMPT = 6;
export const RECENT_LINES = 8;
/** Fewer lines than this aren't worth a call (rememberAfterDark's threshold too). */
export const MIN_LINES_TO_EXTRACT = 6;
const EXTRACT_REPLY_TOKENS = 1200;

const first = (c: Character) => c.name.split(/\s+/)[0];

/**
 * v2.1 (Cass × Chud's first chapter on prod, 2026-10-21: all ten facts were kind "said", quote dumps like `Chud says "A
 * puzzle, huh?…"`, while "Chud never reads instructions", his "captain" and her "let's not rush it" never came out):
 * "said" facts a side at most, and the example facts a reply mustn't copy (the prompt shows them in this shape).
 */
export const SAID_PER_SIDE = 2;
const exampleFacts = (a: string, b: string): { kind: FactKind; fact: string; quote: string | null }[] => [
  { kind: "like", fact: `${b} never reads instructions`, quote: "I don't bother with instructions." },
  { kind: "pet_name", fact: `${b} calls ${a} "captain"`, quote: "Aye, captain." },
  { kind: "boundary", fact: `${a} asked ${b} to take it slow`, quote: "Let's not rush it." },
  { kind: "event", fact: `They left the restaurant for ${b}'s apartment`, quote: null },
];

/** The extraction call's messages: the lines, and what to pull out of them, distilled kinds first. */
export function factMessages(a: Character, b: Character, lines: readonly SceneLine[]): ChatMessage[] {
  const nameOf = (who: "a" | "b") => (who === "a" ? a.name : b.name);
  const example = (x: string, y: string) => JSON.stringify(exampleFacts(x, y));
  return [
    {
      role: "system",
      content:
        "You keep the factual memory of a private scene between two consenting adult characters, so a writer can bring back the exact things they said and did. " +
        "Concrete facts only: never feelings, vibes or summaries.",
    },
    {
      role: "user",
      content:
        `The scene, between ${a.name} ("a") and ${b.name} ("b"):\n${lines.map((l) => `${nameOf(l.who)}: ${l.text}`).join("\n")}\n\n` +
        `For each of them, list 3 to ${FACTS_PER_SIDE} concrete things they'd remember about the other from these lines, each one distilled into a fact in the third person, in your own words: ` +
        `what the other is like or does (habits, likes and dislikes, a confession), the pet names they use, running jokes, promises and plans, boundaries they set, and things that happened (where they went, what they did). ` +
        `At most ${SAID_PER_SIDE} a side are simply something the other said, and only a line worth bringing back (a joke, a promise, a confession). ` +
        `Each "fact" is one short sentence naming who did or said what (under ${FACT_MAX} characters), never only "X says '…'". ` +
        `"quote" is the exact words from the lines that show it, when there are some (under ${QUOTE_MAX} characters, copied as written), else null. ` +
        `No feelings and no vibes ("they feel close" and "their chemistry is electric" are not facts). Kinds: ${FACT_KINDS_ORDERED.join(", ")}. ` +
        `Reply with a JSON object mixing the kinds, in this shape (these example facts are not about this scene; never copy one): ` +
        `{"a": ${example(first(a), first(b))}, "b": [...]}, ` +
        `where "a" is what ${first(a)} remembers about ${first(b)} and "b" is what ${first(b)} remembers about ${first(a)}.`,
    },
  ];
}

/** The kinds as the prompt lists them: the distilled ones first, plain quotes last. */
const FACT_KINDS_ORDERED: readonly FactKind[] = ["like", "pet_name", "joke", "promise", "boundary", "event", "said"];

/** A model's JSON, even inside a code fence or after a sentence; null when there's none. */
export function jsonOf(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)?.[1] ?? trimmed;
  for (const text of [fenced, fenced.slice(fenced.indexOf("{"), fenced.lastIndexOf("}") + 1)]) {
    if (!text) continue;
    try {
      return JSON.parse(text);
    } catch {
      /* the next shape */
    }
  }
  return null;
}

const KIND_ALIASES: Record<string, FactKind> = {
  said: "said", quote: "said", saying: "said", line: "said",
  joke: "joke", running_joke: "joke", "running joke": "joke", bit: "joke",
  pet_name: "pet_name", "pet name": "pet_name", petname: "pet_name", nickname: "pet_name", name: "pet_name",
  promise: "promise", plan: "promise", vow: "promise",
  like: "like", likes: "like", dislike: "like", preference: "like", turn_on: "like",
  boundary: "boundary", limit: "boundary", "hard limit": "boundary", no: "boundary",
  event: "event", happened: "event", moment: "event", action: "event",
};

/** Words that make a fact a feeling, not a fact, unless it quotes someone. */
const VAGUE = /\b(?:connection|chemistry|bond|bonded|closeness|spark|sparks|vibe|vibes|energy|intimacy|passion|tension|attraction|special|magical|unforgettable)\b/i;

/** Whether a "fact" is a vibe: a stock phrase, too few words of its own, or a feeling with nothing quoted. */
export function isVague(fact: string, quote: string | null, names: readonly string[]): boolean {
  if (stockPhrasesIn(fact).length) return true;
  const skip = new Set(names.flatMap((n) => n.toLowerCase().split(/\s+/)));
  const words = contentWords(fact, 4).filter((w) => !skip.has(w));
  if (words.length < 2) return true;
  return !quote && VAGUE.test(fact);
}

const clip = (s: string, max: number) => {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2)).replace(/[\s,;:—–-]+$/, "")}…`;
};

/** What a fact puts in quotation marks ("calls her "captain""): each has to be in the lines, or the fact was made up. */
const quotedIn = (fact: string): string[] => [...fact.matchAll(/["“]([^"“”]{2,80})["”]/g)].map((m) => m[1]);

/**
 * A fact that only repeats a quote (`Chud says "A puzzle, huh?…"`): a name and a speech verb, the quote, and nothing of
 * its own once those are out (v2.1).
 */
export function isQuoteDump(fact: string, names: readonly string[]): boolean {
  const lead =
    /^\s*(?:[\w'’-]+\s+){1,3}?(?:says?|said|tells?|told|asks?|asked|repl(?:y|ies|ied)|whispers?|whispered|teases?|teased|jokes?|joked|quips?|quipped|murmurs?|murmured|adds?|added)\b[\s\w,]*?[:,]?\s*(?:["“]|(?<=[\s:])['‘])/i;
  if (!lead.test(fact)) return false;
  // The quote out: double quotes, or single ones opening after a space (not the apostrophe in "It's").
  const rest = fact.replace(/["“][^"“”]*["”]?/g, " ").replace(/(^|[\s:])['‘][^'’]*(?:['’](?=[\s.,!?;:]|$)|$)/g, " ");
  const skip = new Set([...names.flatMap((n) => n.toLowerCase().split(/\s+/)), "says", "said", "tells", "told", "asks", "asked", "replies", "replied", "whispers", "whispered", "teases", "teased"]);
  return contentWords(rest, 4).filter((w) => !skip.has(w)).length < 2;
}

/**
 * The facts in an extraction reply, cleaned: a known kind, a fact of its own (no vibes, held to the two lines), a quote
 * only when it's really in the lines (else null), at most FACTS_PER_SIDE a side. v2.1: no copy of the prompt's example
 * facts, nothing in quotation marks that wasn't said, at most one fact a side that only repeats a quote (isQuoteDump,
 * kept as "said"), and at most SAID_PER_SIDE "said" facts a side.
 */
export function parseFacts(raw: string, a: Character, b: Character, lines: readonly SceneLine[]): NewFact[] {
  const j = jsonOf(raw) as Record<string, unknown> | null;
  if (!j || typeof j !== "object") return [];
  const said = ` ${lines.map((l) => speechOf(l.text.replace(/\*/g, " "))).join(" ")} `;
  const examples = new Set([...exampleFacts(first(a), first(b)), ...exampleFacts(first(b), first(a))].map((e) => norm(e.fact)));
  const out: NewFact[] = [];
  for (const [side, self, other] of [
    ["a", a, b],
    ["b", b, a],
  ] as const) {
    const list = j[side] ?? j[first(self).toLowerCase()];
    if (!Array.isArray(list)) continue;
    let n = 0;
    let saidFacts = 0;
    let dumps = 0;
    for (const item of list) {
      if (n >= FACTS_PER_SIDE || !item || typeof item !== "object") continue;
      const x = item as { kind?: unknown; fact?: unknown; quote?: unknown };
      let kind = KIND_ALIASES[String(x.kind ?? "").trim().toLowerCase()];
      if (!kind || typeof x.fact !== "string" || !x.fact.trim()) continue;
      const fact = clip(x.fact, FACT_MAX);
      const rawQuote = typeof x.quote === "string" ? x.quote.trim().replace(/^["“'‘]+|["”'’]+$/g, "") : "";
      const heard = Boolean(speechOf(rawQuote)) && said.includes(` ${speechOf(rawQuote)} `);
      const quote = heard && rawQuote.length <= QUOTE_MAX ? rawQuote : null;
      if (isVague(fact, quote, [a.name, b.name])) continue;
      if (!checkAdultText({ fact, quote: quote ?? undefined }).ok) continue;
      // v2.1: a copy of an example, or quotation marks round words nobody said.
      if (examples.has(norm(fact)) || quotedIn(fact).some((q) => !said.includes(` ${speechOf(q)} `))) continue;
      if (isQuoteDump(fact, [a.name, b.name])) {
        if (dumps >= 1) continue;
        dumps++;
        kind = "said";
      }
      if (kind === "said" && saidFacts >= SAID_PER_SIDE) continue;
      if (kind === "said") saidFacts++;
      out.push({ character_id: self.id, other_id: other.id, kind, fact, quote });
      n++;
    }
  }
  return out;
}

/** One extraction call on these lines (never throws: no facts on a failure, which `onError` hears about). */
export async function extractFacts(
  model: Model,
  a: Character,
  b: Character,
  lines: readonly SceneLine[],
  options: Pick<ModelOptions, "onUsage"> & { onError?: (err: unknown) => void } = {},
): Promise<NewFact[]> {
  if (lines.length < MIN_LINES_TO_EXTRACT) return [];
  try {
    const raw = await model.complete(factMessages(a, b, lines), { temperature: 0.3, maxTokens: EXTRACT_REPLY_TOKENS, ...(options.onUsage ? { onUsage: options.onUsage } : {}) });
    return parseFacts(raw, a, b, lines);
  } catch (err) {
    options.onError?.(err);
    return [];
  }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

type Comparable = Pick<AdultFact, "character_id" | "other_id" | "fact" | "quote">;
const sameFact = (x: Comparable, y: Comparable) =>
  x.character_id === y.character_id &&
  x.other_id === y.other_id &&
  (norm(x.fact) === norm(y.fact) || overlap(x.fact, y.fact) >= NEAR_DUPLICATE || Boolean(x.quote && y.quote && norm(x.quote) === norm(y.quote)));

/** The incoming facts that aren't already remembered (the same words, nearly, or the same quote), nor twice in the batch. */
export function dedupeFacts(incoming: readonly NewFact[], existing: readonly Comparable[]): NewFact[] {
  const out: NewFact[] = [];
  for (const f of incoming) if (!existing.some((e) => sameFact(f, e)) && !out.some((e) => sameFact(f, e))) out.push(f);
  return out;
}

/**
 * The facts past the cap, per character-pair: the least used go first, then the longest unused (oldest). `keep` (the
 * batch just added) never goes, or a full memory would drop every new fact at once.
 */
export function factsOverCap(facts: readonly AdultFact[], cap = FACTS_PER_PAIR, keep: ReadonlySet<string> = new Set()): string[] {
  const groups = new Map<string, AdultFact[]>();
  for (const f of facts) groups.set(`${f.character_id}>${f.other_id}`, [...(groups.get(`${f.character_id}>${f.other_id}`) ?? []), f]);
  const out: string[] = [];
  const when = (f: AdultFact) => Date.parse(f.last_used_at ?? f.created_at) || 0;
  for (const group of groups.values()) {
    const ranked = [...group].sort(
      (x, y) => Number(keep.has(y.id)) - Number(keep.has(x.id)) || y.uses - x.uses || when(y) - when(x) || (Date.parse(y.created_at) || 0) - (Date.parse(x.created_at) || 0) || x.id.localeCompare(y.id),
    );
    out.push(...ranked.slice(cap).map((f) => f.id));
  }
  return out;
}

/** New facts merged into a memory: deduped, given ids, and the memory held to the cap (pure; the eval keeps it in memory). */
export function mergeFacts(existing: readonly AdultFact[], incoming: readonly NewFact[], idOf: () => string, at: string): { added: AdultFact[]; dropped: string[]; all: AdultFact[] } {
  const added = dedupeFacts(incoming, existing).map((f) => ({ ...f, id: idOf(), source: "after_dark" as const, created_at: at, last_used_at: null, uses: 0 }));
  const dropped = factsOverCap([...existing, ...added], FACTS_PER_PAIR, new Set(added.map((f) => f.id)));
  const gone = new Set(dropped);
  return { added: added.filter((f) => !gone.has(f.id)), dropped: dropped.filter((id) => existing.some((f) => f.id === id)), all: [...existing, ...added].filter((f) => !gone.has(f.id)) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Retrieval and citation
// ---------------------------------------------------------------------------------------------------------------------

/** A fact as one step shows it: its label in the prompt ("F12") and the fact. */
export type ShownFact = { label: string; fact: AdultFact };

/** Each fact's label: its place among the pair's facts, oldest first, so a fact keeps its number while nothing is dropped. */
export function factLabels(facts: readonly AdultFact[]): Map<string, string> {
  const sorted = [...facts].sort((x, y) => (Date.parse(x.created_at) || 0) - (Date.parse(y.created_at) || 0) || x.id.localeCompare(y.id));
  return new Map(sorted.map((f, i) => [f.id, `F${i + 1}`]));
}

const HALF_LIFE_DAYS = 14;

/**
 * The facts for this step: scored by the words they share with the last RECENT_LINES lines (up to three count), how new
 * they are (halving every two weeks), and a small nudge for one never used; at most two thirds from one side's memory
 * while the other has some. Ties go to the newer.
 */
export function retrieveFacts(facts: readonly AdultFact[], recent: readonly string[], opts: { now?: Date; n?: number; names?: readonly string[] } = {}): ShownFact[] {
  if (!facts.length) return [];
  const n = opts.n ?? FACTS_IN_PROMPT;
  const now = (opts.now ?? new Date()).getTime();
  const skip = new Set((opts.names ?? []).flatMap((x) => x.toLowerCase().split(/\s+/)));
  const said = distinctiveStems(recent.join(" "), skip);
  const labels = factLabels(facts);
  const scored = facts
    .map((f) => {
      const words = distinctiveStems(`${f.fact} ${f.quote ?? ""}`, skip);
      const shared = [...words].filter((w) => said.has(w)).length;
      const age = Math.max(0, (now - (Date.parse(f.created_at) || now)) / 86_400_000);
      const score = Math.min(shared, 3) / 3 + 0.5 * 0.5 ** (age / HALF_LIFE_DAYS) + (f.uses === 0 ? 0.25 : 0);
      return { f, score };
    })
    .sort((x, y) => y.score - x.score || (Date.parse(y.f.created_at) || 0) - (Date.parse(x.f.created_at) || 0) || x.f.id.localeCompare(y.f.id));
  const most = Math.ceil((n * 2) / 3);
  const picked: AdultFact[] = [];
  const skipped: AdultFact[] = [];
  const count = (side: string) => picked.filter((f) => f.character_id === side).length;
  for (const { f } of scored) {
    if (picked.length >= n) break;
    if (count(f.character_id) >= most) skipped.push(f);
    else picked.push(f);
  }
  for (const f of skipped) if (picked.length < n) picked.push(f);
  return picked.map((f) => ({ label: labels.get(f.id) ?? f.id, fact: f }));
}

/** A fact as the prompt lists it: "[F12] Sable calls Rafe “chef” (“Yes, chef!”)", the quote only when the fact hasn't got it. */
export const factLine = (s: ShownFact): string =>
  `[${s.label}] ${s.fact.fact}${s.fact.quote && !` ${norm(s.fact.fact)} `.includes(` ${norm(s.fact.quote)} `) ? ` ("${s.fact.quote}")` : ""}`;

/** The other memories (sceneMemories) as the v2 prompt numbers them: M1, M2… */
export const memoryLabels = (memories: readonly string[]): { label: string; text: string }[] => memories.map((text, i) => ({ label: `M${i + 1}`, text }));

// ---------------------------------------------------------------------------------------------------------------------
// A new pair's memory: their own sheets (prompt v2.1)
// ---------------------------------------------------------------------------------------------------------------------

/** One side of a character the sheet shows: what kind of detail, what to call it ("tell when nervous"), and the detail. */
export type SheetFacet = { kind: "job" | "hobby" | "tell" | "voice" | "bio" | "detail" | "fact" | "answer"; name: string; text: string };

const TELL_ORDER = ["smitten", "nervous", "bored", "annoyed"] as const;
const DETAIL_NAMES: Record<string, string> = {
  quirk: "quirk",
  hidden_talent: "hidden talent",
  pet_peeve: "pet peeve",
  guilty_pleasure: "guilty pleasure",
  signature_item: "signature item",
  go_to_order: "go-to order",
  hometown: "hometown",
  walk_on_music: "walk-on music",
  style: "style",
  ideal_first_date: "ideal first date",
  green_flag: "green flag",
  red_flag: "red flag",
};
const sentencesOf = (text: string | null | undefined): string[] => (text ?? "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 12);

/**
 * The sides of a character their public sheet shows, in the order v2.1 reaches for them: their job, hobbies, tells, voice,
 * the lines of their bio, their other details, public facts and profile answers. Never a private fact.
 */
export function sheetFacets(c: Character): SheetFacet[] {
  const e = publicExtras(c.extras);
  const out: SheetFacet[] = [];
  if (e.occupation) out.push({ kind: "job", name: "job", text: e.occupation });
  for (const h of e.hobbies ?? []) out.push({ kind: "hobby", name: "hobby", text: h });
  for (const id of TELL_ORDER) {
    const t = e.tells?.[id];
    if (t) out.push({ kind: "tell", name: `tell when ${id}`, text: t });
  }
  const voice = sentencesOf(c.voice)[0];
  if (voice) out.push({ kind: "voice", name: "humour and voice", text: voice });
  for (const s of sentencesOf(c.bio)) out.push({ kind: "bio", name: "bio", text: s });
  for (const [key, name] of Object.entries(DETAIL_NAMES)) {
    const v = e[key as keyof typeof e];
    if (typeof v === "string" && v.trim()) out.push({ kind: "detail", name, text: v.trim() });
  }
  for (const f of e.facts ?? []) out.push({ kind: "fact", name: f.label.toLowerCase(), text: f.value });
  for (const p of e.prompts ?? []) out.push({ kind: "answer", name: "own words", text: p.answer });
  return out;
}

/** Sheet details shown per character to a new pair (3 to 5 asked for). */
export const SHEET_ITEMS_PER_SIDE = 4;

/** A sheet detail as the prompt numbers it ([S1]…), and whose it is. */
export type SheetItem = { label: string; of: "a" | "b"; text: string };

/** The detail as a memory line: "Sable's job: Professional surpriser", "From Sable's bio: …". */
function itemText(firstName: string, f: SheetFacet): string {
  if (f.kind === "bio") return `From ${firstName}'s bio: ${f.text}`;
  if (f.kind === "answer") return `${firstName}, in their own words: "${f.text}"`;
  if (f.kind === "fact") return `${firstName}, ${f.name}: ${f.text}`;
  return `${firstName}'s ${f.name}: ${f.text}`;
}

/**
 * A new pair's memory (v2.1): SHEET_ITEMS_PER_SIDE of each one's own sheet details, numbered S1… (a's first). Per
 * character: their job, a hobby, a tell and the most specific line of their bio (its last), then whatever else the sheet
 * has. The same every step, so a citation keeps meaning the same detail.
 */
export function sheetMemories(a: Character | null, b: Character | null, per = SHEET_ITEMS_PER_SIDE): SheetItem[] {
  const out: SheetItem[] = [];
  for (const [who, c] of [
    ["a", a],
    ["b", b],
  ] as const) {
    if (!c) continue;
    const facets = sheetFacets(c);
    const pick = (kind: SheetFacet["kind"], last = false) => {
      const of = facets.filter((f) => f.kind === kind);
      return last ? of.at(-1) : of[0];
    };
    const firstPicks = [pick("job"), pick("hobby"), pick("tell"), pick("bio", true)].filter((f): f is SheetFacet => Boolean(f));
    const rest = facets.filter((f) => !firstPicks.includes(f) && f.kind !== "voice");
    const name = c.name.split(/\s+/)[0];
    for (const f of [...firstPicks, ...rest].slice(0, per)) out.push({ label: `S${out.length + 1}`, of: who, text: itemText(name, f) });
  }
  return out;
}

/** `loose` (v2.2): facts the memory cites that the line doesn't use; not in `facts`, so they're never bumped or stored. */
export type Citation = { facts: string[]; founded: boolean | null; sheet?: string[]; loose?: string[] };

/** A fact's or a line's distinctive words, as stems (lib/adult/quality.ts distinctiveStems), the pair's names left out. */
const stemsOf = (text: string, names: readonly string[]): Set<string> => {
  const skip = new Set(names.flatMap((n) => n.toLowerCase().split(/\s+/)));
  return new Set([...distinctiveStems(text, skip)].filter((s) => !skip.has(s)));
};

/**
 * Whether a line uses a fact (v2.2, Lexi × Dex's climax: F13, F14 and F5 cited on lines that never touch them): the
 * line, what it says or does, shares a distinctive word with the fact or its quote. A fact with no words of its own
 * can't be told apart, so it counts as used.
 */
export function usesFact(text: string, fact: Pick<AdultFact, "fact" | "quote">, names: readonly string[] = []): boolean {
  const own = stemsOf(`${fact.fact} ${fact.quote ?? ""}`, names);
  if (!own.size) return true;
  const said = stemsOf(text, names);
  return [...own].some((s) => said.has(s));
}

/**
 * What a line's private "memory" cites: the facts it names by label (or quotes, or plainly matches), the sheet details it
 * names ([S2], when a new pair was shown some), and whether all of it is in what they can remember (the facts shown, the
 * other memories and sheet details, or what's already happened tonight). null: no note. A label right after an apostrophe
 * isn't one ("I'm 30", "Sable's 41 hats"). With the `line` (its text, and the pair's names), a cited fact the line
 * doesn't use is loose (v2.2): it's left out of `facts`, and a citation of nothing else isn't founded.
 */
export function citeMemory(
  memory: string | null | undefined,
  shown: readonly ShownFact[],
  others: readonly { label: string; text: string }[],
  context: string,
  line?: { text: string; names: readonly string[] },
): Citation {
  const note = memory?.trim();
  if (!note) return { facts: [], founded: null };
  const ids: string[] = [];
  const sheet: string[] = [];
  const loose: string[] = [];
  const cite = (f: ShownFact) => (line && !usesFact(line.text, f.fact, line.names) ? loose : ids).push(f.fact.id);
  let unknown = false;
  let other = false;
  const labels = [...note.matchAll(/(?<!['’])\b([FMS])\s?-?(\d{1,3})\b/gi)].map((m) => `${m[1].toUpperCase()}${Number(m[2])}`);
  for (const label of new Set(labels)) {
    const fact = shown.find((s) => s.label === label);
    if (fact) cite(fact);
    else if (!others.some((o) => o.label === label)) unknown = true;
    else if (label.startsWith("S")) sheet.push(label);
    else other = true;
  }
  const withLoose = loose.length ? { loose } : {};
  // An id that isn't there is the worse fault: such a citation counts as unfounded, loose facts or not.
  if (unknown) return { facts: ids, founded: false, ...(sheet.length ? { sheet } : {}) };
  if (labels.length) return { facts: ids, founded: ids.length > 0 || sheet.length > 0 || other || !loose.length, ...(sheet.length ? { sheet } : {}), ...withLoose };
  for (const s of shown) if (memoryFounded(note, `${s.fact.fact} ${s.fact.quote ?? ""}`)) cite(s);
  if (ids.length) return { facts: ids, founded: true, ...withLoose };
  if (loose.length) return { facts: [], founded: false, loose };
  // A sheet detail named in words ("her party hats"), when the note has words of its own to match: the detail itself, not
  // its label ("Sable's hobby:"), or every detail of hers would match a note with her name in it.
  const detail = (text: string) => text.slice(text.indexOf(": ") + 2);
  const sheetHits = /[a-z]{4,}/i.test(note) ? others.filter((o) => o.label.startsWith("S") && memoryFounded(note, detail(o.text))).map((o) => o.label) : [];
  if (sheetHits.length) return { facts: [], founded: true, sheet: sheetHits };
  const elsewhere = [...others.map((o) => o.text), context].join("\n");
  return { facts: [], founded: memoryFounded(note, elsewhere) };
}

// ---------------------------------------------------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------------------------------------------------

type FactRow = Omit<AdultFact, "created_at" | "last_used_at"> & { created_at: string | Date; last_used_at: string | Date | null };
const iso = (d: string | Date | null) => (d === null ? null : new Date(d).toISOString());

/** The pair's facts for this person's nights, both ways, oldest first. */
export async function loadPairFacts(db: Db, ownerId: string, aId: string, bId: string): Promise<AdultFact[]> {
  const { rows } = await db
    .query<FactRow>(
      `select id, character_id, other_id, kind, fact, quote, source, created_at, last_used_at, uses from adult_facts
        where owner_id = $1 and ((character_id = $2 and other_id = $3) or (character_id = $3 and other_id = $2)) order by created_at, id`,
      [ownerId, aId, bId],
    )
    .catch(() => ({ rows: [] as FactRow[] }));
  return rows.map((r) => ({ ...r, created_at: iso(r.created_at)!, last_used_at: iso(r.last_used_at) }));
}

/** The facts kept lines cited: one more use each, and used now. */
export async function bumpFacts(db: Db, ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  await db.query(`update adult_facts set uses = uses + 1, last_used_at = now() where id = any($1)`, [[...new Set(ids)]]).catch(() => {});
}

/**
 * Extracts a chapter's facts and keeps them (a chapter closing, a night saved): one call, deduped against what's
 * remembered, the memory held to its cap. Never throws; the number of facts added.
 */
export async function rememberFacts(db: Db, ownerId: string, a: Character | null, b: Character | null, lines: readonly SceneLine[]): Promise<number> {
  if (!a || !b || lines.length < MIN_LINES_TO_EXTRACT) return 0;
  try {
    const incoming = await extractFacts(await adultModel(db), a, b, lines);
    if (!incoming.length) return 0;
    const existing = await loadPairFacts(db, ownerId, a.id, b.id);
    const { added, dropped } = mergeFacts(existing, incoming, () => crypto.randomUUID(), new Date().toISOString());
    for (const f of added) {
      await db.query(`insert into adult_facts (id, owner_id, character_id, other_id, kind, fact, quote, source) values ($1, $2, $3, $4, $5, $6, $7, $8)`, [
        f.id,
        ownerId,
        f.character_id,
        f.other_id,
        f.kind,
        f.fact,
        f.quote,
        f.source,
      ]);
    }
    if (dropped.length) await db.query(`delete from adult_facts where id = any($1)`, [dropped]);
    return added.length;
  } catch {
    return 0;
  }
}
