import type { ReelShot } from "./reels";

/**
 * Why a video's shots didn't come through, as one line for its owner, from the reasons lib/adult/reels.ts keeps on each
 * failed shot. Null when there's nothing to add (no reason kept, or the owner stopped it). 2026-10-22: Venice ran out
 * of credits, every video failed within two minutes, and the page only said "That video didn't come through".
 */
export function reelFailureNote(shots: Pick<ReelShot, "status" | "reason">[]): string | null {
  const reasons = shots.filter((s) => s.status === "failed" && s.reason && s.reason !== "stopped").map((s) => s.reason as string);
  if (!reasons.length) return null;
  const any = (re: RegExp) => reasons.some((r) => re.test(r));
  // Hive's breaker open (lib/adult/hive-limit.ts, 2026-10-23): nothing it couldn't check was kept.
  const until = pausedUntil(reasons);
  if (until || any(/Hive answered 429/)) {
    return `Hive (the safety check) has hit its limit, so its shots couldn't be checked and weren't kept. Try again ${until ? `after ${until}` : "later"}.`;
  }
  if (any(/Venice 402|insufficient (usd|balance)|diem balance/i)) return "Venice, which makes the videos, is out of credits: top it up at venice.ai/settings/api, then make the video again.";
  if (any(/Venice 40[13]\b/)) return "Venice refused the key: check the Venice key in After Dark's settings.";
  if (any(/Venice 429\b/)) return "Venice is limiting requests right now: try again in a few minutes.";
  if (any(/Venice 5\d\d\b/)) return "Venice had an error on its side: try again in a while.";
  // Replicate, the backup (lib/adult/replicate.ts): it says "You have insufficient credit to run this model" with a 402.
  if (any(/Replicate 402|insufficient credit/i)) return "Replicate, which makes the videos, is out of credit: add some at replicate.com/account/billing, then make the video again.";
  if (any(/Replicate 40[13]\b/)) return "Replicate refused the token: check the Replicate key in After Dark's settings (or the server's REPLICATE_API_TOKEN).";
  if (any(/Replicate 429\b/)) return "Replicate is limiting requests right now: try again in a few minutes.";
  if (any(/Replicate 5\d\d\b/)) return "Replicate had an error on its side: try again in a while.";
  if (any(/Replicate no longer has/)) return "Its shots waited more than an hour to be collected, and Replicate deletes them by then: make the video again and keep the page open.";
  if (any(/gave up waiting/)) return "Its shots took too long, so they were given up on.";
  return `The first error: ${reasons[0].slice(0, 160)}.`;
}

/** "21:45 UTC" from a reason that says Hive is paused until then (lib/adult/hive-limit.ts hivePausedReason); null otherwise. */
export function pausedUntil(reasons: readonly (string | null | undefined)[]): string | null {
  for (const r of reasons) {
    // "Hive is paused until …" now; "over its daily limit, paused until …" on shots kept from before the breaker (#740).
    const m = r?.match(/(?:Hive is paused|over its daily limit, paused) until (\d\d:\d\d UTC)/);
    if (m) return m[1];
  }
  return null;
}
