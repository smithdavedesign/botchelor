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
