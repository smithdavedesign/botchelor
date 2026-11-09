import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";
import { inBackground } from "@/lib/sets";
import { track } from "@/lib/analytics";
import {
  carryOn,
  COMPANION_GUEST_IP_LIMITS,
  COMPANION_LIMITS,
  COMPANION_MESSAGE_MAX,
  COMPANION_REPORT_REASONS,
  companionFollowUp,
  deleteThread,
  editLast,
  getThread,
  regenerate,
  reportMessage,
  REPLY_LENGTHS,
  SCENE_PLACES,
  sendMessage,
  setReplyLength,
  setScene,
  type CompanionSend,
} from "@/lib/companion";
import type { VenueId } from "@/lib/venues";
import { companionAllowance, giveBackReply, takeReply } from "@/lib/companion-plan";
import { extrasState } from "@/lib/companion-extras";
import { voiceNote } from "@/lib/companion-voice";
import { companionRefusal } from "../access";
import { bookingAsk } from "@/lib/date-roleplays";

type Ctx = { params: Promise<{ id: string }> };

const Action = z.discriminatedUnion("action", [
  // `call`: said on a voice call in the app (the browser heard it); the reply is short, to be spoken aloud.
  z.object({ action: z.literal("send"), text: z.string().max(COMPANION_MESSAGE_MAX * 2), call: z.boolean().optional() }),
  z.object({ action: z.literal("regenerate") }),
  z.object({ action: z.literal("edit"), text: z.string().max(COMPANION_MESSAGE_MAX * 2) }),
  z.object({ action: z.literal("length"), length: z.enum(REPLY_LENGTHS) }),
  // A scene at one of the show's places (they open it), or back to texting (null).
  z.object({
    action: z.literal("scene"),
    place: z.enum(SCENE_PLACES as [VenueId, ...VenueId[]]).nullable(),
    // A roleplay to play there (lib/date-roleplays.ts bookingAsk): the show's id, or { title, premise, roles? }.
    roleplay: z.union([z.string().max(60), z.object({ title: z.string().max(200), premise: z.string().max(1000), roles: z.array(z.string().max(200)).length(2).optional() })]).nullish(),
    my_role: z.union([z.literal(0), z.literal(1)]).optional(),
  }),
  z.object({ action: z.literal("carry_on") }),
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
 * One move in a thread: say something (send), draw the last reply again (regenerate), rewrite your last message (edit),
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
    return json({ ok: true }, 200, sess);
  }
  const talks = input.action === "send" || input.action === "regenerate" || input.action === "edit" || (input.action === "scene" && input.place !== null);
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
    case "edit":
      r = await editLast(db, sess.userId, id, input.text);
      break;
    case "length":
      r = await setReplyLength(db, sess.userId, id, input.length);
      break;
    case "scene":
      {
        const ask = bookingAsk(input.roleplay, input.my_role);
        r = await setScene(db, sess.userId, id, input.place, new Date(), ask && !ask.skip ? ask : null);
      }
      break;
    case "carry_on":
      r = await carryOn(db, sess.userId, id);
      break;
    case "report":
      r = await reportMessage(db, sess.userId, id, input.message_id, input.reason);
      break;
  }
  if (ticket?.ok && (!r.ok || r.replied === false)) await giveBackReply(db, sess.userId, ticket);
  if (talks && r.ok) inBackground(() => companionFollowUp(db, id));
  return reply(r, sess, await companionAllowance(db, sess.userId, new Date(), process.env, { guest }), await extrasFor(db, sess));
});

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
