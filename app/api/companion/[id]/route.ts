import { z } from "zod";
import { getDb } from "@/lib/db";
import { ensureFaceKit } from "@/lib/face-kit";
import { handle, json, parseBody, passOn, readJson, session } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";
import { inBackground } from "@/lib/sets";
import { requestBase } from "@/lib/site";
import { track } from "@/lib/analytics";
import {
  carryOn,
  COMPANION_GUEST_IP_LIMITS,
  COMPANION_LIMITS,
  COMPANION_MESSAGE_MAX,
  COMPANION_REPORT_REASONS,
  companionFollowUp,
  continueReply,
  deleteThread,
  editLast,
  getThread,
  regenerate,
  reportMessage,
  REPLY_LENGTHS,
  SCENE_PLACES,
  sendMessage,
  setReplyLength,
  setTexts,
  setScene,
  swipeReply,
  type CompanionSend,
} from "@/lib/companion";
import type { VenueId } from "@/lib/venues";
import { companionAllowance, giveBackReply, takeReply } from "@/lib/companion-plan";
import { extrasState } from "@/lib/companion-extras";
import { voiceNote } from "@/lib/companion-voice";
import { companionRefusal } from "../access";
import { bookingAsk } from "@/lib/date-roleplays";
import { CARD_OPENING_MAX } from "@/lib/scene-cards";
import { POST as createEpisode } from "@/app/api/episodes/route";
import { POST as bookSecondDate } from "@/app/api/episodes/[id]/second-date/route";
import { POST as bookOvernight } from "@/app/api/overnight/route";
import { COMPANION_OFFER_KINDS, type CompanionOfferKind } from "@/lib/companion-shared";
import { loadOffer, markOfferTaken, nobodyNewLines, offerLines, outOfDatesLines, pickSomeoneNew } from "@/lib/companion-offers";
import { postFromCharacter } from "@/lib/companion";
import { firstDateFormat } from "@/lib/first-date";
import { takeAnswer } from "./answer";

type Ctx = { params: Promise<{ id: string }> };

// A chip that books a date runs the episodes route in-process, and its after() worker films the whole date here: the same
// budget the second-date route gives itself.
export const maxDuration = 300;

const Action = z.discriminatedUnion("action", [
  // `call`: said on a voice call in the app (the browser heard it); the reply is short, to be spoken aloud.
  z.object({ action: z.literal("send"), text: z.string().max(COMPANION_MESSAGE_MAX * 2), call: z.boolean().optional() }),
  z.object({ action: z.literal("regenerate") }),
  // The newest reply's other draws (lib/companion.ts swipeReply): the one before or after the one showing. Free.
  z.object({ action: z.literal("swipe"), to: z.enum(["prev", "next"]) }),
  // The character carries on without the person saying anything (continueReply): a reply, counted like one.
  z.object({ action: z.literal("continue") }),
  z.object({ action: z.literal("edit"), text: z.string().max(COMPANION_MESSAGE_MAX * 2) }),
  z.object({ action: z.literal("length"), length: z.enum(REPLY_LENGTHS) }),
  // A scene at one of the show's places (they open it), or back to texting (null).
  z.object({
    action: z.literal("scene"),
    place: z.enum(SCENE_PLACES as [VenueId, ...VenueId[]]).nullable(),
    // A roleplay to play there (lib/date-roleplays.ts bookingAsk): the show's id, or { title, premise, roles? }.
    roleplay: z.union([z.string().max(60), z.object({ title: z.string().max(200), premise: z.string().max(1000), roles: z.array(z.string().max(200)).length(2).optional() })]).nullish(),
    my_role: z.union([z.literal(0), z.literal(1)]).optional(),
    // How it opens, when they chose (lib/scene-opening.ts): 0, 1 or 2 for one of the three, or a sentence of their own.
    opening: z.union([z.literal(0), z.literal(1), z.literal(2), z.string().max(CARD_OPENING_MAX * 4)]).optional(),
  }),
  z.object({ action: z.literal("carry_on") }),
  // The thread's switch for texts the character starts (a date aired, the house talked about them); never on silence.
  z.object({ action: z.literal("texts"), on: z.boolean() }),
  z.object({ action: z.literal("report"), message_id: z.string().min(1).max(64), reason: z.enum(COMPANION_REPORT_REASONS) }),
  // A reply as a voice note (lib/companion-voice.ts); `buy`: the button showed the price, so a token may buy a bundle.
  z.object({ action: z.literal("voice"), message_id: z.string().min(1).max(64), buy: z.boolean().optional() }),
  // A voice call starting or ending (counted only: what's said goes through send with `call`).
  z.object({
    action: z.literal("call"),
    event: z.enum(["start", "end"]),
    seconds: z.number().int().min(0).max(24 * 3600).optional(),
    turns: z.number().int().min(0).max(10_000).optional(),
    voice: z.enum(["device", "own"]).optional(),
  }),
  // A chip under one of the character's texts about a date (lib/companion-offers.ts): see them again, someone new, advice.
  // Or `answer`, with `text`: the box under a question it asked about its own sheet (lib/character-questions.ts, ./answer.ts).
  z.object({ action: z.literal("offer"), offer: z.enum([...COMPANION_OFFER_KINDS, "answer"]), message_id: z.string().min(1).max(64), text: z.string().max(COMPANION_MESSAGE_MAX).optional() }),
]);

type Allowance = Awaited<ReturnType<typeof companionAllowance>>;
type Extras = Awaited<ReturnType<typeof extrasState>> | null;

const reply = (r: CompanionSend, sess: ReturnType<typeof session>, allowance: Allowance, extras: Extras) => {
  if (!r.ok) {
    const { ok: _ok, status, ...body } = r;
    return json({ ...body, allowance, extras }, status, sess);
  }
  return json({ view: r.view, allowance, extras }, 200, sess);
};

/** What the extras cost this person (P3: voice notes); none for a guest, who's asked to sign in first. */
const extrasFor = (db: Awaited<ReturnType<typeof getDb>>, sess: ReturnType<typeof session>): Promise<Extras> =>
  sess.authenticated ? extrasState(db, sess.userId) : Promise.resolve(null);

/** The thread: its messages, its settings, how much the character remembers. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const refused = await companionRefusal(db, req, sess);
  if (refused) return refused;
  return reply(await getThread(db, sess.userId, id), sess, await companionAllowance(db, sess.userId, new Date(), process.env, { guest: !sess.authenticated }), await extrasFor(db, sess));
});

/**
 * One move in a thread: say something (send), draw the last reply again (regenerate), flip to another of its draws
 * (swipe), have them carry on (continue), rewrite your last message (edit),
 * set how much the character says (length), play a scene somewhere or go back to texting (scene), carry on after the
 * crisis resources (carry_on), report a reply (report), or record one as a voice note (voice, an extra). A reply is taken from the free count or the plan's fair use
 * before it's drawn (lib/companion-plan.ts), and given back when none came (a scene's opener included).
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const refused = await companionRefusal(db, req, sess);
  if (refused) return refused;
  const input = parseBody(Action, await readJson(req), "invalid_request");
  if (input.action === "voice") {
    // An extra, never a reply: not counted against the free replies, and for accounts only.
    if (!sess.authenticated) return json({ error: "sign_in", message: "Voice notes come with a free account. Sign in to hear them." }, 401, sess);
    const v = await voiceNote(db, sess.userId, id, input.message_id, { buy: input.buy === true });
    const [view, allowance, extras] = await Promise.all([getThread(db, sess.userId, id), companionAllowance(db, sess.userId), extrasFor(db, sess)]);
    if (!v.ok) {
      const { ok: _ok, status, ...body } = v;
      return json({ ...body, allowance, extras, ...(view.ok ? { view: view.view } : {}) }, status, sess);
    }
    return json({ voice: { message_id: v.message_id, url: v.url, cached: v.cached }, ...(view.ok ? { view: view.view } : {}), allowance, extras }, 200, sess);
  }
  if (input.action === "call") {
    // Counted, never charged: a call's turns are replies like any other (send), each taken from the count as it's said.
    const t = await getThread(db, sess.userId, id);
    if (!t.ok) {
      const { ok: _ok, status, ...body } = t;
      return json(body, status, sess);
    }
    // `stage`, not `event`: that's the analytics event's own name.
    track("companion_call", { stage: input.event, seconds: input.seconds, turns: input.turns, voice: input.voice, guest: !sess.authenticated || undefined });
    // A call starting on the plan (or an admin's): their face for it (lib/face-kit.ts), drawn once if they have none.
    if (input.event === "start" && sess.authenticated && (await companionAllowance(db, sess.userId, new Date(), process.env)).unlimited) {
      inBackground(() => ensureFaceKit(db, t.view.character.id, requestBase(req)));
    }
    return json({ ok: true }, 200, sess);
  }
  if (input.action === "offer") {
    if (input.offer !== "answer") return takeOffer(req, db, sess, id, input.offer, input.message_id);
    return takeAnswer(req, db, sess, id, input.message_id, input.text, async (body, status) => {
      const [view, allowance, extras] = await Promise.all([getThread(db, sess.userId, id), companionAllowance(db, sess.userId, new Date(), process.env, { guest: !sess.authenticated }), extrasFor(db, sess)]);
      return json({ ...body, ...(view.ok ? { view: view.view } : {}), allowance, extras }, status, sess);
    });
  }
  const talks = input.action === "send" || input.action === "regenerate" || input.action === "edit" || input.action === "continue" || (input.action === "scene" && input.place !== null);
  if (talks && (await overLimit(db, "companion", sess.userId, COMPANION_LIMITS))) {
    return json({ error: "rate_limited", message: "That's a lot of talking for now. Take a breather and come back in a bit." }, 429, sess);
  }
  // A guest (no account, ../access.ts) has a handful of replies in all, and one address only so many (a cookie is free).
  const guest = !sess.authenticated;
  const visitor = talks && guest ? visitorKey(req.headers) : null;
  if (visitor && (await overLimit(db, "companion_guest", visitor, COMPANION_GUEST_IP_LIMITS))) {
    return json({ error: "rate_limited", message: "That's a lot of talking from here for now. A free account lifts the limit." }, 429, sess);
  }
  const ticket = talks ? await takeReply(db, sess.userId, new Date(), process.env, { guest }) : null;
  if (ticket && !ticket.ok) return json({ error: ticket.error, message: ticket.message, allowance: ticket.allowance }, ticket.status, sess);
  let r: CompanionSend;
  switch (input.action) {
    case "send":
      r = await sendMessage(db, sess.userId, id, input.text, new Date(), "companion", { call: input.call === true });
      break;
    case "regenerate":
      r = await regenerate(db, sess.userId, id);
      break;
    case "swipe":
      r = await swipeReply(db, sess.userId, id, input.to);
      break;
    case "continue":
      r = await continueReply(db, sess.userId, id);
      break;
    case "edit":
      r = await editLast(db, sess.userId, id, input.text);
      break;
    case "length":
      r = await setReplyLength(db, sess.userId, id, input.length);
      break;
    case "scene":
      {
        const ask = bookingAsk(input.roleplay, input.my_role);
        r = await setScene(db, sess.userId, id, input.place, new Date(), ask && !ask.skip ? ask : null, input.opening);
      }
      break;
    case "carry_on":
      r = await carryOn(db, sess.userId, id);
      break;
    case "texts":
      r = await setTexts(db, sess.userId, id, input.on);
      break;
    case "report":
      r = await reportMessage(db, sess.userId, id, input.message_id, input.reason);
      break;
  }
  if (ticket?.ok && (!r.ok || r.replied === false)) await giveBackReply(db, sess.userId, ticket);
  if (talks && r.ok) inBackground(() => companionFollowUp(db, id));
  return reply(r, sess, await companionAllowance(db, sess.userId, new Date(), process.env, { guest }), await extrasFor(db, sess));
});

/** The same request, aimed at another of our routes in-process: the person's cookies and address go with it. */
function forward(req: Request, path: string, body: unknown): Request {
  const headers = new Headers(req.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  return passOn(req, new Request(new URL(path, req.url), { method: "POST", headers, body: JSON.stringify(body) }));
}

/**
 * A chip under a character's text about a date (lib/companion-offers.ts; the 2026-11-14 core plan: the thread is the
 * control room for the character's love life). Owner-only: the thread's character must be the person's own (a guest on
 * a signed session owns their own character, as the Hear-from route allows). Each chip does its thing through the show's
 * own machinery, so a booking is charged, limited, consented and filmed exactly like any date:
 * - `second_date`: POST /api/episodes/:id/second-date as this character (FREE_WEEKLY_SECOND_DATE when on, else one of the
 *   person's free weekly or pack dates); 202 when the other creator's yes is still wanted.
 * - `overnight`: POST /api/overnight for the pair (lib/overnight.ts): the couple's overnight date, the second-date flow
 *   with an evening place; 202 when the other creator's yes to an overnight is still wanted.
 * - `someone_new`: a date with a season cast member the character hasn't dated, in the first-date format (the speed date).
 * - `advice`: nothing booked; the page turns the composer into the "For next time" note (the couples nudge route).
 * The character answers with a written line (postFromCharacter, kind `offer`, once per text), never a model call; the
 * 429 for no dates left becomes its own line too. Free: no reply is taken for any of it.
 */
async function takeOffer(req: Request, db: Awaited<ReturnType<typeof getDb>>, sess: ReturnType<typeof session>, threadId: string, offer: CompanionOfferKind, messageId: string): Promise<Response> {
  const loaded = await loadOffer(db, { userId: sess.userId, threadId, messageId, kind: offer });
  const settle = async (body: Record<string, unknown>, status: number) => {
    const [view, allowance, extras] = await Promise.all([getThread(db, sess.userId, threadId), companionAllowance(db, sess.userId, new Date(), process.env, { guest: !sess.authenticated }), extrasFor(db, sess)]);
    return json({ ...body, ...(view.ok ? { view: view.view } : {}), allowance, extras }, status, sess);
  };
  if (!loaded.ok) return settle({ error: loaded.error, message: loaded.message }, loaded.status);
  const { characterId, offers } = loaded;
  track("companion_offer", { offer, guest: !sess.authenticated || undefined });
  /** The character's line about what just happened, once per text and kind of outcome (`said`: it went in now). */
  const say = async (lines: string[], tag: string): Promise<boolean> =>
    (await postFromCharacter(db, { userId: sess.userId, characterId, lines, kind: "offer", dedupeKey: `${tag}:${messageId}` }).catch(() => null)) !== null;

  if (offer === "advice") {
    await markOfferTaken(db, messageId, { kind: "advice" });
    const said = await say(offerLines("advice", { partner: offers.partner }), "offer");
    return settle({ offer, said, partner_id: offers.partner_id, partner: offers.partner }, 200);
  }

  let res: Response;
  let newPartner: string | null = null;
  if (offer === "someone_new") {
    const pick = await pickSomeoneNew(db, characterId);
    if (!pick) {
      const said = await say(nobodyNewLines(), "offer_none");
      return settle({ error: "nobody_new", message: "They've been on a date with everyone on this season's cast.", said }, 409);
    }
    newPartner = pick.name;
    res = await createEpisode(forward(req, "/api/episodes", { character_id: characterId, partner_id: pick.id, format: firstDateFormat(process.env) }));
  } else if (offer === "overnight") {
    res = await bookOvernight(forward(req, "/api/overnight", { character_id: characterId, partner_id: offers.partner_id }));
  } else {
    res = await bookSecondDate(forward(req, `/api/episodes/${offers.episode_id}/second-date`, { character_id: characterId }), { params: Promise.resolve({ id: offers.episode_id }) });
  }
  const data = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  if (res.status === 200 && typeof data.id === "string") {
    await markOfferTaken(db, messageId, { kind: offer, episodeId: data.id });
    const said = await say(offerLines(offer, { partner: offers.partner, newPartner }), "offer");
    return settle({ offer, said, episode_id: data.id, href: `/episodes/${data.id}?play=1` }, 200);
  }
  if (res.status === 202) {
    // Their yes is in; the other character's creator completes it (the second-date route told them).
    await markOfferTaken(db, messageId, { kind: offer });
    const said = await say(offerLines(offer === "overnight" ? "overnight" : "second_date", { partner: offers.partner, waiting: true }), "offer");
    return settle({ offer, said, waiting: true, message: data.message }, 202);
  }
  if (res.status === 429) {
    // No dates left this week (or too many from one connection): the character says so; the chip stays for later.
    const said = await say(outOfDatesLines(), "offer_out");
    return settle({ error: data.error, message: data.message, said, ...(data.shop_path ? { shop_path: data.shop_path } : {}), ...(data.resets_at ? { resets_at: data.resets_at } : {}) }, 429);
  }
  if (data.error === "planned" || data.error === "already_planned") {
    // Booked already, from the episode's page or the other creator: the chips go, and the date is the answer.
    const planned = typeof data.episode_id === "string" ? data.episode_id : null;
    await markOfferTaken(db, messageId, { kind: offer, episodeId: planned });
    return settle({ error: data.error, message: data.message, said: false, ...(planned ? { episode_id: planned, href: `/episodes/${planned}?play=1` } : {}) }, 409);
  }
  return settle({ error: typeof data.error === "string" ? data.error : "offer_failed", message: typeof data.message === "string" ? data.message : "That didn't go through. Try again in a moment.", said: false }, res.status >= 400 ? res.status : 500);
}

/** Deletes the thread, with everything the character remembered of it. */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const refused = await companionRefusal(db, req, sess);
  if (refused) return refused;
  const r = await deleteThread(db, sess.userId, id);
  if (!r.ok) {
    const { ok: _ok, status, ...body } = r;
    return json(body, status, sess);
  }
  return json({ deleted: true }, 200, sess);
});
