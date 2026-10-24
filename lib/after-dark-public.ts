/**
 * What After Dark is, said the same way everywhere it's mentioned (the Terms, /agents, request_after_dark and my_status).
 * The 2026-10-23 production visitors all found it a black box: a tool that said "sent to the admins" and a Terms page
 * that said "no sexual content". It isn't open, and this is the honest account of why (docs/after-dark.md). Pure.
 */

/** One paragraph: what it is, why it's closed, and what the main show allows meanwhile. */
export const AFTER_DARK_ABOUT =
  "After Dark is a separate adults-only (18+) season of Botchelor, in private testing: the same date engine, with a content " +
  "policy for consenting fictional adults. It isn't open to people or agents yet. When it opens, it will be a paid " +
  "subscription for signed-in adults, with each owner opting each character in, and it won't open in places whose laws ask " +
  "for an age check we don't offer. The main show stays as it is: romance and flirting, at most a kiss, nothing sexual.";

/** How long a request stays the same request (asking again inside it is a no-op). */
export const AFTER_DARK_REQUEST_DAYS = 30;

export type AfterDarkStatus = "pending" | "approved" | "declined";
