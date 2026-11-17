/**
 * The client-safe half of a scene persona (lib/persona.ts is the server's): its shape and limits, for the card on
 * /account and anything else that only needs to know how long a line may be.
 */
export type ScenePersona = { name: string; look: string; about: string };
export const SCENE_PERSONA_FIELDS = ["name", "look", "about"] as const;
export type ScenePersonaField = (typeof SCENE_PERSONA_FIELDS)[number];
/** The longest each line may be (characters). */
export const SCENE_PERSONA_MAX: Record<ScenePersonaField, number> = { name: 40, look: 160, about: 200 };

/**
 * SCENE_PERSONA=0 turns the show's use of personas off without a deploy of code (docs/hosting.md): no scene's prompt
 * reads one, the card on /account and the picker's line go, and saving one answers not found. What's stored stays,
 * still in the export and still deletable. On unless it is "0".
 */
export function scenePersonaOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.SCENE_PERSONA?.trim() !== "0";
}
