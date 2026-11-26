/**
 * SillyTavern character cards over MCP (2.52.0, 2026-11-26): the creators who pay are on r/SillyTavernAI (REVENUE.md),
 * and /import already reads their cards (lib/import-character.ts). This is the other half, and the agents' half:
 *
 *  - charaCardV2: a Botchelor character as a chara_card_v2 card (export_character with format: "chara_card_v2").
 *  - cardToCreateArgs: an imported card's draft as create_character's arguments (import_card).
 *
 * Pure, no database.
 */
import type { CharacterExtras } from "./extras";
import type { ImportedDraft } from "./import-character";

/** export_character's formats: create_character's JSON, or that and a SillyTavern card. */
export const EXPORT_FORMATS = ["botchelor", "chara_card_v2"] as const;

export type CardSource = {
  name: string;
  age: number;
  bio: string;
  traits: string[];
  want: string;
  dealbreaker: string;
  appearance?: string | null;
  pronouns?: string | null;
  voice?: string | null;
  extras?: CharacterExtras | null;
};

/** The character as a chara_card_v2 card. Botchelor's own sheet rides in extensions.botchelor, so a round trip loses nothing. */
export function charaCardV2(c: CardSource, link: string): Record<string, unknown> {
  const description = [
    `${c.name}, ${c.age}${c.pronouns ? ` (${c.pronouns})` : ""}. ${c.bio}`,
    c.appearance ? `Looks: ${c.appearance}` : null,
    `Wants: ${c.want}`,
    `Can't stand: ${c.dealbreaker}`,
  ]
    .filter(Boolean)
    .join("\n");
  const personality = [c.traits.join(", "), c.voice ? `Voice: ${c.voice}` : null].filter(Boolean).join(". ");
  const sheet: Record<string, unknown> = {
    name: c.name,
    age: c.age,
    bio: c.bio,
    traits: c.traits,
    want: c.want,
    dealbreaker: c.dealbreaker,
    ...(c.appearance ? { appearance: c.appearance } : {}),
    ...(c.pronouns ? { pronouns: c.pronouns } : {}),
    ...(c.voice ? { voice: c.voice } : {}),
    ...(c.extras && Object.keys(c.extras).length ? { extras: c.extras } : {}),
  };
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: c.name,
      description,
      personality,
      scenario: `${c.name} is a contestant on Botchelor, a comedic blind-date show for fictional adult characters.`,
      first_mes: "",
      mes_example: "",
      creator_notes: `Made on Botchelor: ${link}`,
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      tags: ["botchelor", ...c.traits.map((t) => t.toLowerCase())].slice(0, 10),
      creator: "Botchelor",
      character_version: "1",
      extensions: { botchelor: sheet },
    },
  };
}

/** The card itself when it carries Botchelor's sheet (one of ours, round-tripped): read as it is, nothing guessed. */
export function botchelorSheetOf(card: unknown): Record<string, unknown> | null {
  const data = card && typeof card === "object" ? ((card as { data?: unknown }).data ?? card) : null;
  const ext = data && typeof data === "object" ? (data as { extensions?: { botchelor?: unknown } }).extensions?.botchelor : null;
  return ext && typeof ext === "object" && !Array.isArray(ext) ? (ext as Record<string, unknown>) : null;
}

/** An imported card's draft as create_character's arguments: the empty fields left out, attest left for the agent. */
export function cardToCreateArgs(d: ImportedDraft): Record<string, unknown> {
  const age = Number.parseInt(d.sheet.age, 10);
  const traits = d.traits.filter((t) => t.trim());
  const out: Record<string, unknown> = {
    ...(d.sheet.name ? { name: d.sheet.name } : {}),
    ...(Number.isFinite(age) ? { age } : {}),
    ...(d.sheet.bio ? { bio: d.sheet.bio } : {}),
    ...(traits.length ? { traits } : {}),
    ...(d.sheet.want ? { want: d.sheet.want } : {}),
    ...(d.sheet.dealbreaker ? { dealbreaker: d.sheet.dealbreaker } : {}),
    ...(d.pronouns ? { pronouns: d.pronouns } : {}),
    ...(d.voice ? { voice: d.voice } : {}),
    ...(d.appearance ? { appearance: d.appearance } : {}),
    ...(d.extras && Object.keys(d.extras).length ? { extras: d.extras } : {}),
  };
  return out;
}
