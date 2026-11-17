/**
 * After Dark's narrated style (lib/narration.ts): a step's new lines wrapped in prose, once they've passed every check
 * the step makes. The prose answers to the same lines (checkAdultText) and to the viewer's own hard nos; a line whose
 * prose doesn't come, or fails, stays as it was written.
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";
import type { Model, Usage } from "../model";
import { narrate, type NarrateLine, type WritingStyle } from "../narration";
import { styleFor, stylesAudience } from "../writing-style";
import { rolloutOn } from "./rollout";
import { getAdultSettings } from "./settings";
import { shortName } from "../names";
import { hardNoHit, hasHardNos, type PairLimits } from "./limits";
import type { SceneLine } from "./scenes";

/**
 * Whether After Dark's narrated style and chapter stories are open to this viewer: admins, and everyone it's open to
 * once the "narrated" rollout switch says so (lib/adult/rollout.ts); never while WRITING_STYLES is off.
 */
export async function adultNarratedOpen(db: Db, viewer: string): Promise<boolean> {
  if (stylesAudience() === "off") return false;
  const [admin, settings] = await Promise.all([isAdmin(db, viewer).catch(() => false), getAdultSettings(db)]);
  return rolloutOn(settings.rollout, "narrated", admin);
}

/** The style this viewer's nights are written in: what they picked, while it's open to them. */
export async function adultStyleFor(db: Db, viewer: string): Promise<WritingStyle> {
  const open = await adultNarratedOpen(db, viewer);
  return open ? styleFor(db, viewer, "adult", { adultOpenToAll: true }) : "script";
}

/** What narrating a step did, kept on the step's log. */
export type NarrationReport = { beats: number; of: number; held: number; worn: number; failed: boolean; ms: number; input_tokens: number; output_tokens: number; cost_usd: number | null };

/** A scene line's *actions* and its words apart, as the narrator reads them. */
export function splitLine(text: string): { dialogue: string; action: string } {
  const actions: string[] = [];
  const said = text
    .replace(/\*+([^*]*?)\*+/g, (_, act: string) => {
      if (act.trim()) actions.push(act.trim());
      return " ";
    })
    .replace(/\*([^*]*)$/, (_, act: string) => {
      if (act.trim()) actions.push(act.trim());
      return " ";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
  return { dialogue: /^["'“”‘’.…\s]*$/.test(said) ? "" : said, action: actions.join("; ") };
}

export const sceneLineToNarrate = (l: Pick<SceneLine, "who" | "text">, names: { a: string; b: string }): NarrateLine => ({
  who: l.who === "a" ? names.a : names.b,
  ...splitLine(l.text),
});

/**
 * `all` with prose on the lines from `from` on (this step's). `before`: the lines before them, read for flow. Never
 * throws: a narration that fails leaves the lines as they were.
 */
export async function narrateStep(
  model: Model,
  all: readonly SceneLine[],
  from: number,
  pair: { a: string; b: string },
  place: string | null,
  limits: Pick<PairLimits, "hard_nos">,
  before: readonly SceneLine[] = [],
  onReport?: (r: NarrationReport) => void,
): Promise<SceneLine[]> {
  const fresh = all.slice(from);
  if (!fresh.length) return [...all];
  const used: Usage[] = [];
  const t0 = Date.now();
  const names = { a: shortName(pair.a), b: shortName(pair.b) };
  const extra = hasHardNos(limits.hard_nos) ? (t: string) => hardNoHit(t, limits.hard_nos) : undefined;
  const done = await narrate(model, {
    rating: "adult",
    people: [{ name: names.a }, { name: names.b }],
    place,
    lines: fresh.map((l) => sceneLineToNarrate(l, names)),
    before: before.slice(-6).map((l) => sceneLineToNarrate(l, names)),
    ...(extra ? { extra } : {}),
  }, { onUsage: (u) => void used.push(u) }).catch(() => null);
  // What it did and cost, for the step's log (lib/adult/steps.ts flags.narration): docs/writing-styles.md reads it.
  onReport?.({
    beats: done ? done.beats.filter(Boolean).length : 0,
    of: fresh.length,
    held: done?.held ?? 0,
    worn: done?.worn ?? 0,
    failed: !done || done.failed,
    ms: Date.now() - t0,
    input_tokens: used.reduce((n, u) => n + u.input, 0),
    output_tokens: used.reduce((n, u) => n + u.output, 0),
    cost_usd: used.some((u) => typeof u.cost === "number") ? Math.round(used.reduce((n, u) => n + (u.cost ?? 0), 0) * 1e6) / 1e6 : null,
  });
  if (!done) return [...all];
  return [...all.slice(0, from), ...fresh.map((l, i) => (done.beats[i] ? { ...l, beat: done.beats[i]! } : l))];
}
