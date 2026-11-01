/**
 * The house as a booker (David 2026-11-01: the season's house cast can fill mixer seats too). Every mixer seat books its
 * own rotation through the booking route as that seat's owner, and the house cast has no owner, so the house books the
 * cast's rotations itself, as HOUSE_BOOKER, and pays for them (they're house_paid, lib/mixer-fill.ts).
 *
 * Only the mixer run can act as the house: it marks the Request objects it builds in-process (lib/group-dates-run.ts),
 * and the route lets HOUSE_BOOKER book a house character only on a marked request — a WeakSet nothing outside this
 * process can join, so a cookie that happens to carry this id is just an anonymous visitor with no characters.
 */

/** The house's own booker id: a fixed UUID, because session ids are UUIDs (lib/http.ts readUserId). */
export const HOUSE_BOOKER = "00000000-0000-4000-8000-00000000b0b0";

const houseRequests = new WeakSet<Request>();

/** Marks a request the mixer run built to book a house character's rotation. */
export function markHouseRequest(req: Request): Request {
  houseRequests.add(req);
  return req;
}

/** Whether this request is one the mixer run built for the house (never true for anything from outside). */
export function isHouseRequest(req: Request): boolean {
  return houseRequests.has(req);
}
