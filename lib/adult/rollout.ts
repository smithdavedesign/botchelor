/**
 * What of After Dark is built but not open yet (David, 2026-11-13: "until we get a payment system we cannot open it to
 * public. so keep it admin only but build it anyway and we can switch it from admin only later"). Each piece is "admins"
 * (only admins see it, to try it) until it's switched to "everyone" in the settings (Not open yet tab). The pieces are the
 * design review's P3 list (docs/audits/2026-11-11-design-vs-live-and-ux-audit.md): the public door and its day-one set,
 * "Make more" on a night, the phone's ⋯ sheet in the theater, and the chapter reader.
 * Client-safe: no server imports (the settings page shares it).
 */
import { z } from "zod";

export const ROLLOUT_AUDIENCES = ["admins", "everyone"] as const;
export type RolloutAudience = (typeof ROLLOUT_AUDIENCES)[number];

export const ROLLOUT_FEATURES = [
  {
    key: "public_door",
    label: "The public door",
    note:
      "The After Dark door in the header for every adult where After Dark isn't blocked, landing on the subscribe page (taste, invite request, waitlist) instead of not-found, and the arrival screen once a session. On admins only, admins see the arrival screen; the landing is previewed with ?preview=visitor. Needs payments before everyone.",
  },
  {
    key: "make_more",
    label: "Make more",
    note: "One priced menu on a night for everything that makes more (the video, a picture, draw ahead, a talking moment, a new place, the Studio, Keep going and Fix), in place of the separate buttons.",
  },
  {
    key: "phone_sheet",
    label: "The phone's ⋯ sheet",
    note: "On a phone the theater keeps the chapter chip, play and Listen, and folds every other tool into one ⋯ sheet from the bottom.",
  },
  {
    key: "reader",
    label: "The chapter reader",
    note: "📖 Read it on a night: its chapters at reading size, a quiet way to read one again (?view=reader). The theater stays the page.",
  },
] as const;
export type RolloutFeature = (typeof ROLLOUT_FEATURES)[number]["key"];

const audience = z.enum(ROLLOUT_AUDIENCES);
export const RolloutConfig = z.object({
  public_door: audience.default("admins"),
  make_more: audience.default("admins"),
  phone_sheet: audience.default("admins"),
  reader: audience.default("admins"),
});
export type RolloutConfig = z.infer<typeof RolloutConfig>;

/** The stored value with defaults filled in; anything unreadable is every piece on admins only (the safe side). */
export function rolloutConfigOf(raw: unknown): RolloutConfig {
  const parsed = RolloutConfig.safeParse(raw && typeof raw === "object" ? raw : {});
  return parsed.success ? parsed.data : RolloutConfig.parse({});
}

/** The keys named replace the stored ones; a bad value throws (the settings route says what was wrong). */
export function mergeRolloutConfig(before: RolloutConfig, patch: Record<string, unknown>): RolloutConfig {
  const unknown = Object.keys(patch).filter((k) => !ROLLOUT_FEATURES.some((f) => f.key === k));
  if (unknown.length) throw new Error(`Not a piece that can be opened: ${unknown.join(", ")}`);
  return RolloutConfig.parse({ ...before, ...patch });
}

/** Whether this viewer sees a piece: everyone once it's opened, admins always. */
export function rolloutOn(cfg: RolloutConfig | null | undefined, feature: RolloutFeature, admin: boolean): boolean {
  return admin || (cfg ?? RolloutConfig.parse({}))[feature] === "everyone";
}
