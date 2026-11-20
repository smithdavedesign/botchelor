import { z } from "zod";
import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { circleSummaries, showCharacterIds, showCharacters, worldMenu, writeCircle, type CircleResult } from "@/lib/social/circles";
import { socialTiesOn } from "@/lib/social/switch";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const id = z.string().trim().min(1).max(64);
// Generous bounds: an item past the social limits (a name over 40, a note over 160) is refused alone by lib/social/circles.ts,
// so one long note doesn't sink the rest of a character's circle.
const words = (max: number) => z.string().max(max).nullish();
const Person = z.object({
  name: z.string().max(120),
  relation: z.string().max(80),
  pronouns: words(40),
  note: words(400),
  deceased: z.boolean().optional(),
  story: words(600),
  since: words(120),
});
const Place = z.object({ role: z.string().max(20), place: words(120), name: words(120), neighbourhood: words(80), description: words(400), since: words(120) });
const Tie = z.object({ with: id, relation: z.string().max(80), reversed: z.boolean().optional(), story: words(600), since: words(120) });
const Circle = z.object({ character_id: id, people: z.array(Person).max(20).optional(), places: z.array(Place).max(12).optional(), ties: z.array(Tie).max(8).optional() });
const Input = z.object({
  /** The model that wrote these (the deployment that answered) and its prompt's version: on every row, for the dataset. */
  origin_model: z.string().trim().min(1).max(120),
  prompt_version: z.string().trim().min(1).max(60),
  /** Write over the show's earlier circle for a character (never what an owner or agent declared). */
  replace: z.boolean().optional(),
  /** Check everything, write nothing. */
  dry_run: z.boolean().optional(),
  circles: z.array(Circle).min(1).max(5),
});

/**
 * Admin only (the admin password or a signed-in admin): the show's own characters, a page at a time, with what a writer
 * needs for their circles (who they are, whom they've dated, their circle so far) and the world to pick places from.
 * `?missing=1` lists only those without the show's circle. scripts/social/backfill-circles.mjs reads it.
 */
export const GET = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 200));
  const db = await getDb();
  const page = await showCharacters(db, { after: url.searchParams.get("after") ?? undefined, limit });
  const missing = url.searchParams.get("missing") === "1";
  const summaries = await circleSummaries(db, page.map((c) => c.id));
  return json({
    on: socialTiesOn(),
    characters: page.filter((c) => !missing || !c.has_circle).map((c) => ({ ...c, circle: summaries.get(c.id) })),
    next: page.length === limit ? page[page.length - 1].id : null,
    world: await worldMenu(db),
  });
});

/**
 * Admin only: writes circles for the show's own characters (lib/social/circles.ts writeCircle), as the house, with the
 * model and prompt version that wrote them. Every item is checked (the registry, the show's text check, the caps, the
 * places' kinds, show characters only, no family between two who've dated); what fails is refused alone and said.
 * A character that has the show's circle already is skipped unless `replace`. `dry_run` checks and writes nothing.
 */
export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (!socialTiesOn()) return json({ error: "off", message: "The social network is off (SOCIAL_TIES=0)." }, 409);
  const db = await getDb();
  const show = await showCharacterIds(db, [...new Set(input.circles.flatMap((c) => [c.character_id, ...(c.ties ?? []).map((t) => t.with)]))]);
  const results: CircleResult[] = [];
  for (const c of input.circles) {
    results.push(
      await writeCircle(
        db,
        c,
        { source: "house", origin_model: input.origin_model, prompt_version: input.prompt_version, replace: input.replace, dryRun: input.dry_run },
        { show },
      ),
    );
  }
  const totals = results.reduce(
    (t, r) => ({ people: t.people + r.people, places: t.places + r.places, ties: t.ties + r.ties, refused: t.refused + r.refused.length }),
    { people: 0, places: 0, ties: 0, refused: 0 },
  );
  return json({ dry_run: input.dry_run === true, results, totals });
});
