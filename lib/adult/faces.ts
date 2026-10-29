/**
 * The faces a character can make in the theater (lib/adult/presence.ts; docs/PRDs/theater-immersion.md #2): the writer's
 * word for each line's expression, and what an edit of their face changes for it. Neutral is the face itself. No imports,
 * so the writer (lib/adult/scenes.ts) and the presence can both use it.
 */
export const EXPRESSIONS = {
  smile: "a warm, easy smile, eyes soft",
  laugh: "laughing for real, mouth open, eyes creased with it",
  flirty: "a flirty, teasing look: a sly half-smile, one eyebrow a little raised, eyes on the camera",
  intense: "an intense, smouldering look: lips slightly parted, heavy-lidded eyes locked on the camera",
  tender: "a tender, affectionate look: a small soft smile, eyes warm",
  surprised: "surprised: eyebrows up, eyes wide, lips parted",
  annoyed: "unimpressed and a little annoyed: a flat look, one eyebrow raised, lips pressed together",
} as const;
export type Expression = keyof typeof EXPRESSIONS;
export const FACES = ["neutral", ...(Object.keys(EXPRESSIONS) as Expression[])] as const;
export type Face = (typeof FACES)[number];
export const isFace = (v: unknown): v is Face => typeof v === "string" && (FACES as readonly string[]).includes(v);

