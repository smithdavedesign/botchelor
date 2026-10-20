import type { NextRequest } from "next/server";
import { chemistryCard } from "@/app/tools/oc-chemistry-test/card";
import { chemistryTest, readChemistryTest } from "@/lib/chemistry-test";

/**
 * The OC chemistry test's share card (og:image): GET /api/chemistry-card?<the result's own query> draws that result,
 * and anything else (no query, or sheets the test refuses) the test's own card. A route rather than an
 * opengraph-image file because the card needs the query, which those never see; under /api, which the 18+ gate skips,
 * so an unfurler always gets it.
 */
export function GET(req: NextRequest) {
  const read = readChemistryTest(req.nextUrl.searchParams);
  return chemistryCard(read.ok ? chemistryTest(read.a, read.b) : null);
}
