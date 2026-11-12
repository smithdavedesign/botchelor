/**
 * A reel making for longer than this is called stuck (David, 2026-10-21: "it says a video is already being made… but I
 * think it's stuck"): a shot usually comes back in a few minutes. The owner can stop it then (stopReel in reels.ts),
 * getting back the share of tokens for the shots that never came. Its own file so the page can use it too.
 */
export const REEL_STALLED_MS = 30 * 60 * 1000;

/** Lines the owner can add to a storyboard at once (David, 2026-11-04: "choose 1 up to 4 lines from the transcript"). */
export const PICK_LINES_MAX = 4;

/**
 * Filming one shot of a finished video again (lib/adult/reels.ts refilmShot), for someone who pays: a clip at a clip's
 * price (#1005: an extra at about cost, even inside the month's included clips), a night's shot its share of the video.
 * Here so the 🔁 button can say it (the kit's price rule) and the server charge it from the one sum.
 */
export const refilmTokens = (kind: string | null | undefined, shots: number, prices: { clip_tokens: number; reel_tokens: number }): number =>
  kind === "clip" ? prices.clip_tokens : Math.max(1, Math.ceil(prices.reel_tokens / Math.max(1, shots)));

/** A video's price as its buttons say it: its tokens, or on the viewer's own key (Connections, After Dark videos: 0). */
export const videoPrice = (tokens: number): string => (tokens > 0 ? `${tokens} tokens` : "on your key");
