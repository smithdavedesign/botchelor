/**
 * The weekly cast-date prize's booking (lib/cast-date.ts): the redeem route (app/api/cast-date/route.ts) books through
 * the ordinary booking route as the winner, on a Request it builds in-process and marks here, and the booking route
 * treats a marked request as show-paid — it spends none of the winner's dates. The same WeakSet pattern as the house
 * booker (lib/house-booker.ts): nothing outside this process can mark a request, so no header or body can claim it.
 */
const prizeRequests = new WeakSet<Request>();

/** Marks a request the redeem route built, after it claimed the prize. */
export function markCastDateRequest(req: Request): Request {
  prizeRequests.add(req);
  return req;
}

/** Whether this booking is a claimed cast-date prize (show-paid). Never true for a request from outside. */
export function isCastDateRequest(req: Request): boolean {
  return prizeRequests.has(req);
}
