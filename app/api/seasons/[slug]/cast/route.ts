import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { liveSeasonFormat, loadSeasonPoster, seasonCastLines } from "@/lib/season-page";
import { seasonIdFromSlug } from "@/lib/season-ref";
import { shotsFor } from "@/lib/show-shots-sql";

/**
 * A lead season's cast, public (the poster's: app/seasons/season-poster.tsx): the lead with their rose shot when their
 * show kit has one, the suitors (in preseason, casting's top of the vote), each with their bio's first sentence, and
 * the season's words. The cast reveal video reads it (scripts/clips/season-promo.mjs). 404 for a month that isn't a
 * lead season this month or next.
 */
export const GET = handle(async (_req, ctx: { params: Promise<{ slug: string }> }) => {
  const id = seasonIdFromSlug((await ctx.params).slug);
  if (!id) return json({ error: "not_a_season", message: "That isn't a season." }, 404);
  const db = await getDb();
  const live = await liveSeasonFormat(db, id);
  if (!live) return json({ error: "no_cast", message: "That season has no lead cast to show." }, 404);
  const d = await loadSeasonPoster(db, id, live.phase, live.def);
  const cast = await seasonCastLines(db, d);
  const rose = d.lead ? ((await shotsFor(db, [d.lead.id]))[d.lead.id]?.rose ?? null) : null;
  return json(
    {
      season: { id, number: d.season.number, label: d.season.label, month: d.month, path: d.season.path, phase: d.phase, title: d.def.title, pitch: d.def.pitch, places: d.places, arc: d.arc },
      lead: cast.lead ? { ...cast.lead, rose } : null,
      faces: cast.faces,
      faces_are: d.facesAre,
    },
    200,
  );
});
