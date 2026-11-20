/**
 * The site's free OC tools over MCP (2.32.0; random_oc 2.44.0): the same code the /tools pages run, so an agent gets the
 * page's answer.
 *
 *  - random_oc: six whole characters in a genre, each ready for create_character (lib/random-oc.ts,
 *    /tools/random-oc-generator).
 *  - ship_names: two names in, their ship names out (lib/ship-names.ts, /tools/ship-name-generator, /ship/<a>/<b>).
 *  - oc_chemistry_test: two character sheets in; a 0–100 score, the ending the date engine predicts for their first
 *    date and three reasons out (lib/chemistry-test.ts, /tools/oc-chemistry-test).
 *  - oc_names: a page of twelve names in a style (lib/oc-names.ts, /tools/oc-name-generator).
 *  - oc_question: questions to ask an OC, one or a theme's worth (lib/oc-questions.ts, /tools/oc-questions).
 *
 * Pure and deterministic: no model, no database, no identity needed, nothing stored. The content filter (lib/safety.ts)
 * refuses what the pages refuse, with the pages' messages. Each answer carries the page's link, to share or open.
 */
import { chemistryResultHref, createPairHref, chemistryTest, errorPlace, fieldParam, readChemistry, SHEET_FIELDS } from "../chemistry-test";
import { createWithName, OC_NAME_STYLE_INFO, OC_NAMES_MAX_BATCH, ocNames, ocNamesHref, readBatch, readKind, readStyle } from "../oc-names";
import { OC_QUESTION_THEMES, OC_QUESTIONS, OC_QUESTIONS_PATH, ocQuestionHref, nextQuestion, readQuestion, type OcQuestion } from "../oc-questions";
import { SHIP_ERRORS, shipPair, shipPath } from "../ship-names";
import { createFromOc, ocSentence, RANDOM_OC_GENRE_INFO, RANDOM_OC_MAX_BATCH, randomOcHref, randomOcs, readGenre, readOcBatch, roleLine, type RandomOc } from "../random-oc";
import { siteUrl } from "../site";

export const OC_TOOL_NAMES = ["ship_names", "oc_chemistry_test", "oc_names", "oc_question", "random_oc"] as const;
export type OcToolName = (typeof OC_TOOL_NAMES)[number];
const OC_TOOLS = new Set<string>(OC_TOOL_NAMES);
export const isOcTool = (name: string): name is OcToolName => OC_TOOLS.has(name);

/** The ending names the chemistry test shares with the engine, in words. */
const ENDING_WORDS = { second_date: "a second date", friends: "just friends", disaster: "a disaster" } as const;

type Outcome = { data: Record<string, unknown> } | { error: string };
type Args = Record<string, unknown>;

const link = (path: string): string => `${siteUrl()}${path}`;
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** ship_names: a and b, the two names. */
export function shipNamesTool(args: Args): Outcome {
  const pair = shipPair(text(args.a), text(args.b));
  if (!pair.ok) return { error: SHIP_ERRORS[pair.error] };
  return {
    data: {
      a: pair.a.display,
      b: pair.b.display,
      ship_names: pair.names.map((s) => s.name),
      made_from: pair.names.map((s) => `${s.head} + ${s.tail}`),
      url: link(shipPath(pair.a, pair.b)),
    },
  };
}

/** A character for the chemistry test: { name, traits: [3], want, dealbreaker } (traits as a list, or trait1…trait3). */
function sheetParams(side: "a" | "b", raw: unknown): Record<string, string> {
  const sheet = raw && typeof raw === "object" ? (raw as Args) : {};
  const traits = Array.isArray(sheet.traits) ? sheet.traits.map(text) : [];
  const out: Record<string, string> = {};
  for (const f of SHEET_FIELDS) {
    const value = f.startsWith("trait") ? (traits[Number(f.slice(-1)) - 1] ?? text(sheet[f])) : text(sheet[f]);
    out[fieldParam(side, f)] = value;
  }
  return out;
}

/** oc_chemistry_test: a and b, two character sheets. */
export function chemistryTool(args: Args): Outcome {
  const read = readChemistry({ ...sheetParams("a", args.a), ...sheetParams("b", args.b) });
  if (!read.ok) {
    if (read.empty) return { error: "Send two characters, a and b, each { name, traits: [three traits], want, dealbreaker }." };
    const { error, form } = read;
    const where = errorPlace(error, form);
    // The field's argument path, so a client can point at it: a.traits[1], b.want…
    const arg = `${error.side}.${error.field.startsWith("trait") ? `traits[${Number(error.field.slice(-1)) - 1}]` : error.field}`;
    return { error: `${where[0].toUpperCase()}${where.slice(1)} (${arg}): ${error.message}` };
  }
  const { a, b } = read;
  const result = chemistryTest(a, b);
  return {
    data: {
      score: result.score,
      ending: result.ending,
      ending_words: ENDING_WORDS[result.ending],
      reasons: result.reasons,
      url: link(chemistryResultHref(a, b)),
      watch_the_real_date: link(createPairHref(a, b)),
      note: "The date engine's rules without its luck or secret agendas, so the same pair always gets the same answer. A real date can still go either way: create_character, then go_on_date.",
    },
  };
}

/** oc_names: style (or none for a mix), kind, batch. */
export function ocNamesTool(args: Args): Outcome {
  // A style or kind outside the enum never gets here: the dispatcher drops it to the default with a warning.
  const style = readStyle(args.style);
  const kind = readKind(args.kind);
  const batch = readBatch(args.batch === undefined ? undefined : String(args.batch));
  const names = ocNames({ style, kind, batch });
  return {
    data: {
      style: style ?? "mixed",
      ...(style ? { about: OC_NAME_STYLE_INFO[style].blurb } : {}),
      kind,
      batch,
      names: names.map((n) => ({ name: n.name, style: n.style, kind: n.kind, create_url: link(createWithName(n.name)) })),
      url: link(ocNamesHref(style, kind, batch)),
      more: { batch: (batch % OC_NAMES_MAX_BATCH) + 1, note: "The same style, kind and batch always give the same names; another batch gives twelve more." },
      use_one: "create_character takes the name; the names here are filtered and free to use.",
    },
  };
}

/** A random character's bio for create_character: who they are and their secret, in the third person. */
export function randomOcBio(oc: RandomOc): string {
  const who = roleLine(oc);
  return `${who[0].toUpperCase()}${who.slice(1)}. Secret: ${oc.secret}.`;
}

/** random_oc: genre (or none for a mix), kind, batch. */
export function randomOcTool(args: Args): Outcome {
  // A genre or kind outside the enum never gets here: the dispatcher drops it to the default with a warning.
  const genre = readGenre(args.genre);
  const kind = readKind(args.kind);
  const batch = readOcBatch(args.batch === undefined ? undefined : String(args.batch));
  const ocs = randomOcs({ genre, kind, batch });
  return {
    data: {
      genre: genre ?? "mixed",
      ...(genre ? { about: RANDOM_OC_GENRE_INFO[genre].world } : {}),
      kind,
      batch,
      characters: ocs.map((oc, i) => {
        const next = ocs[(i + 1) % ocs.length];
        return {
          name: oc.name,
          pronouns: oc.pronouns,
          age: oc.age,
          genre: oc.genre,
          role: oc.role,
          quirk: oc.quirk,
          traits: oc.traits,
          want: oc.want,
          dealbreaker: oc.dealbreaker,
          secret: oc.secret,
          sentence: ocSentence(oc),
          // Everything create_character needs but attest (and the look, which it picks itself when left out).
          create_character: { name: oc.name, age: oc.age, bio: randomOcBio(oc), traits: oc.traits, want: oc.want, dealbreaker: oc.dealbreaker },
          create_url: link(createFromOc(oc)),
          chemistry_with_next: { with: next.name, url: link(chemistryResultHref(oc, next)) },
        };
      }),
      url: link(randomOcHref(genre, kind, batch)),
      more: { batch: (batch % RANDOM_OC_MAX_BATCH) + 1, note: "The same genre, kind and batch always give the same six; another batch gives six more." },
      use_one: "Pass a character's create_character fields to create_character (with attest: true); oc_chemistry_test takes two of them as a and b.",
    },
  };
}

const questionOut = (q: OcQuestion) => ({ id: q.id, question: q.text, theme: q.theme.id, url: link(ocQuestionHref(q)) });

/** oc_question: id (that one), theme (all of a theme), after (the next one), or nothing (today's). */
export function ocQuestionTool(args: Args): Outcome {
  const themes = OC_QUESTION_THEMES.map((t) => ({ id: t.id, title: t.title, count: t.questions.length }));
  if (args.theme !== undefined) {
    const theme = OC_QUESTION_THEMES.find((t) => t.id === args.theme);
    if (!theme) return { error: `theme is one of ${OC_QUESTION_THEMES.map((t) => t.id).join(", ")}.` }; // the dispatcher already dropped an unknown one
    return {
      data: {
        theme: theme.id,
        title: theme.title,
        about: theme.blurb,
        questions: OC_QUESTIONS.filter((q) => q.theme === theme).map(questionOut),
        url: `${link(OC_QUESTIONS_PATH)}#${theme.id}`,
      },
    };
  }
  for (const key of ["id", "after"] as const) {
    if (args[key] !== undefined && !readQuestion(args[key])) return { error: `No question "${String(args[key])}": ids look like love-3 (a theme, a dash, its number). Leave ${key} out for today's question.` };
  }
  const day = Math.floor(Date.now() / 86_400_000);
  const q = args.id !== undefined ? readQuestion(args.id)! : args.after !== undefined ? nextQuestion(readQuestion(args.after)) : OC_QUESTIONS[day % OC_QUESTIONS.length];
  return {
    data: {
      ...questionOut(q),
      next: nextQuestion(q).id,
      themes,
      total: OC_QUESTIONS.length,
      tip: "Ask it in your character's voice; an answer worth keeping belongs in its bio or a memory (update_character).",
    },
  };
}

export function runOcTool(name: OcToolName, args: Args): Outcome {
  switch (name) {
    case "ship_names":
      return shipNamesTool(args);
    case "oc_chemistry_test":
      return chemistryTool(args);
    case "oc_names":
      return ocNamesTool(args);
    case "oc_question":
      return ocQuestionTool(args);
    case "random_oc":
      return randomOcTool(args);
  }
}
