/**
 * Small gifts between characters, written after a date airs (2026-11-16; the rules and the catalogue are
 * lib/gift-catalog.ts, the story is docs/relationship-graph.md "Gifts").
 *
 * `giftAfterAir` is the only writer, called by the job that airs a date (lib/air.ts). There is no route and no tool:
 * no person or agent can send a gift, ask for one or pay for one. It reads only the public record (the aired date, the
 * pair's public standing, both public sheets, a line from the aired transcript) and writes one row (`character_gifts`):
 * which of the two gave what, the note, how the other took it and what they said back, all from templates. No model
 * call. Nothing here is read by the engine, and nothing it writes moves points, odds, pairings, an ending or a stage.
 *
 * Only for a date that aired PUBLICLY between two PUBLIC characters, at most one a pair a week (GIFT_EVERY_DAYS), one
 * a date. The gift follows its date wherever it is shown (lib/text-chain.ts): a date that is reported away or made
 * private takes its gift with it.
 *
 * What it feeds, each small and each through that layer's own rules:
 *  - the couple's thread: a `gift` item (lib/text-chain.ts);
 *  - the receiver's story state: a gift that touched them lifts their trust in the giver by one, through
 *    lib/story-state.ts setOpinion on the opinion that date already gave them (so it goes when the date does, and the
 *    next aired date rebuilds the opinion from scratch as always);
 *  - the house: `giftsFor` gives lib/house-scenes.ts the public sentence ("Sable sent Juniper a postcard of a
 *    giraffe.") beside the aired date it followed;
 *  - the owners: each one whose own character's texts are on hears it from that character, once (`gift:<id>`), never
 *    our own accounts (a job's text, like the day-after one).
 *
 * CHARACTER_GIFTS=0 turns all of it off without a deploy of code.
 */
import { postFromCharacter } from "./companion";
import { publicDateSql } from "./date-number";
import type { Db } from "./db";
import { characterGiftsOn, GIFT_EVERY_DAYS, GIFT_NAME_MAX, GIFT_NOTE_MAX, giftClaim, giftGiver, giftHappens, giftOccasion, giftReaction, giftReply, giftsOnAir, pickGift, type GiftFacts } from "./gift-catalog";
import { loadCharacterMemory } from "./memory";
import { shortName } from "./names";
import { loadOurIds } from "./our-traffic";
import { loadRelationship, pairKey, type End } from "./relationships";
import type { Ending } from "./rules";
import { checkShowText } from "./safety";
import { toneOf } from "./sheet-tone";
import { stateFor, setOpinion, SCALE_MAX } from "./story-state";
import type { GiftReaction } from "./text-chain-shared";

export { characterGiftsOn } from "./gift-catalog";

export type CharacterGift = {
  id: string;
  episode_id: string;
  giver_id: string;
  receiver_id: string;
  item: string;
  name: string;
  note: string;
  reaction: GiftReaction;
  reply: string;
  at: string;
};

type Sheet = { id: string; name: string; traits: string[]; voice: string | null; bio: string; extras: { hobbies?: unknown; occupation?: unknown } | null };

type AiredRow = {
  id: string;
  ending: Ending;
  venue: string | null;
  drama_question: string | null;
  drama_answer: string | null;
  walked: string | null;
  a: Sheet;
  b: Sheet;
};

/** The side the public record says was wronged: walked out on, or turned down. Null when it says neither. */
export function injuredSide(e: { drama_question: string | null; drama_answer: string | null; walked: string | null }): "a" | "b" | null {
  if (e.walked === "a" || e.walked === "b") return e.walked === "a" ? "b" : "a";
  return e.drama_question === "rejected" && (e.drama_answer === "a" || e.drama_answer === "b") ? e.drama_answer : null;
}

const sheetText = (c: Sheet): string => {
  const hobbies = Array.isArray(c.extras?.hobbies) ? (c.extras!.hobbies as unknown[]).filter((h): h is string => typeof h === "string") : [];
  const job = typeof c.extras?.occupation === "string" ? c.extras.occupation : "";
  return [...(Array.isArray(c.traits) ? c.traits : []), c.bio, ...hobbies, job].join(" ");
};

const SHEET = (c: string) => `jsonb_build_object('id', ${c}.id, 'name', ${c}.name, 'traits', ${c}.traits, 'voice', ${c}.voice, 'bio', ${c}.bio, 'extras', ${c}.extras)`;

/** What lib/air.ts calls once a date has aired and the pair's edge is refreshed: never throws, never waited on. */
export function giftOnAir(db: Db, episodeId: string): void {
  if (!giftsOnAir()) return;
  void giftAfterAir(db, episodeId).catch((err) => console.error("[character-gifts] failed:", err instanceof Error ? err.message : "unknown"));
}

/**
 * Decides whether the date that just aired brings a gift, and writes it. Null when it doesn't: the switch is off, the
 * date isn't a public aired date between two public characters, the rules say no (lib/gift-catalog.ts), the pair had
 * one this week, this date already has one, or a line didn't pass the PG check. Safe to call twice.
 */
export async function giftAfterAir(db: Db, episodeId: string, opts: { now?: Date; env?: Record<string, string | undefined> } = {}): Promise<CharacterGift | null> {
  const env = opts.env ?? process.env;
  if (!characterGiftsOn(env)) return null;
  const now = opts.now ?? new Date();
  const ep = (
    await db.query<AiredRow>(
      `select e.id, e.ending, e.setup->>'venue' as venue, e.drama_question, e.drama_answer,
              (select t->>'side' from jsonb_array_elements(coalesce(e.transcript, '[]'::jsonb)) t where t->>'walked_out' = 'true' limit 1) as walked,
              ${SHEET("ca")} as a, ${SHEET("cb")} as b
         from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
        where e.id = $1 and ${publicDateSql("e")} and e.ending is not null
          and coalesce((e.setup->>'after_dark')::boolean, false) = false
          and ca.visibility = 'public' and cb.visibility = 'public' and ca.id <> cb.id`,
      [episodeId],
    )
  ).rows[0];
  if (!ep) return null;
  const [lo, hi] = pairKey(ep.a.id, ep.b.id);
  const [rel, recent] = await Promise.all([
    loadRelationship(db, lo, hi),
    db.query(`select 1 from character_gifts where episode_id = $1 or (character_lo = $2 and character_hi = $3 and created_at > $4::timestamptz - make_interval(days => $5)) limit 1`, [
      episodeId, lo, hi, now.toISOString(), GIFT_EVERY_DAYS,
    ]),
  ]);
  if (recent.rows.length) return null;
  // How they stand on the public record after this date, as the show says it (lib/relationships.ts: the shown stage,
  // read and never written here; a gift is flavour, not one of the rules that read the base stage).
  const facts: GiftFacts = { episode_id: ep.id, ending: ep.ending, stage: rel?.public.shown ?? rel?.public.stage ?? null, dates: Math.max(1, rel?.public.dates ?? 1), injured: injuredSide(ep) };
  if (!giftHappens(facts, env)) return null;

  const side = giftGiver(facts);
  const giver = side === "a" ? ep.a : ep.b;
  const receiver = side === "a" ? ep.b : ep.a;
  const occasion = giftOccasion(facts);
  // A line of the receiver's from the aired date that stuck with the giver (lib/memory.ts: the aired transcript).
  const line = (await loadCharacterMemory(db, giver.id).catch(() => null))?.people?.find((p) => p.id === receiver.id && p.last_episode_id === ep.id)?.they_said ?? null;
  const known = { venue: ep.venue, sheet: sheetText(receiver), line };
  const reaction = giftReaction({ episode_id: ep.id, occasion, stage: facts.stage, dates: facts.dates }, toneOf(receiver));
  const reply = giftReply(ep.id, reaction, toneOf(receiver));
  // The first pick whose words pass the show's PG checks (a quoted line is the only part that isn't ours).
  let picked = pickGift(ep.id, occasion, known, toneOf(giver));
  if (picked && !checkShowText({ name: picked.name, note: picked.note }).ok) picked = pickGift(ep.id, occasion, { ...known, line: null }, toneOf(giver), [picked.id]);
  if (!picked || picked.name.length > GIFT_NAME_MAX || picked.note.length > GIFT_NOTE_MAX || !checkShowText({ name: picked.name, note: picked.note, reply }).ok) return null;

  const id = crypto.randomUUID();
  const giverEnd: End = giver.id === lo ? "lo" : "hi";
  const made = await db.query<{ created_at: string | Date }>(
    `insert into character_gifts (id, episode_id, character_lo, character_hi, giver, item, name, note, reaction, reply, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (episode_id) do nothing returning created_at`,
    [id, ep.id, lo, hi, giverEnd, picked.id, picked.name, picked.note, reaction, reply, now.toISOString()],
  );
  if (!made.rows.length) return null;
  const gift: CharacterGift = { id, episode_id: ep.id, giver_id: giver.id, receiver_id: receiver.id, item: picked.id, name: picked.name, note: picked.note, reaction, reply, at: now.toISOString() };
  await nudgeOpinion(db, gift).catch(() => false);
  await tellOwners(db, gift, { giver: giver.name, receiver: receiver.name }, now).catch(() => 0);
  return gift;
}

/**
 * The story state's small nudge: a gift that touched its receiver lifts their trust in the giver by one (never past the
 * scale's top). Only on the firsthand opinion this very date gave them, written back through setOpinion with the same
 * source and time: its own rules decide whether the row moves (a forgotten opinion stays forgotten), taking the date
 * off the air takes it away, and the pair's next aired date rebuilds the opinion without it. Returns whether it moved.
 */
export async function nudgeOpinion(db: Db, gift: Pick<CharacterGift, "episode_id" | "giver_id" | "receiver_id" | "reaction">): Promise<boolean> {
  if (gift.reaction !== "touched") return false;
  const held = (await stateFor(db, gift.receiver_id, { withId: gift.giver_id }))?.opinions[0];
  if (!held || held.basis !== "firsthand" || held.source !== gift.episode_id || held.trust >= SCALE_MAX) return false;
  return setOpinion(db, {
    holder: gift.receiver_id,
    about: gift.giver_id,
    trust: held.trust + 1,
    attraction: held.attraction,
    take: held.take,
    basis: "firsthand",
    source: gift.episode_id,
    at: held.source_at ? new Date(held.source_at) : undefined,
  });
}

const HOW_IT_LANDED: Record<GiftReaction, string> = { touched: "I think it landed.", amused: "It got a laugh, at least.", unimpressed: "It did not land. Noted." };
const HOW_I_TOOK_IT: Record<GiftReaction, string> = { touched: "I didn't expect to like it this much.", amused: "It made me laugh.", unimpressed: "I'm not sure what to make of it." };

/** What a character tells its own person about the gift (pure): as the giver, or as the one who got it. */
export function giftTextLines(role: "giver" | "receiver", g: Pick<CharacterGift, "name" | "note" | "reaction" | "reply">, other: string): string[] {
  const them = shortName(other);
  return role === "giver"
    ? [`I left ${them} ${g.name}.`, `They said: "${g.reply}"`, HOW_IT_LANDED[g.reaction]]
    : [`${them} left me ${g.name}.`, `The note said: "${g.note}"`, HOW_I_TOOK_IT[g.reaction]];
}

/**
 * Each owner whose own character was in it, and who turned that character's texts on, hears about the gift from that
 * character (postFromCharacter, tagged `gift:<id>`: once). Never a house character's thread, never our own accounts
 * (lib/our-traffic.ts loadOurIds: a job's text, like the day-after one). Returns how many texts went out.
 */
async function tellOwners(db: Db, gift: CharacterGift, names: { giver: string; receiver: string }, now: Date): Promise<number> {
  const { rows } = await db.query<{ user_id: string; character_id: string }>(
    `select t.user_id, t.character_id
       from companion_threads t join characters c on c.id = t.character_id and c.owner_id = t.user_id and not c.is_house
      where t.character_id = any($1) and t.muted_proactive = false and t.paused_at is null`,
    [[gift.giver_id, gift.receiver_id]],
  );
  if (!rows.length) return 0;
  const ours = new Set(await loadOurIds(db).catch(() => [] as string[]));
  let sent = 0;
  for (const r of rows) {
    if (ours.has(r.user_id)) continue;
    const role = r.character_id === gift.giver_id ? "giver" : "receiver";
    const lines = giftTextLines(role, gift, role === "giver" ? names.receiver : names.giver);
    const posted = await postFromCharacter(db, { userId: r.user_id, characterId: r.character_id, lines, now, kind: "gift", dedupeKey: `gift:${gift.id}` }).catch(() => null);
    if (posted) sent++;
  }
  return sent;
}

/**
 * The gifts that followed these aired dates, as the house may retell them: episode id -> the public sentence
 * (lib/gift-catalog.ts giftClaim). Empty with the switch off. The caller's dates are already the public record
 * (lib/house-scenes.ts airedSince), and a gift is only ever written for one.
 */
export async function giftsFor(db: Db, episodeIds: readonly string[], env: Record<string, string | undefined> = process.env): Promise<Map<string, string>> {
  if (!episodeIds.length || !characterGiftsOn(env)) return new Map();
  const { rows } = await db.query<{ episode_id: string; giver: string; receiver: string; name: string }>(
    `select g.episode_id, g.name,
            case when g.giver = 'lo' then lo.name else hi.name end as giver,
            case when g.giver = 'lo' then hi.name else lo.name end as receiver
       from character_gifts g join characters lo on lo.id = g.character_lo join characters hi on hi.id = g.character_hi
      where g.episode_id = any($1)`,
    [[...episodeIds]],
  );
  return new Map(rows.map((r) => [r.episode_id, giftClaim(shortName(r.giver), shortName(r.receiver), r.name)]));
}
