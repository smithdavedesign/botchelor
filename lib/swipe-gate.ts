/**
 * The swipe gate (docs/swipes.md, M2). A first date with anyone but this season's house cast starts with a match
 * where both characters said yes to a date (lib/swipes.ts). Couples who've dated carry on as before: they can book
 * again, propose, and perform dates together. SWIPE_GATE=0 turns the gate off.
 *
 * No imports from the rest of lib, so the date paths (the episodes route, lib/own-date.ts, lib/date-proposals.ts,
 * lib/dating.ts) can all use it without a cycle.
 */
import type { Db } from "./db";

let gateForTests: boolean | null = null;

/** Tests choose the gate (the shared harness turns it off, so the flows from before it keep their tests). */
export function setSwipeGateForTests(on: boolean | null): void {
  gateForTests = on;
}

export function swipeGateOn(env: Record<string, string | undefined> = process.env): boolean {
  return gateForTests ?? env.SWIPE_GATE?.trim() !== "0";
}

/** What a date that needs a match says (go_on_date, a proposal, a two-agent date). */
export const MATCH_FIRST =
  "Match first: swipe for them (the /swipe page, or swipe_deck and swipe over MCP). When both characters say yes to a date, it's yours to book. This season's house cast is always available.";

/** SQL that's true when the character (`alias`) and `otherParam` have been on an aired date together. */
export const datedSql = (alias: string, otherParam: string) => `exists (
  select 1 from relationships r
   where r.dates > 0
     and ((r.character_a = ${alias}.id and r.character_b = ${otherParam}::text) or (r.character_a = ${otherParam}::text and r.character_b = ${alias}.id)))`;

/** True when the two characters have been on an aired date together. */
export async function haveDated(db: Db, x: string, y: string): Promise<boolean> {
  const [a, b] = x < y ? [x, y] : [y, x];
  return (await db.query(`select 1 from relationships where dates > 0 and character_a = $1 and character_b = $2`, [a, b])).rows.length > 0;
}
