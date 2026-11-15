import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { clipStory } from "@/lib/producer";

export const dynamic = "force-dynamic";

/**
 * The day's story from the producer (lib/producer.ts clipStory), for the clip pipeline (scripts/clips): today's
 * "Previously" and "Tonight" lines and logline, and the aired public dates the last few days' beats are about, so the
 * daily clip can be the episode the story is about and its caption can carry the logline. Public: every line passed
 * the PG checks when it was stored, and only aired public dates are listed. Empty when there is no beat.
 */
export const GET = handle(async () => json(await clipStory(await getDb())));
