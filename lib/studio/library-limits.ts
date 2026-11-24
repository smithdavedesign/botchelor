/**
 * The Create library's limits and shapes (lib/studio/library.ts is the library itself: its checks and its reads and
 * writes). Apart so a page's code in the browser can use them without the content filter's word lists (2026-11-22 audit).
 */
import type { SceneCategory } from "../adult/scene-catalog";

export const LIBRARY_MODES = ["safe", "after_dark"] as const;
export type LibraryMode = (typeof LIBRARY_MODES)[number];
export const LIBRARY_MAX = 60;
export const PROMPT_MAX = 500;
export const PLACE_NAME_MAX = 40;
export const PLACE_DESCRIPTION_MAX = 240;
export const ROLEPLAY_TITLE_MAX = 60;
export const ROLEPLAY_PREMISE_MAX = 300;
export const ROLE_MAX = 60;

/** The roleplay categories a person may file theirs under (the show's own, lib/adult/scene-catalog.ts). */
export const ROLEPLAY_CATEGORIES = ["romance", "strangers", "second", "afterhours", "getaway", "nightlife", "nightin", "outdoors", "fantasy", "scifi", "mystery", "funny"] as const satisfies readonly SceneCategory[];

export type MyPrompt = { id: string; text: string; title: string | null; mode: LibraryMode; created_at: string };
export type MyPlace = { id: string; name: string; description: string | null; mode: LibraryMode; created_at: string };
/**
 * `story_beats`: how many beats its story for Step in has, once that's been drafted (lib/adult/own-roleplay-card.ts),
 * for someone Step in is open to; left out otherwise. Only the count: the beats themselves would give the story away.
 */
export type MyRoleplay = { id: string; title: string; premise: string; roles: [string, string] | null; category: SceneCategory; mode: LibraryMode; created_at: string; story_beats?: number };
export type Library = { prompts: MyPrompt[]; places: MyPlace[]; roleplays: MyRoleplay[] };
