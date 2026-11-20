/**
 * The site's way into the derivations (lib/social/derive.ts): one call where something public happens (a date aired, a
 * scene stored, a link written, a season cast, a character saved). Best effort: nothing when SOCIAL_TIES is off, and a
 * failure is logged, never thrown, so the date or scene that called it carries on as before.
 *
 * In a request (a page, a route, the hourly job) the work runs after the response, one derivation at a time across the
 * process, and a derivation already waiting with the same `key` isn't queued twice (it reads the record when it runs, so
 * it sees both changes). Outside one (tests, scripts) it runs at once. Each run writes for at most HOOK_BUDGET_MS; the
 * hourly backfill finishes whatever it leaves. derive.ts is loaded only when a hook runs, so a module that hooks in
 * doesn't take the social code into its own imports.
 */
import { socialDeriveOn } from "./switch";

type Env = Record<string, string | undefined>;
type Derive = typeof import("./derive");

/** How long one hook's derivation may write for. */
export const HOOK_BUDGET_MS = 20_000;

/** The process's queue of derivations waiting for their turn, and the keys of those not yet started (with when). */
let queue: Promise<void> = Promise.resolve();
const waiting = new Map<string, number>();
/** A key waiting longer than this (a response that never closed) no longer holds the next one back. */
const WAIT_STALE_MS = 10 * 60_000;

/**
 * Runs one derivation for a hook. `run` gets derive.ts and its deadline (epoch ms); `label` names it in the log when it
 * fails; `key` says which derivation it is (`house`, `dated:<lo>|<hi>`), so a second one waiting is dropped.
 */
export async function socialHook(label: string, run: (derive: Derive, deadline: number) => Promise<unknown>, o: { key?: string; env?: Env } = {}): Promise<void> {
  if (!socialDeriveOn(o.env)) return;
  const go = async (): Promise<void> => {
    try {
      await run(await import("./derive"), Date.now() + HOOK_BUDGET_MS);
    } catch (err) {
      console.error(`[social] ${label} failed:`, err instanceof Error ? err.message : String(err));
    }
  };
  if (o.key && Date.now() - (waiting.get(o.key) ?? 0) < WAIT_STALE_MS) return;
  try {
    const { after } = await import("next/server");
    const key = o.key;
    after(() => {
      queue = queue.then(() => {
        if (key) waiting.delete(key);
        return go();
      });
      return queue;
    });
    if (key) waiting.set(key, Date.now());
  } catch {
    // Not in a request (a test, a script): run it now.
    await go();
  }
}
