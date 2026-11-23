/**
 * The home clip's plays (app/HomeClip.tsx), counted with the short version's events (app/episodes/[id]/CutPlayer.tsx,
 * the first-minute fixes #1837) so the engagement report reads them the same way: `cut_play` once when it starts, then
 * once, either `cut_ended` (it looped: one whole pass watched) or `cut_left` (gone before that), each with
 * `place: "home"` and `where` it played:
 *   - `home_phone`: on a phone, standing on the stage in the first screen (HOME_PHONE_CLIP, 2026-11-23);
 *   - `home_below`: on a phone, under the box, below the fold (the switch off: the first screen of 2026-11-21);
 *   - `home_wide`: from 861px, beside the words.
 * `cut_play` also says whether it started by itself (`auto`; false: from a tap on its play button, where the visitor
 * asked for less motion or to save data, or the browser wouldn't autoplay) and its length (`of`, seconds). `cut_left`
 * says how (`via`: `tap`, the date opened from it; `hidden`, the page hidden; `away`, the page left inside the app),
 * when (`at`, seconds) and how far (`pct`).
 *
 * Pure, so the plumbing is tested without a browser: no event sends from dev or a headless browser (app/funnel.ts
 * shouldSend). No imports, so it costs the page's script nothing.
 */
export type ClipWhere = "home_phone" | "home_below" | "home_wide";
export type ClipLeave = "tap" | "hidden" | "away";
export type ClipEvent = { name: "cut_play" | "cut_ended" | "cut_left"; props: Record<string, string | number | boolean> };

/** A phone, as the stage layout reads one (app/ux/front.css: the clip on the stage; the wide screen starts at 861px). */
export const PHONE_MEDIA = "(max-width: 860px)";

/** Where a home clip plays: on a phone (PHONE_MEDIA) on the stage or under the box, or on a wide screen. */
export const clipWhere = (phone: boolean, stage: boolean): ClipWhere => (!phone ? "home_wide" : stage ? "home_phone" : "home_below");

export type ClipCounter = {
  /** It started playing: by itself (`auto`), or from a tap on its play button. Counted once. */
  play(auto: boolean, seconds: number): void;
  /** Where it is now (each timeupdate): earlier than the last means it looped, so one whole pass played. */
  at(seconds: number): void;
  /** Gone before a whole pass. True when this sent cut_left (so the caller can send the batch at once). */
  leave(via: ClipLeave, seconds: number): boolean;
};

const whole = (seconds: number) => (Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0);

export function clipCounter(where: ClipWhere, send: (e: ClipEvent) => void): ClipCounter {
  let started = false;
  let settled = false;
  let of = 0;
  let last = 0;
  return {
    play(auto, seconds) {
      if (started) return;
      started = true;
      of = whole(seconds);
      send({ name: "cut_play", props: { place: "home", where, auto, of } });
    },
    at(seconds) {
      if (!started || settled || !Number.isFinite(seconds)) return;
      // Back at the start: the loop came round. (Resting off screen, or a pause, never goes back.)
      if (seconds + 1 < last) {
        settled = true;
        send({ name: "cut_ended", props: { place: "home", where, of } });
        return;
      }
      last = seconds;
    },
    leave(via, seconds) {
      if (!started || settled) return false;
      settled = true;
      const at = whole(seconds);
      send({ name: "cut_left", props: { place: "home", where, via, at, of, pct: of ? Math.min(100, Math.round((100 * at) / of)) : 0 } });
      return true;
    },
  };
}
