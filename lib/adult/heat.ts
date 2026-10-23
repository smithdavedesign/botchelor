/**
 * How explicit a scene is written (David, 2026-10-23): a setting per scene, stored on adult_scenes.heat, null meaning
 * frank. Not the director's suggestion heats (mild, flirty, spicy: lib/adult/director.ts), which are how bold a
 * suggested next move is.
 *
 *  - suggestive: fade to implication. Sex can happen, but it's written around it: no anatomy words, and the scene cuts
 *    away at the climax.
 *  - frank (the default): explicit acts plainly described, with each character's humour and voice still strong.
 *  - filthy: from undressing on, dirty talk in plain, explicit words in the dialogue itself. Their humour and their job
 *    drop to a light seasoning (a line now and then at most), and the voice shows in attitude and rhythm, not puns.
 *
 * Every heat keeps the same two lines (both adults; no minors, no real people), and the same media and output checks.
 */
import { STAGES } from "./stages";

export const SCENE_HEATS = ["suggestive", "frank", "filthy"] as const;
export type SceneHeat = (typeof SCENE_HEATS)[number];
export const DEFAULT_SCENE_HEAT: SceneHeat = "frank";

/** A stored or sent heat, or the default (null, unknown or missing is frank). */
export const sceneHeatOf = (v: unknown): SceneHeat => ((SCENE_HEATS as readonly unknown[]).includes(v) ? (v as SceneHeat) : DEFAULT_SCENE_HEAT);

/** The labels the scene page shows. */
export const SCENE_HEAT_LABEL: Record<SceneHeat, string> = { suggestive: "Suggestive", frank: "Frank", filthy: "Filthy" };

/** "undressing" (STAGES): where filthy's plain talk starts. */
export const PLAIN_TALK_FROM = STAGES.indexOf("undressing");

/** Whether these lines are filthy's late stages: plain, explicit talk, humour as seasoning. */
export const plainTalk = (heat: SceneHeat, stage: number): boolean => heat === "filthy" && stage >= PLAIN_TALK_FROM;
