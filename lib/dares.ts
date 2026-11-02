/**
 * Dares (docs/ideas.md "Bringing viewers back", idea 2; David 2026-11-01): the nightly ballot's second lane. Beside
 * tonight's situation (lib/situations.ts), viewers back one of three producer dares for the same house date. The winning
 * dare is slipped to ONE side only, as that actor's private note (lib/simulation.ts: a side's note never reaches the
 * other side's prompts), framed so the actor knows it's a dare and may go through with it — or chicken out.
 *
 *  - The dared side is dealt from the day, like the pair and the choices, so every page and the job agree ($0 stored).
 *  - One vote a viewer a day, changeable until the vote closes at UTC midnight (the situation's clock).
 *  - Whether they went through with it is the engine's own note_followed for that side (episodes.sides, decided before a
 *    word is written): attempted or chickened out, $0, no extra model call. The episode page reveals it once the date airs.
 *  - A day with dare votes but no situation votes still makes the night's date (the dare is the premise enough); a day
 *    with neither makes none, so an idle day costs nothing.
 *  - The dares are a fixed, PG, producer-voiced pool (tests hold them to the show's content checks).
 */
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { situationPair, utcDay } from "./situations";

/** How many dares each day's ballot offers. */
export const DARE_CHOICES = 3;

export type DareDef = { id: string; text: string };

/** The producers' dare pool: PG, playable on any date, addressed to the dared side. */
export const DARES: readonly DareDef[] = [
  { id: "order-for-both", text: "Order for both of you without asking what they want." },
  { id: "pet-name", text: "Call them by a pet name all night, starting now." },
  { id: "googled-them", text: "Admit you googled them before the date." },
  { id: "toast-to-us", text: "Insist on a toast to 'us' before the first drink." },
  { id: "regular-here", text: "Claim you're a regular here, even when the staff clearly don't know you." },
  { id: "date-five-question", text: "Ask the question you'd normally save for date five." },
  { id: "worst-date-story", text: "Tell them your worst date story. All of it." },
  { id: "impression", text: "Do your best impression of them, to their face, and own it." },
  { id: "the-system", text: "Say 'trust me, I have a system' and commit to the bit all night." },
  { id: "wrong-drink", text: "Get their drink order wrong on purpose, then defend your choice." },
  { id: "only-questions", text: "Speak only in questions for one whole stretch of the conversation." },
  { id: "three-compliments", text: "Compliment them exactly three times tonight. No more, no fewer." },
  { id: "ridiculous-fear", text: "Confess a ridiculous fear and keep a straight face." },
  { id: "guard-dessert", text: "Propose sharing dessert, then guard it like it's yours." },
  { id: "when-were-old", text: "Drop the phrase 'when we're old' into the conversation, casually." },
  { id: "house-specialty", text: "Pretend you know the house specialty. Recommend it with total confidence." },
  { id: "rate-the-date", text: "Ask them to rate the date so far, out of ten, to their face." },
  { id: "mother-knows", text: "Tell them your mother already knows about them." },
  { id: "new-tradition", text: "Invent a tradition on the spot and insist the two of you start it tonight." },
  { id: "full-name", text: "Use their full name every single time you address them." },
  { id: "lose-on-purpose", text: "Challenge them to anything, and lose on purpose, graciously." },
  { id: "diary-entry", text: "Say 'this is going in my diary' after something completely ordinary." },
  { id: "dramatic-whisper", text: "Ask for the bill in a dramatic whisper." },
  { id: "no-second-dates", text: "Tell them, with a straight face, that you never do second dates. Then see where the night goes." },
  { id: "table-poem", text: "Recite a two-line poem about them. Compose it at the table." },
  { id: "for-the-lighting", text: "Swap seats mid-date 'for the lighting'." },
  { id: "nature-documentary", text: "Narrate one moment of the date like a nature documentary." },
  { id: "niche-hobby", text: "Claim a wildly niche hobby and answer every follow-up question." },
  { id: "pet-name-vote", text: "Ask what they'd name a pet the two of you would obviously never get." },
  { id: "formal-handshake", text: "Announce that the night ends with a formal handshake, whatever else happens." },
] as const;

export const dareById = (id: string): DareDef | undefined => DARES.find((d) => d.id === id);

/** The three dares a day's ballot offers, in their dealt order (a tie goes to the earlier one). */
export function dareChoices(day: string): DareDef[] {
  const pool = [...DARES];
  const out: DareDef[] = [];
  for (let i = 0; i < DARE_CHOICES && pool.length; i++) out.push(pool.splice(seedFrom("dare", day, i) % pool.length, 1)[0]);
  return out;
}

/** Which of the day's pair the producers slip the dare to: dealt from the day, like everything else. */
export function daredOf(day: string, pair: readonly [string, string]): string {
  return pair[seedFrom("dare-side", day) % 2];
}

/** The dare as the dared actor's private note: it knows it's a dare, and may chicken out. */
export const producerDareNote = (text: string): string =>
  `A dare from the show's producers — the audience voted for it, and your date doesn't know: ${text} You know it's a dare. Work it in naturally tonight, in your own voice, or chicken out; your call. Never say it was a dare.`;

export type DareVoteResult = { ok: true; pick: string } | { ok: false; status: number; error: string; message: string };

/** One viewer's vote on tonight's dare (a second vote changes it). Only today's three count. */
export async function voteDare(db: Db, userId: string, pick: string, now: Date = new Date()): Promise<DareVoteResult> {
  const day = utcDay(now);
  if (!dareChoices(day).some((d) => d.id === pick)) {
    return { ok: false, status: 400, error: "not_on_the_ballot", message: "That isn't one of tonight's three dares." };
  }
  await db.query(
    `insert into dare_votes (day, user_id, pick) values ($1, $2, $3)
     on conflict (day, user_id) do update set pick = excluded.pick, updated_at = now()`,
    [day, userId, pick],
  );
  return { ok: true, pick };
}

export async function dareCounts(db: Db, day: string): Promise<Map<string, number>> {
  const { rows } = await db.query<{ pick: string; n: number }>(`select pick, count(*)::int as n from dare_votes where day = $1 group by pick`, [day]);
  return new Map(rows.map((r) => [r.pick, r.n]));
}

/** A day's winning dare: most votes, ties to the earlier choice; null when nobody voted. */
export function dareWinnerOf(choices: readonly DareDef[], tally: Map<string, number>): DareDef | null {
  let best: DareDef | null = null;
  for (const d of choices) if ((tally.get(d.id) ?? 0) > 0 && (!best || (tally.get(d.id) ?? 0) > (tally.get(best.id) ?? 0))) best = d;
  return best;
}

/** How the dared side's engine run answered its note (episodes.sides note_followed): did they go through with it? */
export async function dareFollowed(db: Db, episodeId: string, characterId: string): Promise<boolean | null> {
  const row = (
    await db.query<{ sides: { note_followed: boolean | null }[] | null; is_a: boolean }>(
      `select sides, character_a = $2 as is_a from episodes where id = $1`,
      [episodeId, characterId],
    )
  ).rows[0];
  if (!row?.sides?.length) return null;
  return row.sides[row.is_a ? 0 : 1]?.note_followed ?? null;
}

export type DareReveal = { character_id: string; name: string; text: string; followed: boolean | null };

/** The episode page's reveal, once the date has aired: who was dared, to do what, and whether they went through with it. */
export async function dareReveal(db: Db, episodeId: string): Promise<DareReveal | null> {
  const row = (
    await db.query<{ character_id: string; dare_id: string; name: string }>(
      `select n.character_id, n.dare_id, c.name from dare_nights n join characters c on c.id = n.character_id
        where n.episode_id = $1`,
      [episodeId],
    )
  ).rows[0];
  const def = row ? dareById(row.dare_id) : undefined;
  if (!row || !def) return null;
  return { character_id: row.character_id, name: row.name, text: def.text, followed: await dareFollowed(db, episodeId, row.character_id) };
}

export type DareChoice = { id: string; text: string; votes: number };

/** Everything the dare lane's card shows: tonight's dare vote, and how the last one went. */
export type DareBoard = {
  day: string;
  closes_at: string;
  /** Who the producers will slip the winning dare to (their date won't know). */
  target: { id: string; name: string; hue: number | null };
  choices: DareChoice[];
  my_pick: string | null;
  total: number;
  /** The last dare that made a date: who was dared to do what, whether they went through with it (null until it airs). */
  last: { day: string; name: string; text: string; episode_path: string | null; followed: boolean | null; aired: boolean; my_pick: string | null; won: boolean } | null;
};

/** The dare card's data for one viewer. Null when the season has no cast to deal from. */
export async function dareBoard(db: Db, viewerId: string | null, now: Date = new Date()): Promise<DareBoard | null> {
  const day = utcDay(now);
  const pair = situationPair(day);
  if (!pair) return null;
  const dared = daredOf(day, pair);
  const [chars, tally, mine, lastRow] = await Promise.all([
    db.query<{ id: string; name: string; hue: number | null }>(`select id, name, avatar_hue as hue from characters where id = $1`, [dared]),
    dareCounts(db, day),
    viewerId
      ? db.query<{ pick: string }>(`select pick from dare_votes where day = $1 and user_id = $2`, [day, viewerId])
      : Promise.resolve({ rows: [] as { pick: string }[] }),
    db.query<{ day: string; character_id: string; dare_id: string; episode_id: string | null; name: string; revealed: boolean }>(
      `select n.day, n.character_id, n.dare_id, n.episode_id, c.name, (e.revealed_at is not null) as revealed
         from dare_nights n
         join characters c on c.id = n.character_id
         left join episodes e on e.id = n.episode_id
        where n.party_id is not null and n.day < $1
        order by n.day desc limit 1`,
      [day],
    ),
  ]);
  const target = chars.rows[0];
  if (!target) return null;
  let last: DareBoard["last"] = null;
  const lr = lastRow.rows[0];
  const lastDef = lr ? dareById(lr.dare_id) : undefined;
  if (lr && lastDef) {
    const myLast = viewerId
      ? ((await db.query<{ pick: string }>(`select pick from dare_votes where day = $1 and user_id = $2`, [lr.day, viewerId])).rows[0]?.pick ?? null)
      : null;
    last = {
      day: lr.day,
      name: lr.name,
      text: lastDef.text,
      episode_path: lr.episode_id ? `/episodes/${lr.episode_id}` : null,
      followed: lr.episode_id && lr.revealed ? await dareFollowed(db, lr.episode_id, lr.character_id) : null,
      aired: lr.revealed,
      my_pick: myLast,
      won: myLast === lr.dare_id,
    };
  }
  return {
    day,
    closes_at: new Date(Date.parse(`${day}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString(),
    target: { id: target.id, name: target.name, hue: target.hue },
    choices: dareChoices(day).map((d) => ({ id: d.id, text: d.text, votes: tally.get(d.id) ?? 0 })),
    my_pick: mine.rows[0]?.pick ?? null,
    total: [...tally.values()].reduce((s, n) => s + n, 0),
    last,
  };
}
