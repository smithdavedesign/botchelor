/**
 * Said on `window` when a date was just booked (spent): the header's "dates left" reads its count again at once
 * (app/Nav.tsx) instead of on the next focus or visit (2026-11-22 audit: it still said 3 after the first date).
 */
export const SPENT_EVENT = "bz:spent";

export function saySpent(): void {
  try {
    window.dispatchEvent(new Event(SPENT_EVENT));
  } catch {
    // Not in a browser: nobody to tell.
  }
}
