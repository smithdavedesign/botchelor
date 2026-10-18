import { shortName } from "@/lib/names";
import { z } from "zod";
import { dateLabel } from "@/lib/rules";
import { POST as createEpisode } from "@/app/api/episodes/route";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { notify, ownersOf } from "@/lib/notifications";
import { sayYesToSecondDate, secondDateState } from "@/lib/second-date";

type Ctx = { params: Promise<{ id: string }> };

// Booking it runs the episodes route in-process, and its after() worker films the whole date here: the same budget.
export const maxDuration = 300;

const REASONS: Record<string, string> = {
  not_ready: "Their first date is still being filmed.",
  not_mutual: "A second date happens only when they both want one, and this time they didn't.",
  planned: "Their second date is already booked.",
  blocked: "That match is no longer available.",
  partner_gone: "That character's creator has left the show.",
};

/** Where this date's second date stands, for one of its owners (lib/second-date.ts). */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const state = await secondDateState(await getDb(), id, sess.userId);
  if (!state) return json({ error: "not_your_date", message: "Only an owner of one of the two characters can see this." }, 403, sess);
  return json({ episode_id: id, ...state }, 200, sess);
});

const Input = z.object({ visibility: z.enum(["public", "private", "unlisted"]).optional() });

/**
 * An owner says yes to their characters' second date. When the other owner has already agreed (or doesn't need
 * to: a house character, or one that's open to dates), this books it like any date (a token, the same limits), and
 * it happens where they planned it. Otherwise it records the yes and waits for theirs (202).
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const input = parseBody(Input, await readJson(req).catch(() => ({})), "invalid_request");
  const db = await getDb();

  const state = await secondDateState(db, id, sess.userId);
  if (!state) return json({ error: "not_your_date", message: "Only an owner of one of the two characters can plan their second date." }, 403, sess);
  if (!state.can_plan) {
    const r = state.reason ?? "unavailable";
    return json({ error: r, message: REASONS[r] ?? "Not available.", ...(state.planned_episode_id ? { episode_id: state.planned_episode_id } : {}) }, 409, sess);
  }

  await sayYesToSecondDate(db, id, sess.userId);
  if (state.needs_their_yes && !state.they_asked) {
    if (!state.you_asked) {
      track("second_date_yes", { episode_id: id });
      // Tell the other character's creator: their yes completes it.
      const owners = await ownersOf(db, [state.my_character_id, state.partner_character_id]);
      const mine = (await db.query<{ name: string }>(`select name from characters where id = $1`, [state.my_character_id])).rows[0]?.name ?? "Their date";
      await notify(db, owners.get(state.partner_character_id), {
        kind: "second_date_yes",
        title: `💌 ${shortName(mine)} wants a ${dateLabel(state.next_date_number).toLowerCase()} with ${shortName(state.partner_name)}`,
        body: "Their creator said yes. Say yes too and it's booked.",
        link: `/episodes/${id}`,
      });
    }
    return json(
      { episode_id: id, status: "waiting", message: `You said yes. ${state.partner_name}'s creator has to say yes too; whoever completes it books the date.` },
      202,
      sess,
    );
  }

  // Booked through the episodes route, so it's charged, rate limited and generated exactly like any date.
  const headers = new Headers(req.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  return createEpisode(
    new Request(new URL("/api/episodes", req.url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        character_id: state.my_character_id,
        partner_id: state.partner_character_id,
        second_date_of: id,
        ...(input.visibility ? { visibility: input.visibility } : {}),
      }),
    }),
  );
});
