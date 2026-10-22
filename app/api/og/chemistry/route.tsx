import type { NextRequest } from "next/server";
import { chemistryCard } from "@/app/tools/oc-chemistry-test/card";
import { chemistryTest, readPair } from "@/lib/chemistry";

/**
 * GET /api/og/chemistry?a_name=…&b_…: the share card of an OC chemistry test result, the image its og:image points
 * at. The same address as the result (the two sheets), so the card is a pure function of it: no database, no model.
 * Sheets the test refuses get the test's own card, never what was typed.
 */
export function GET(req: NextRequest) {
  const pair = readPair(req.nextUrl.searchParams);
  if (!pair.ok) return chemistryCard(null);
  const { score, ending } = chemistryTest(pair.a, pair.b);
  return chemistryCard({ a: pair.a.name, b: pair.b.name, score, ending });
}
