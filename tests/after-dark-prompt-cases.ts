/**
 * Fixed inputs for After Dark's scene prompt (lib/adult/scenes.ts sceneMessages), shared by tests/after-dark-voice.test.ts
 * and the fixture it compares v1 against (tests/fixtures/after-dark-v1-prompt.json, captured from the prompt as it was
 * before v2 existed). Pure: no database.
 */
import { assembleCharacter, type Character } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { HOUSE_KITS } from "@/lib/house-kits";

export function houseCharacter(id: string, extras: Record<string, unknown> = {}): Character {
  const h = HOUSE_CHARACTERS.find((c) => c.id === id)!;
  return assembleCharacter({
    id: h.id,
    sheet: { name: h.name, age: h.age, bio: h.bio, traits: h.traits, want: h.want, dealbreaker: h.dealbreaker, house: true, appearance: h.appearance, pronouns: h.pronouns, voice: h.voice },
    soul: null,
    memory: null,
    extras: { ...(HOUSE_KITS[h.id] ?? {}), ...extras },
  });
}

type SceneLineLike = { who: "a" | "b"; text: string };
export type PromptCase = {
  name: string;
  a: Character | null;
  b: Character | null;
  date: { setting: string | null; ending: string | null; venue: string | null; character_a: string; transcript: { side: "a" | "b"; dialogue: string; action?: string }[] | null } | null;
  lines: SceneLineLike[];
  direction: string | null;
  aId?: string;
  now: Record<string, unknown>;
};

const rafe = () => houseCharacter("house-rafe", { catchphrase: "“Bold of you to assume I have a plan.”", occupation: "Pastry chef" });
const sable = () => houseCharacter("house-sable");

const DATE = {
  setting: "the night market",
  ending: "second_date",
  venue: "night_market",
  character_a: "house-sable",
  transcript: [
    { side: "a" as const, dialogue: "Forty-one hats. I counted them again this morning.", action: "grins" },
    { side: "b" as const, dialogue: "And not one dining table. I respect the priorities." },
    { side: "a" as const, dialogue: "Dare you to eat the spiciest thing here." },
  ],
};

const MID_LINES: SceneLineLike[] = [
  { who: "a", text: "*leans on the counter* You scored my dumplings a seven." },
  { who: "b", text: "A generous seven! The glaze was nervous." },
  { who: "a", text: "*laughs* Nervous glaze. Write that on my tombstone." },
  { who: "b", text: "Only if I get to throw the party after." },
];

export function promptCases(): PromptCase[] {
  return [
    {
      name: "opening",
      a: rafe(),
      b: sable(),
      date: DATE,
      lines: [],
      direction: null,
      aId: "house-rafe",
      now: { place: "the night market, where their date was", stage: 0, linesAtStage: 0, opening: true, memories: ["Their latest date, the night market, ended: second_date", 'Rafe remembers Sable saying: "Dare you to eat the spiciest thing here."'], catchphraseUsed: { a: false, b: false } },
    },
    {
      name: "mid-scene, nudged, at her place, out of moves",
      a: rafe(),
      b: sable(),
      date: DATE,
      lines: MID_LINES,
      direction: "they go back to hers",
      aId: "house-rafe",
      now: {
        place: "Sable's living room",
        stage: 2,
        linesAtStage: 14,
        cutTo: null,
        recap: "They left the market laughing and went back to Sable's.",
        opening: false,
        steerMode: "nudge",
        set: "apartment living room",
        history: [
          { place: "the night market", set: "night market", home: null, chapter: 1 },
          { place: "Sable's living room", set: "apartment living room", home: "b", chapter: 1 },
        ],
        homeNow: "b",
        movesLeft: 0,
        memories: ["Sable remembers from before: You and Rafe spent the night together after the market."],
        catchphraseUsed: { a: true, b: false },
      },
    },
    {
      name: "cut to, directed, last stage",
      a: rafe(),
      b: sable(),
      date: null,
      lines: MID_LINES.slice(0, 2),
      direction: "they finally stop talking",
      aId: "house-rafe",
      now: { place: "a hotel suite", stage: 4, linesAtStage: 20, cutTo: "a hotel suite", steerMode: "direct", movesLeft: 2 },
    },
  ];
}
