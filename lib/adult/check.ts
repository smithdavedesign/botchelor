/**
 * After dark's output check (docs/after-dark.md #1; David, 2026-10-18: "Hive is fine", nothing Amazon). Every picture or
 * clip fal returns is checked BEFORE it is stored; a failure is discarded, never stored, and only the reason is logged.
 *
 * Two Hive calls on the returned file:
 *  1. Visual moderation: refuse if a child is present or the child-safety head fires.
 *  2. Demographics (face age): refuse if any face reads as a teenager or younger, or if no face can be found to check.
 * Hive's docs don't publish the face response's exact shape, so every { class, score } pair anywhere in the reply is
 * read, and the check FAILS CLOSED: no key, an error, an unreadable reply, or no face found is a refusal.
 * Self-serve Hive doesn't include its CSAM classifier (Enterprise only); add it before anyone but the admin uses this.
 */

export type CheckResult = { ok: true } | { ok: false; reason: string };

/** Hive's one endpoint for both projects (each project has its own key). */
export const HIVE_SYNC = "https://api.thehive.ai/api/v2/task/sync";

/** Refuse at this score or above: deliberately low, so anything borderline is thrown away. */
export const CHILD_SCORE = 0.05;
export const MINOR_AGE_SCORE = 0.05;
const MODERATION_CHILD = ["yes_child_present", "yes_child_safety"];
const MINOR_AGES = ["teenager", "pre_teen", "toddler", "baby"];

type Fetch = typeof fetch;
let testFetch: Fetch | null = null;
export function setCheckFetchForTests(f: Fetch | null): void {
  testFetch = f;
}
const doFetch: Fetch = (...a) => (testFetch ?? fetch)(...a);

/** Every { class, score } pair in a reply, wherever it sits (per frame, per face). */
export function classScores(body: unknown): { cls: string; score: number }[] {
  const out: { cls: string; score: number }[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.class === "string" && typeof o.score === "number") out.push({ cls: o.class, score: o.score });
      Object.values(o).forEach(walk);
    }
  };
  walk(body);
  return out;
}

/** The face detections in a demographics reply: objects carrying age classes (one per face, per frame). */
export function faceCount(body: unknown): number {
  let faces = 0;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const own = Array.isArray(o.classes) ? (o.classes as { class?: string }[]) : [];
      if (own.some((c) => typeof c?.class === "string" && [...MINOR_AGES, "adult", "middle_aged", "senior", "other_age"].includes(c.class))) faces++;
      Object.values(o).forEach(walk);
    }
  };
  walk(body);
  return faces;
}

async function hive(key: string, url: string): Promise<unknown> {
  const form = new FormData();
  form.set("url", url);
  const res = await doFetch(HIVE_SYNC, { method: "POST", headers: { accept: "application/json", authorization: `token ${key}` }, body: form });
  if (!res.ok) throw new Error(`Hive answered ${res.status}`);
  return res.json();
}

/** Checks a file fal returned (by its URL). Never throws: any failure is a refusal. */
export async function checkOutput(keys: { hive_mod: string | null; hive_demo: string | null }, url: string): Promise<CheckResult> {
  if (!keys.hive_mod || !keys.hive_demo) return { ok: false, reason: "the output check isn't set up (both Hive keys are needed)" };
  try {
    const [mod, demo] = await Promise.all([hive(keys.hive_mod, url), hive(keys.hive_demo, url)]);
    const modScores = classScores(mod);
    if (!modScores.length) return { ok: false, reason: "moderation reply had no scores" };
    const child = modScores.find((s) => MODERATION_CHILD.includes(s.cls) && s.score >= CHILD_SCORE);
    if (child) return { ok: false, reason: `moderation: ${child.cls} ${child.score.toFixed(2)}` };
    if (faceCount(demo) === 0) return { ok: false, reason: "no face found to check the age of" };
    const minor = classScores(demo).find((s) => MINOR_AGES.includes(s.cls) && s.score >= MINOR_AGE_SCORE);
    if (minor) return { ok: false, reason: `face age: ${minor.cls} ${minor.score.toFixed(2)}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `the check couldn't run (${err instanceof Error ? err.message : "error"})` };
  }
}
