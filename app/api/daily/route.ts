import { z } from "zod";
import { track } from "@/lib/analytics";
import { dailyEpisodeId, dailyReveal, ensureDailyEpisodeId } from "@/lib/daily";
import { dailyNumberAt } from "@/lib/daily-shared";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { ENDINGS } from "@/lib/rules";

export const dynamic = "force-dynamic";

const DailyPickInput = z.object({
  n: z.number().int().min(1).max(999_999),
  pick: z.enum(ENDINGS),
});

/**
 * POST /api/daily { n, pick }: the Daily Date's reveal (lib/daily.ts). A pick for day n gets that day's date back,
 * ending and all, and whether the pick was right. No account and no cookie: the streak is the browser's
 * (lib/daily-shared.ts), and nothing about the visitor is stored. A past day's answer is on /daily/{n} anyway, so it can
 * be checked too; a day to come, or one nobody dealt, is a 404.
 */
export const POST = handle(async (req) => {
  const input = parseBody(DailyPickInput, await readJson(req), "invalid_daily_pick");
  const today = dailyNumberAt(new Date());
  if (input.n > today) return json({ error: "daily_not_found", message: "That Daily Date hasn't happened yet." }, 404);
  const db = await getDb();
  const episodeId = input.n === today ? await ensureDailyEpisodeId(db, input.n) : await dailyEpisodeId(db, input.n);
  const reveal = episodeId ? await dailyReveal(db, input.n, episodeId, input.pick) : null;
  if (!reveal) return json({ error: "daily_not_found", message: "There's no Daily Date for that day." }, 404);
  track("daily_pick", { n: input.n, correct: reveal.correct, today: input.n === today });
  return json(reveal);
});
