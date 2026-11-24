/**
 * Who reads a Step in scene's continuity sheet (lib/adult/step-in-tracker.ts; the read itself is lib/adult/step-in.ts
 * stepInTrack): After Dark's own model, the one its notes and its story are read on. Apart from both so a test can
 * script the reads, or leave them off, without touching the writer's model: a read runs past the response, so in a
 * test it would land in the writer's scripted model at no particular moment (tests start with it off, as they do with
 * a picture's brief: tests/setup-no-live-checks.ts).
 */
import type { Db } from "../db";
import type { Model } from "../model";
import { adultModel } from "./mode";

/** A read gives up after this long and isn't tried again: the next reply's read covers the same lines. */
export const TRACKER_TIMEOUT_MS = 20_000;

/**
 * The switch nobody should need: STEP_IN_TRACKER=off in After Dark's environment stops the reads and stops the sheet
 * being said to the writer (the sheets already kept stay where they are). The sheet is beside every reply's prompt, so
 * if a model ever starts keeping it badly this turns it off without a change of code.
 */
export const trackerOn = (env: Record<string, string | undefined> = process.env): boolean => (env.STEP_IN_TRACKER ?? "").trim().toLowerCase() !== "off";

let testModel: Model | null | undefined;
/** A scripted model for the sheet's reads (tests); null turns them off. Unset, they run on After Dark's own model. */
export function setTrackerModelForTests(model: Model | null | undefined): void {
  testModel = model;
}

/** The model a sheet is read on; null when reads are off. */
export async function trackerModel(db: Db): Promise<Model | null> {
  if (!trackerOn()) return null;
  if (testModel !== undefined) return testModel;
  return adultModel(db, process.env, { timeoutMs: TRACKER_TIMEOUT_MS, retryDelaysMs: [] });
}
