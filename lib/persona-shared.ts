/**
 * The client-safe half of a scene persona (lib/persona.ts is the server's): its shape and limits, for the card on
 * /account and anything else that only needs to know how long a line may be.
 */
export type ScenePersona = { name: string; look: string; about: string };
export const SCENE_PERSONA_FIELDS = ["name", "look", "about"] as const;
export type ScenePersonaField = (typeof SCENE_PERSONA_FIELDS)[number];
/** The longest each line may be (characters). */
export const SCENE_PERSONA_MAX: Record<ScenePersonaField, number> = { name: 40, look: 160, about: 200 };
