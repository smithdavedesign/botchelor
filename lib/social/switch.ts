/**
 * The social network's core switches (docs/PRDs/social-network.md section 11). Each is on unless set to "0"; off means
 * the site behaves exactly as before: no social write, no derivation, no social read, and the API routes answer 404.
 * Phases 2b, 3 and 4 add their own switches (SOCIAL_LENSES, SOCIAL_PEOPLE_IN_PROMPTS, SOCIAL_DYNAMICS, SOCIAL_METRICS)
 * in their own files; each of those is off whenever SOCIAL_TIES is.
 */
type Env = Record<string, string | undefined>;

/** All social writes and reads, the derivations and the API routes. */
export const socialTiesOn = (env: Env = process.env): boolean => env.SOCIAL_TIES?.trim() !== "0";

/** Owner and agent declarations and proposals (Phase 2b). Off whenever SOCIAL_TIES is. */
export const socialDeclareOn = (env: Env = process.env): boolean => socialTiesOn(env) && env.SOCIAL_DECLARE?.trim() !== "0";

/** Tests turn the derivations off by default (tests/helpers.ts startTestDb), so an unrelated test's dates write no ties. */
let derivingInTests: boolean | null = null;

/**
 * The derivations (lib/social/derive.ts): what aired makes ties. On with SOCIAL_TIES; in tests only when a test asks
 * (setSocialDerivingForTests).
 */
export const socialDeriveOn = (env: Env = process.env): boolean => socialTiesOn(env) && derivingInTests !== false;

/** Tests only: false turns the derivations off (startTestDb does), true back on, null back to the switch alone. */
export function setSocialDerivingForTests(on: boolean | null): void {
  derivingInTests = on;
}
