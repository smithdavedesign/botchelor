/** Types for scripts/prompts.mjs, which stays plain JS so `npm run portraits` runs it with no build step. */
import type { HouseCharacter } from "../lib/house";
import type { Venue } from "../lib/venues";

export type ImageJob = {
  id: string;
  kind: "portrait" | "background";
  character_id: string | null;
  label: string;
  file: string;
  prompt: string;
  prompt_version: string;
  seed: number;
  negative: string;
  aspect: "3:4" | "16:9";
};

export const PORTRAIT_PROMPT_VERSION: string;
export const BACKDROP_PROMPT_VERSION: string;
export const NEGATIVE_PROMPT: string;
export function portraitPrompt(c: HouseCharacter): string;
export function backdropPrompt(v: Venue): string;
export function jobSeed(id: string): number;
export function buildBatch(input: { house: readonly HouseCharacter[]; venues: readonly Venue[] }): ImageJob[];
