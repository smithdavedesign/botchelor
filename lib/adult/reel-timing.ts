/**
 * A reel making for longer than this is called stuck (David, 2026-10-21: "it says a video is already being made… but I
 * think it's stuck"): a shot usually comes back in a few minutes. The owner can stop it then (stopReel in reels.ts),
 * getting back the share of tokens for the shots that never came. Its own file so the page can use it too.
 */
export const REEL_STALLED_MS = 30 * 60 * 1000;

/** A video's price as its buttons say it: its tokens, or on the viewer's own key (Connections, After Dark videos: 0). */
export const videoPrice = (tokens: number): string => (tokens > 0 ? `${tokens} tokens` : "on your key");
