import { z } from "zod";
import { POST as createEpisode } from "@/app/api/episodes/route";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, passOn, readJson, session } from "@/lib/http";
import { shortName } from "@/lib/names";
import { notify, ownersOf } from "@/lib/notifications";
import { markOvernight, overnightOffer, sayYesToOvernight } from "@/lib/overnight";
import { overnightDatesOn } from "@/lib/overnight-shared";
import { pairKey } from "@/lib/relationships";

// Booking it runs the episodes route in-process, and its after() worker films the whole date here: the same budget.
export const maxDuration = 300;

const id = z.string().trim().min(1).max(64);
const Input = z.object({ character_id: id, partner_id: id });

const NONE = { error: "no_overnight", message: "There's no overnight date on offer for them right now." };

/** The overnight date on offer to this owner for a pair (lib/overnight.ts overnightOffer), or 404. */
export const GET = handle(async (req: Request) => {
  const sess = session(req);
  const q = new URL(req.url).searchParams;
  const offer = sess.isNew ? null : await overnightOffer(await getDb(), sess.userId, q.get("character_id") ?? "", q.get("partner_id") ?? "", { as: q.get("character_id") });
  return offer ? json(offer, 200, sess) : json(NONE, 404, sess);
});

/**
 * An owner says yes to their character's overnight date with that partner. The overnight is the follow-up of the pair's
 * latest aired date, so this is the second-date flow with one more word in it (lib/second-date.ts):
 *  - the milestone must hold on the public record (lib/overnight.ts), and their second date must be plannable;
 *  - the show's own side (a house character, a house-run bot's) and both-yours agree at once, and it's booked now;
 *  - another owner has to say yes to an overnight themselves: this records the yes, tells them, and answers 202. Their
 *    yes, here, books it. A plain second-date yes of theirs is never read as a yes to an overnight.
 * Booked through the episodes route, so it's charged, rate limited, consented and filmed exactly like any second date,
 * at one of the show's evening places; the episode is then marked an overnight date, which only changes how its ending
 * is told. The engine decides that ending like any other.
 */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (!overnightDatesOn()) return json({ error: "not_found" }, 404, sess);
  const db = await getDb();
  const offer = sess.isNew ? null : await overnightOffer(db, sess.userId, input.character_id, input.partner_id, { as: input.character_id });
  if (!offer || offer.mine.id !== input.character_id || offer.them.id !== input.partner_id) return json(NONE, 409, sess);

  await sayYesToOvernight(db, offer.after_episode_id, sess.userId);
  if (offer.needs_their_yes && !offer.they_asked) {
    if (!offer.you_asked) {
      track("overnight_yes", { episode_id: offer.after_episode_id });
      const owners = await ownersOf(db, [offer.them.id]);
      const [lo, hi] = pairKey(offer.mine.id, offer.them.id);
      await notify(db, owners.get(offer.them.id), {
        kind: "second_date_yes",
        title: `🌙 ${shortName(offer.mine.name)} wants an overnight date with ${shortName(offer.them.name)}`,
        body: "The show offered them one: an evening date like any other, and if it goes well the episode ends on them leaving together. Their creator said yes. Say yes too and it's booked, on your dates: whoever says yes last books it.",
        link: `/couples/${lo}/${hi}#overnight`,
      });
    }
    return json(
      { status: "waiting", message: `You said yes. ${shortName(offer.them.name)}'s creator has to say yes to an overnight date too; whoever completes it books the date.` },
      202,
      sess,
    );
  }

  const headers = new Headers(req.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  const res = await createEpisode(
    passOn(
      req,
      new Request(new URL("/api/episodes", req.url), {
        method: "POST",
        headers,
        // The evening place by its venue id (lib/venues.ts venueIdFor reads an id as that venue).
        body: JSON.stringify({ character_id: offer.mine.id, partner_id: offer.them.id, second_date_of: offer.after_episode_id, visibility: "public", place: offer.venue }),
      }),
    ),
  );
  const data = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  if (res.ok && typeof data.id === "string") {
    await markOvernight(db, data.id);
    track("overnight_booked", { episode_id: data.id, by: "owner" });
    return json({ ...data, overnight: true }, res.status, sess);
  }
  return json(data, res.status, sess);
});
