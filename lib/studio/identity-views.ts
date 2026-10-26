/**
 * The identity pack (the creator suite; David, 2026-10-26): eight views of one character, each an edit of the face they
 * keep, so a later picture can be shown the same person from the angle it needs (Kling's and Runway's own docs: one
 * reference is the weak case). Shared by both Studios (lib/adult/studio.ts identityPack, lib/studio/pg.ts
 * pgIdentityPack) and pure, so the page can name the views. Never "turned three…" or a number next to "years" but the
 * adult's own age: the age check reads that as an age (lib/adult/acts.ts), and it's right to be that strict.
 */

export const IDENTITY_VIEWS = [
  { id: "front", label: "Straight on", words: "a tight head-and-shoulders close-up, looking straight at the camera, the face filling the frame" },
  { id: "three_quarter_left", label: "¾ left", words: "head and shoulders, the face at a three-quarter angle to the camera's left, looking just past the lens" },
  { id: "three_quarter_right", label: "¾ right", words: "head and shoulders, the face at a three-quarter angle to the camera's right, looking just past the lens" },
  { id: "profile_left", label: "Profile left", words: "head and shoulders in profile, facing the camera's left, the side of the face clear" },
  { id: "profile_right", label: "Profile right", words: "head and shoulders in profile, facing the camera's right, the side of the face clear" },
  { id: "smiling", label: "Smiling", words: "a head-and-shoulders close-up, laughing, a wide natural smile, looking at the camera" },
  { id: "over_shoulder", label: "Over the shoulder", words: "seen from behind and slightly to the side, looking back over one shoulder at the camera, the face clear" },
  { id: "full_body", label: "Full body", words: "full body, head to toe, standing straight and facing the camera, arms relaxed at the sides" },
] as const;
export type IdentityViewId = (typeof IDENTITY_VIEWS)[number]["id"];
export const IDENTITY_VIEW_IDS: IdentityViewId[] = IDENTITY_VIEWS.map((v) => v.id);
export const isIdentityView = (v: unknown): v is IdentityViewId => typeof v === "string" && (IDENTITY_VIEW_IDS as string[]).includes(v);

/** Who the view shows, as a prompt reads it: a woman, a man or a person, their age (an adult's), their look. */
export type ViewSubject = { noun: "woman" | "man" | "person"; age: number; look: string };

/**
 * One view's prompt: the same person as Picture 1 (the face they keep), at that angle, on a plain backdrop, dressed (a
 * view is for the face; the PG Studio's in the show's safe words). The full-body one takes their body reference as
 * Picture 2 when it's given.
 */
export function identityViewPrompt(view: IdentityViewId, subject: ViewSubject, opts: { body?: boolean; outfit?: string | null; pg?: boolean } = {}): string {
  const v = IDENTITY_VIEWS.find((x) => x.id === view)!;
  const age = Math.max(21, Math.round(subject.age || 21));
  const body = opts.body && view === "full_body" ? ", with the body from Picture 2" : "";
  const worn = opts.outfit ? `Wearing ${opts.outfit}.` : "Dressed in simple, fitted everyday clothes.";
  return [
    `Make one photograph of the ${subject.noun} from Picture 1${body}, a ${age}-year-old adult${subject.look ? ` (${subject.look})` : ""}: the very same face, features, hair and skin tone, unchanged.`,
    `${v.words[0].toUpperCase()}${v.words.slice(1)}, against a plain light-grey studio backdrop, soft even light, sharp focus on the face.`,
    worn,
    "One person only.",
    opts.pg ? "Fully clothed, tasteful and everyday, safe for work. Photorealistic. Everyone shown is an adult." : "Photorealistic. Everyone shown is an adult.",
  ].join(" ");
}

/**
 * Which view suits a picture, from its words: from behind or looking back, over the shoulder; in profile, a profile;
 * head to toe, the full body; a close-up, straight on; else a ¾ view.
 */
export function viewFor(words: string): IdentityViewId {
  const w = words.toLowerCase();
  if (/\b(from behind|behind (him|her|them)|looking back|over (his|her|their|one) shoulder|on (her|his|their) hands and knees)\b/.test(w)) return "over_shoulder";
  if (/\bin profile\b|\bside[- ]on\b|\bfrom the side\b/.test(w)) return "profile_left";
  if (/\b(full[- ]length|full body|head to toe)\b/.test(w)) return "full_body";
  if (/\b(close-up|close up|close shot|their faces)\b/.test(w)) return "front";
  return "three_quarter_left";
}

/** The next best views when the one wanted isn't in the pack, nearest angle first. */
const NEAREST: Record<IdentityViewId, IdentityViewId[]> = {
  front: ["smiling", "three_quarter_left", "three_quarter_right"],
  three_quarter_left: ["three_quarter_right", "front", "smiling"],
  three_quarter_right: ["three_quarter_left", "front", "smiling"],
  profile_left: ["profile_right", "three_quarter_left", "three_quarter_right"],
  profile_right: ["profile_left", "three_quarter_right", "three_quarter_left"],
  smiling: ["front", "three_quarter_left", "three_quarter_right"],
  over_shoulder: ["profile_left", "profile_right", "three_quarter_left"],
  full_body: ["front", "three_quarter_left", "smiling"],
};

/** The pack's picture for a picture's words: the view that suits it, else the nearest one there; null for an empty pack. */
export function pickView(pack: Partial<Record<IdentityViewId, string>>, words: string): { view: IdentityViewId; id: string } | null {
  const want = viewFor(words);
  for (const v of [want, ...NEAREST[want]]) if (pack[v]) return { view: v, id: pack[v]! };
  return null;
}

/** What drawing some of the views costs: the pack's price for all eight, its share (rounded up, at least 1) for fewer. */
export function identityPrice(full: number, views: number): number {
  if (full <= 0 || views <= 0) return 0;
  return Math.min(full, Math.max(1, Math.ceil((full * views) / IDENTITY_VIEWS.length)));
}
