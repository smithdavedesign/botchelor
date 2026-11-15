/**
 * What happens in the house reaches the chat (2026-11-16, "one continuous character"; docs/companions.md "When the
 * house talks about them", docs/character-depth.md "Story state"). A character texted its person after its own dates
 * (lib/after-date-text.ts); what the house said about it reached an owner as a notification and one fixed text. This is
 * the one place every house text is now written, for every kind of thing the house does in public:
 *
 *   talked     a house scene retold one of its dates (lib/house-scenes.ts)
 *   confronted it had it out with someone (lib/house-conflict.ts)
 *   won, lost  it was in the week's challenge
 *   tonight    the producer's public line for the day names it (lib/producer.ts)
 *
 * WHO HEARS. Every thread with that character whose person turned its texts on (companion_threads.muted_proactive =
 * false) and that isn't paused: its owner first of all, and anyone texting a cast member under the same opt-in. Never
 * someone who muted texts as a notification type, never our own test and house-crowd identities (lib/our-traffic.ts
 * loadOurIds, as the day-after text), never a thread that already heard about that scene (`house_scene:<scene id>`,
 * `house_tonight:<day>` in companion_messages.action), and at most one house text a thread a UTC day. A scene the cap
 * held back is not sent the day after: a late text only goes to a thread that had none since the scene's day began.
 * At most HOUSE_TEXTS_PER_PASS a pass. Every one goes through lib/companion.ts postFromCharacter, so the AI notice, the
 * paused rule, the PG check and the `character_texted_you` notice (Chat's unread count, Since you were here) hold.
 *
 * WHAT IT SAYS. Templates, no model call, in the first person, built ONLY from the scene as /house shows it to a
 * stranger (lib/house-scenes.ts HouseSceneView) and the producer's public lines: who spoke, where, whose date, how a
 * confrontation came out, who won what. Whether a retelling was true is not in that view, so no text can say. A few
 * variants a kind, dealt by the day and the character, so two days running never read the same. Each text links to the
 * scene (lib/companion-shared.ts textLink).
 *
 * THE CHARACTER THEN HOLDS IT. A character that texted about something knows it: one heard row through the story
 * state's own `hear` (source `house:<ref>`, nobody told it to its face: told_by null, read as "word reached you from
 * the house"). The claim is the fact that it was said or done, in public-record words, so it is always true as stored:
 * whether the retelling itself was right stays where it was (the scene's `told`, server-side). A character that
 * already holds the scene (it was in the room, or a confrontation moved its opinion) keeps that and gets no second
 * row. Nothing else is written: no opinion, no want, no "knows you said" fact, so a date reads nothing new beyond what
 * `hear` always fed it. A scene that stops naming the character in public takes the row with it (houseWordUpkeep).
 *
 * IT CAN TALK ABOUT IT. houseForPrompt gives the companion prompt a short block for that thread's character: the last
 * public things the house said about it (HOUSE_PROMPT_ITEMS, HOUSE_PROMPT_MAX characters). Public data only; an owner
 * who told the character to forget one (the Story tab) takes it out of the block too.
 *
 * HOUSE_TEXTS=0 turns it off without a deploy of code: nothing is sent, nothing is held, and no prompt carries a block.
 */
import { storedOffers } from "./companion-offers";
import { HOUSE_BLOCK_LINES, HOUSE_BLOCK_MAX, houseBlock } from "./companion-prompt";
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { houseScene, houseSceneHourUtc, houseScenesOn, listHouseScenes, type HouseSceneView, type Outcome } from "./house-scenes";
import { shortName } from "./names";
import { loadOurIds } from "./our-traffic";
import { producerOn } from "./producer";
import type { Ending } from "./rules";
import { inFlight, shared } from "./shared-cache";
import { hear, HOUSE_WORD_SOURCE, storyStateOn } from "./story-state";

type Env = Record<string, string | undefined>;

/* ------------------------------------------------ the switch ------------------------------------------------ */

/** HOUSE_TEXTS: on unless it is "0". Off: no text, no heard row, no prompt block. */
export const houseTextsOn = (env: Env = process.env): boolean => env.HOUSE_TEXTS?.trim() !== "0";

/** The most texts one pass sends, across every thread. */
export const HOUSE_TEXTS_PER_PASS = 40;
/** A scene is texted about on its own UTC day or the day after, and only while it is this fresh. */
export const HOUSE_TEXT_FRESH_HOURS = 36;
/** How many public things the prompt block carries, how far back, and how long it may be. */
export const HOUSE_PROMPT_ITEMS = HOUSE_BLOCK_LINES;
export const HOUSE_PROMPT_DAYS = 7;
export const HOUSE_PROMPT_LINE_MAX = 240;
export const HOUSE_PROMPT_MAX = HOUSE_BLOCK_MAX;
/** How far back the upkeep checks the rows the house's word left. */
const UPKEEP_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
const startOf = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, word: string): boolean => word.length > 1 && new RegExp(`(?<![\\p{L}])${escapeRe(word)}(?![\\p{L}])`, "iu").test(text);
const cut = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);

/* ------------------------------------------------ what happened ------------------------------------------------ */

export type HouseEventKind = "talked" | "confronted" | "won" | "lost" | "tonight";
type Who = { id: string; name: string };

/** One public thing the house did that names a character. Every field is something a stranger can read. */
export type HouseEvent = {
  kind: HouseEventKind;
  /** The scene's id, or `tonight-<day>` for the producer's line: the heard row's source is `house:<ref>`. */
  ref: string;
  day: string;
  /** The character it names (first name, as the house says it). */
  me: Who;
  /** talked: who brought it up. confronted: the other one. lost: who won. tonight: someone else the line names. */
  other: Who | null;
  /** talked: who the date was with. won: another contestant. tonight: a third person the line names. */
  also: Who | null;
  /** talked: the date that was retold. */
  episodeId: string | null;
  /** Where it happened, as it reads after a name ("on the big sofa"); null for the producer's line. */
  at: string | null;
  /** confronted: how it came out, as /house prints it. */
  outcome: Outcome | null;
  label: string | null;
  /** won, lost: the challenge and what winning gave. */
  title: string | null;
  prize: string | null;
  /** talked: the line that was said. tonight: the producer's two lines, without their leads. */
  said: string | null;
  tonight: string | null;
};

const blank = { other: null, also: null, episodeId: null, at: null, outcome: null, label: null, title: null, prize: null, said: null, tonight: null };

/** The tag a text about this carries (the dedupe, and the link under its last bubble). */
export const houseTextTag = (e: Pick<HouseEvent, "kind" | "ref" | "day">): string => (e.kind === "tonight" ? `house_tonight:${e.day}` : `house_scene:${e.ref}`);
/** Any house text's tag, as SQL and as a pattern. */
const HOUSE_TAG_SQL = `'^house_(scene|tonight):'`;
export const houseWordSource = (ref: string): string => `${HOUSE_WORD_SOURCE}${ref}`;

/**
 * Everyone a scene names, each with what it did to them (pure). Read from the scene exactly as /house shows it: a
 * reported or removed line, a private character, a retelling of a date that is no longer public are already gone, and
 * whether a retelling was true was never there. The people in the room of the daily scene only talk: they aren't named.
 */
export function sceneEvents(s: HouseSceneView): HouseEvent[] {
  const base = { ref: s.id, day: s.day, at: s.place.at };
  if (s.result?.kind === "confrontation") {
    const { a, b, a_id, b_id, outcome, label } = s.result;
    if (!a_id || !b_id) return [];
    return [
      { ...blank, ...base, kind: "confronted", me: { id: a_id, name: a }, other: { id: b_id, name: b }, outcome, label },
      { ...blank, ...base, kind: "confronted", me: { id: b_id, name: b }, other: { id: a_id, name: a }, outcome, label },
    ];
  }
  if (s.result?.kind === "challenge") {
    const { winner, title, prize } = s.result;
    const win: Who = { id: winner.id, name: winner.name };
    const others = s.cast.filter((c) => c.id !== winner.id).map((c): Who => ({ id: c.id, name: c.name }));
    return [
      { ...blank, ...base, kind: "won", me: win, other: others[0] ?? null, also: others[1] ?? null, title, prize },
      ...others.map((me): HouseEvent => ({ ...blank, ...base, kind: "lost", me, other: win, title, prize })),
    ];
  }
  const out: HouseEvent[] = [];
  const seen = new Set<string>();
  for (const l of s.lines) {
    for (const id of l.about ?? []) {
      if (id === l.id || seen.has(id)) continue;
      const d = s.about.find((x) => (x.a_id === l.about![0] && x.b_id === l.about![1]) || (x.a_id === l.about![1] && x.b_id === l.about![0]));
      if (!d) continue;
      seen.add(id);
      const mine = d.a_id === id;
      out.push({
        ...blank,
        ...base,
        kind: "talked",
        me: { id, name: shortName(mine ? d.a : d.b) },
        other: { id: l.id, name: l.name },
        also: { id: (mine ? d.b_id : d.a_id)!, name: shortName(mine ? d.b : d.a) },
        episodeId: d.episode_id,
        said: l.text,
      });
    }
  }
  return out;
}

/** A producer's public lines for a day (story_beats): only the columns a viewer was shown, and the public people it names. */
export type PublicBeat = { day: string; who: string[]; about: string | null; previously: string; tonight: string; names: Record<string, string> };

const unlead = (s: string): string => s.replace(/^(?:Previously|Tonight):\s*/i, "").trim();

/**
 * Who the day's line names (pure): each of the beat's people whose name is in the words a viewer read, and only while
 * every one of them is still public (a line naming someone who went private isn't told to anyone).
 */
export function beatEvents(b: PublicBeat): HouseEvent[] {
  const named = [...new Set([...b.who, ...(b.about ? [b.about] : [])])];
  if (named.length < 2 || named.some((id) => !b.names[id])) return [];
  const previously = unlead(b.previously);
  const tonight = unlead(b.tonight);
  if (!previously) return [];
  return named
    .filter((id) => mentions(`${previously} ${tonight}`, b.names[id]))
    .map((id): HouseEvent => {
      const others = named.filter((x) => x !== id).map((x): Who => ({ id: x, name: b.names[x] }));
      return { ...blank, kind: "tonight", ref: `tonight-${b.day}`, day: b.day, me: { id, name: b.names[id] }, other: others[0] ?? null, also: others[1] ?? null, said: previously, tonight: tonight || null };
    });
}

/* ------------------------------------------------ the words ------------------------------------------------ */

/** How a confrontation came out, in the character's mouth: the public result, three ways. */
const CAME_OUT: Record<Outcome, readonly [string, string, string]> = {
  cleared_the_air: ["We cleared the air.", "It's said, and it's settled.", "We're fine now. Better than fine, maybe."],
  agreed_to_disagree: ["We agreed to disagree.", "Neither of us gave an inch, but it has been said.", "We left it there: not friends about it, not enemies either."],
  worse_than_before: ["It ended worse than it started.", "It did not go well.", "We're on worse terms than we were before."],
};

/** How many ways each kind of text can read. */
export const HOUSE_TEXT_VARIANTS: Record<HouseEventKind, number> = { talked: 4, confronted: 3, won: 3, lost: 3, tonight: 3 };

/**
 * Which way today's text reads (pure): the day's number plus a deal from the character and the kind, so the same
 * character's next text of that kind, a day or more later, never reads the same as the one before.
 */
export function variantOf(e: Pick<HouseEvent, "kind" | "day" | "me">): number {
  const n = HOUSE_TEXT_VARIANTS[e.kind];
  return (Math.floor(startOf(e.day).getTime() / DAY_MS) + (seedFrom("house-text", e.kind, e.me.id) % n)) % n;
}

/**
 * The character's own text about it (pure, templates): two or three bubbles in the first person, ending on something
 * for the person to answer. Never whether what was said is true, never a guilt trip, never a word about being away.
 */
export function houseTextLines(e: HouseEvent, variant: number = variantOf(e)): string[] {
  const v = ((variant % HOUSE_TEXT_VARIANTS[e.kind]) + HOUSE_TEXT_VARIANTS[e.kind]) % HOUSE_TEXT_VARIANTS[e.kind];
  const o = e.other?.name ?? "Someone";
  const at = e.at ?? "in the house";
  switch (e.kind) {
    case "talked": {
      const date = e.also ? `my date with ${e.also.name}` : "me";
      return [
        [`Word got back to me: ${o}'s been talking about ${date} ${at}.`, `Want to know what ${o} said?`],
        [`So I'm house gossip now. ${o} brought up ${date} ${at}.`, "Go and hear it, then tell me what you make of it."],
        [`Apparently ${o} had plenty to say about ${date} ${at}.`, "I wasn't in the room. How did it sound to you?"],
        [`${o} has thoughts on ${date}, and shared them ${at}.`, "Have a listen. Should I say something, or let it go?"],
      ][v];
    }
    case "confronted": {
      const came = CAME_OUT[e.outcome ?? "agreed_to_disagree"][v];
      return [
        [`I had it out with ${o} ${at}.`, came, "Go and hear it. Was I fair?"],
        [`Well. ${o} and I finally said it all out loud, ${at}.`, came, "Have a listen and tell me how I came across."],
        [`You'll hear about it anyway: ${o} and I had words ${at}.`, came, "It's all on the house page. What would you have said?"],
      ][v];
    }
    case "won": {
      const title = lowerFirst(e.title ?? "the challenge");
      const prize = e.prize ?? "the next one-on-one";
      return [
        [`I won ${title}.`, `The prize: ${prize}.`, "Come and see how I did it."],
        [`Guess who won ${title}. Me.`, `That gets me ${prize}.`, "It's on the house page. Any advice before then?"],
        [`${upperFirst(title)} went my way.`, `I get ${prize} for it.`, "Go and watch, then tell me I earned it."],
      ][v];
    }
    case "lost": {
      const title = lowerFirst(e.title ?? "the challenge");
      return [
        [`${o} won ${title}. I did not.`, "I gave it a proper go, though.", "Have a look and tell me where it got away from me."],
        [`So, ${title}. ${o} took it.`, "I'm being a good sport about it. Mostly.", "Go and watch, then tell me I was close."],
        [`We had ${title} in the house, and ${o} came out on top.`, "I'd like it noted that I tried.", "It's on the house page. What should I have done?"],
      ][v];
    }
    case "tonight": {
      const line = `"${(e.said ?? "").replace(/"/g, "'")}"`;
      return [
        [`I'm in the show's story for today: ${line}`, "Will you be watching tonight?"],
        [`The show put my name in today's line. ${line}`, "No pressure, then. What do you think I should do?"],
        [`So this is what the show is saying about me today: ${line}`, "Come and see how tonight goes."],
      ][v];
    }
  }
}

/**
 * The same thing as the public record would put it (pure): what the character holds afterwards. It says that
 * something was said or done, never whether what was said is right, so it is true whatever the retelling was.
 */
export function houseClaim(e: HouseEvent): string {
  const at = e.at ?? "in the house";
  switch (e.kind) {
    case "talked":
      return e.also ? `${e.other?.name ?? "Someone"} talked about ${e.me.name} and ${e.also.name}'s date ${at}.` : `${e.other?.name ?? "Someone"} talked about ${e.me.name} ${at}.`;
    case "confronted":
      return `${e.me.name} and ${e.other?.name ?? "someone"} had it out ${at}: ${lowerFirst(e.label ?? "they agreed to disagree")}.`;
    case "won":
      return `${e.me.name} won ${lowerFirst(e.title ?? "the challenge")} ${at}${e.other ? `, ahead of ${e.other.name}${e.also ? ` and ${e.also.name}` : ""}` : ""}.`;
    case "lost":
      return `${e.other?.name ?? "Someone"} won ${lowerFirst(e.title ?? "the challenge")} ${at}; ${e.me.name} competed.`;
    case "tonight":
      return e.said ?? "";
  }
}

/** The same thing as one line of the companion's prompt, said to the character (pure). */
export function housePromptLine(e: HouseEvent): string {
  const on = startOf(e.day).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const at = e.at ?? "in the house";
  const line =
    e.kind === "talked"
      ? `${e.other?.name ?? "Someone"} brought up ${e.also ? `your date with ${e.also.name}` : "you"} ${at}${e.said ? `, and said: "${e.said}"` : "."}`
      : e.kind === "confronted"
        ? `you had it out with ${e.other?.name ?? "someone"} ${at}. ${e.label ?? "You agreed to disagree"}.`
        : e.kind === "won"
          ? `you won ${lowerFirst(e.title ?? "the challenge")}. The prize: ${e.prize ?? "the next one-on-one"}.`
          : e.kind === "lost"
            ? `${e.other?.name ?? "Someone"} won ${lowerFirst(e.title ?? "the challenge")}; you competed and didn't win.`
            : `the show's line for the day was: "${[e.said, e.tonight].filter(Boolean).join(" Tonight: ")}"`;
  return cut(`${on}: ${line}`, HOUSE_PROMPT_LINE_MAX);
}

/* ------------------------------------------------ reading the house ------------------------------------------------ */

type BeatRow = { day: string; who: string[] | null; about: string | null; previously: string | null; tonight: string | null };

/** The producer's public lines from `fromDay` to `toDay` (a day's line is public from its day on), newest first. */
async function publicBeats(db: Db, fromDay: string, toDay: string, env: Env): Promise<PublicBeat[]> {
  if (!producerOn(env)) return [];
  const { rows } = await db.query<BeatRow>(
    `select day, who, about, previously, tonight from story_beats
      where day >= $1 and day <= $2 and status in ('staged', 'played', 'missed') and tension is not null and previously is not null
      order by day desc limit 40`,
    [fromDay, toDay],
  );
  const ids = [...new Set(rows.flatMap((r) => [...(Array.isArray(r.who) ? r.who : []), ...(r.about ? [r.about] : [])]))];
  if (!ids.length) return [];
  const pub = new Map((await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1) and visibility = 'public'`, [ids])).rows.map((c) => [c.id, shortName(c.name)]));
  return rows.map((r) => {
    const who = Array.isArray(r.who) ? r.who : [];
    const names: Record<string, string> = {};
    for (const id of [...who, ...(r.about ? [r.about] : [])]) if (pub.has(id)) names[id] = pub.get(id)!;
    return { day: r.day, who, about: r.about, previously: r.previously ?? "", tonight: r.tonight ?? "", names };
  });
}

/** Everything public the house did lately, as events, newest and weightiest first. */
async function recentEvents(db: Db, now: Date, env: Env, days: number, scenes: number): Promise<HouseEvent[]> {
  const today = dayOf(now);
  const fromDay = dayOf(new Date(now.getTime() - days * DAY_MS));
  const [listed, beats] = await Promise.all([
    houseScenesOn(env) ? listHouseScenes(db, { limit: scenes }).then((r) => r.scenes) : Promise.resolve([] as HouseSceneView[]),
    publicBeats(db, fromDay, today, env).catch(() => [] as PublicBeat[]),
  ]);
  return ordered([...listed.filter((s) => s.day >= fromDay && s.day <= today).flatMap(sceneEvents), ...beats.flatMap(beatEvents)]);
}

/** What a thread hears about first when two things happened: something it did, then something said, then the line. */
const WEIGHT: Record<HouseEventKind, number> = { confronted: 0, won: 1, lost: 2, talked: 3, tonight: 4 };
const ordered = (events: HouseEvent[]): HouseEvent[] => [...events].sort((x, y) => y.day.localeCompare(x.day) || WEIGHT[x.kind] - WEIGHT[y.kind] || x.ref.localeCompare(y.ref) || x.me.id.localeCompare(y.me.id));

/* ------------------------------------------------ the character holds it ------------------------------------------------ */

/**
 * The character now knows what it texted about: one heard row (lib/story-state.ts hear), unless it already holds the
 * scene itself (it was in the room, or the confrontation moved its opinion of the other). Returns whether a row was
 * written. The claim is about whoever else it names, since a character holds nothing about itself alone.
 */
export async function holdHouseWord(db: Db, e: HouseEvent, at: Date): Promise<boolean> {
  if (!storyStateOn()) return false;
  const about = e.other?.id ?? e.also?.id ?? null;
  if (!about) return false;
  if (e.kind !== "tonight") {
    const had = await db.query(
      `select 1 from character_heard where holder_id = $1 and position($2 in source) = 1
       union all select 1 from character_opinions where holder_id = $1 and source = $3 limit 1`,
      [e.me.id, `scene:${e.ref}#`, `scene:${e.ref}`],
    );
    if (had.rows.length) return false;
  }
  const aboutB = e.other && e.also && e.also.id !== e.me.id ? e.also.id : null;
  const made = await hear(db, { holder: e.me.id, about, aboutB, claim: houseClaim(e), toldBy: null, source: houseWordSource(e.ref), isTrue: true, at }).catch(() => null);
  return made?.created === true;
}

/**
 * The upkeep (the daily job): a row the house's word left goes when the scene no longer names its holder in public (a
 * line reported away, a date made private, someone who went private, a beat the owner withdrew). Only rows whose day
 * the public list still covers are judged. Returns how many went.
 */
export async function houseWordUpkeep(db: Db, now: Date = new Date(), env: Env = process.env): Promise<number> {
  const since = new Date(now.getTime() - UPKEEP_DAYS * DAY_MS);
  const { rows } = await db.query<{ id: string; holder_id: string; source: string }>(`select id, holder_id, source from character_heard where position($1 in source) = 1 and heard_at >= $2`, [HOUSE_WORD_SOURCE, since.toISOString()]);
  if (!rows.length) return 0;
  const today = dayOf(now);
  const [listed, beats] = await Promise.all([houseScenesOn(env) ? listHouseScenes(db, { limit: 30 }).then((r) => r.scenes) : Promise.resolve([] as HouseSceneView[]), publicBeats(db, dayOf(since), today, env)]);
  // The list holds the newest scenes: its oldest day may be cut short, so only days after it are known in full.
  const covered = listed.length < 30 ? dayOf(since) : listed[listed.length - 1].day;
  const still = new Set([...listed.flatMap(sceneEvents), ...beats.flatMap(beatEvents)].map((e) => `${e.me.id}|${houseWordSource(e.ref)}`));
  const gone = rows.filter((r) => {
    const day = /\d{4}-\d{2}-\d{2}/.exec(r.source)?.[0];
    if (!day) return false;
    // A switch that is off shows nothing for now: what the character holds waits for it, it isn't judged gone.
    const judged = r.source.startsWith(houseWordSource("tonight-")) ? producerOn(env) : houseScenesOn(env) && day > covered;
    return judged && !still.has(`${r.holder_id}|${r.source}`);
  });
  if (!gone.length) return 0;
  return (await db.query(`delete from character_heard where id = any($1) returning id`, [gone.map((r) => r.id)])).rows.length;
}

/* ------------------------------------------------ sending ------------------------------------------------ */

export type HouseTextsSent = { sent: number; held: number; by_kind: Partial<Record<HouseEventKind, number>> };
const nothing = (): HouseTextsSent => ({ sent: 0, held: 0, by_kind: {} });

type ThreadRow = { thread_id: string; user_id: string; character_id: string; owner_id: string | null };

/**
 * Sends each event to the threads that may hear it, and has the character hold what it texted about. Idempotent: a
 * thread that carries the tag is never written to again, and a character that already holds the row keeps it.
 */
async function send(db: Db, events: readonly HouseEvent[], now: Date, limit: number, alsoTo: readonly string[] = []): Promise<HouseTextsSent> {
  const done = nothing();
  if (!events.length) return done;
  const threads = (
    await db.query<ThreadRow>(
      `select t.id as thread_id, t.user_id, t.character_id, c.owner_id
         from companion_threads t join characters c on c.id = t.character_id
        where t.character_id = any($1) and t.muted_proactive = false and t.paused_at is null and c.visibility = 'public'
          and not exists (select 1 from notification_mutes nm where nm.user_id = t.user_id and nm.type = 'texts')
        order by (t.user_id = c.owner_id) desc, t.last_at desc, t.id`,
      [[...new Set(events.map((e) => e.me.id))]],
    )
  ).rows;
  if (!threads.length) return done;
  const ours = new Set(await loadOurIds(db).catch(() => [] as string[]));
  // `alsoTo`: an admin asked to see it on their own account (POST /api/admin/house-scene?kind=texts&me=1).
  const mine = threads.filter((t) => !ours.has(t.user_id) || alsoTo.includes(t.user_id));
  if (!mine.length) return done;
  // What these threads already heard from the house: this very thing (the tag), or anything since the oldest day here.
  const oldest = events.reduce((d, e) => (e.day < d ? e.day : d), events[0].day);
  const had = (
    await db.query<{ thread_id: string; action: string; created_at: string | Date }>(
      `select thread_id, action, created_at from companion_messages
        where thread_id = any($1) and role = 'character' and action ~ ${HOUSE_TAG_SQL} and (created_at >= $2 or action = any($3))`,
      [mine.map((t) => t.thread_id), startOf(oldest).toISOString(), [...new Set(events.map(houseTextTag))]],
    )
  ).rows.map((r) => ({ thread: r.thread_id, tag: r.action, at: new Date(r.created_at).getTime() }));
  const { postFromCharacter } = await import("./companion");
  for (const e of events) {
    const tag = houseTextTag(e);
    const from = startOf(e.day).getTime();
    let told = false;
    for (const t of mine) {
      if (t.character_id !== e.me.id) continue;
      if (had.some((h) => h.thread === t.thread_id && h.tag === tag)) {
        told = true;
        continue;
      }
      // One house text a thread a day, and a scene the cap held back is not sent late.
      if (done.sent >= limit || had.some((h) => h.thread === t.thread_id && h.at >= from)) continue;
      const posted = await postFromCharacter(db, {
        userId: t.user_id,
        characterId: e.me.id,
        lines: houseTextLines(e),
        now,
        kind: `house_${e.kind}`,
        dedupeKey: tag,
        // Only its owner can send it on another date, so only its owner gets the date's chips.
        offers: e.kind === "talked" && t.owner_id === t.user_id ? await dateOffers(db, e) : null,
      }).catch(() => null);
      if (!posted) continue;
      had.push({ thread: t.thread_id, tag, at: now.getTime() });
      done.sent++;
      done.by_kind[e.kind] = (done.by_kind[e.kind] ?? 0) + 1;
      told = true;
    }
    if (told && (await holdHouseWord(db, e, now).catch(() => false))) done.held++;
  }
  return done;
}

/** The chips under an owner's text about a retold date (lib/companion-offers.ts): what the day-after text offers. */
async function dateOffers(db: Db, e: HouseEvent) {
  if (!e.episodeId || !e.also) return null;
  const ep = (
    await db.query<{ ending: Ending; booked: boolean; partner: string }>(
      `select e.ending, p.name as partner,
              exists (select 1 from episodes n where ((n.character_a = e.character_a and n.character_b = e.character_b) or (n.character_a = e.character_b and n.character_b = e.character_a))
                        and n.id <> e.id and n.created_at > e.created_at) as booked
         from episodes e join characters p on p.id = $2 where e.id = $1`,
      [e.episodeId, e.also.id],
    )
  ).rows[0];
  return ep ? storedOffers({ episodeId: e.episodeId, partnerId: e.also.id, partner: ep.partner, ending: ep.ending, booked: ep.booked }) : null;
}

const freshEnough = (s: HouseSceneView, now: Date): boolean =>
  s.day >= dayOf(new Date(now.getTime() - DAY_MS)) && s.day <= dayOf(now) && now.getTime() - new Date(s.written_at).getTime() <= HOUSE_TEXT_FRESH_HOURS * HOUR_MS;

/**
 * Right after a scene is stored (lib/house-scenes.ts, lib/house-conflict.ts): everyone it names texts the threads that
 * turned their texts on. Never throws: a failure here must not fail the pass that wrote the scene.
 */
export async function houseTextsForScene(db: Db, sceneId: string, now: Date = new Date(), opts: { env?: Env; limit?: number } = {}): Promise<HouseTextsSent> {
  try {
    if (!houseTextsOn(opts.env)) return nothing();
    const scene = await houseScene(db, sceneId);
    if (!scene || !freshEnough(scene, now)) return nothing();
    return await send(db, ordered(sceneEvents(scene)), now, opts.limit ?? HOUSE_TEXTS_PER_PASS);
  } catch (err) {
    console.error("[house-texts] could not text about a scene:", err instanceof Error ? err.message : "unknown");
    return nothing();
  }
}

/** From this hour (UTC) on, the day's line may be texted: after the scenes had their turn, so they come first. */
export const tonightTextHourUtc = (env: Env = process.env): number => Math.min(23, houseSceneHourUtc(env) + 1);

/**
 * The catch-up (the hourly lobby pass and the daily job): every fresh scene of today and yesterday whose text didn't
 * go out when it was stored (a pass that died, a thread that opted in since), and today's line from the producer once
 * the scenes have had their turn. Idempotent through the tags. Never throws.
 */
export async function houseTextsSweep(
  db: Db,
  now: Date = new Date(),
  opts: { env?: Env; limit?: number; /** An admin asked for it now: the day's line doesn't wait for its hour. */ anyHour?: boolean; /** Our own identities that may be texted this once (an admin looking at the feature). */ alsoTo?: readonly string[] } = {},
): Promise<HouseTextsSent> {
  const env = opts.env ?? process.env;
  try {
    if (!houseTextsOn(env)) return nothing();
    const today = dayOf(now);
    const [listed, beats] = await Promise.all([
      houseScenesOn(env) ? listHouseScenes(db, { limit: 12 }).then((r) => r.scenes) : Promise.resolve([] as HouseSceneView[]),
      opts.anyHour || now.getUTCHours() >= tonightTextHourUtc(env) ? publicBeats(db, today, today, env).catch(() => [] as PublicBeat[]) : Promise.resolve([] as PublicBeat[]),
    ]);
    const events = ordered([...listed.filter((s) => freshEnough(s, now)).flatMap(sceneEvents), ...beats.flatMap(beatEvents)]);
    return await send(db, events, now, opts.limit ?? HOUSE_TEXTS_PER_PASS, opts.alsoTo);
  } catch (err) {
    console.error("[house-texts] sweep failed:", err instanceof Error ? err.message : "unknown");
    return nothing();
  }
}

/* ------------------------------------------------ the prompt block ------------------------------------------------ */

/**
 * The house block of a companion's prompt (lib/companion-prompt.ts): the last public things the house said about or
 * did with THIS thread's character, newest first, inside HOUSE_PROMPT_ITEMS and HOUSE_PROMPT_MAX. Public data only, so
 * it is the same whoever the thread is with; the one difference is an owner's: something they told their character to
 * forget (the Story tab) is left out. The house's part is read once for everyone asking (lib/shared-cache.ts). Empty
 * when nothing was said, and with HOUSE_TEXTS=0. Never throws.
 */
export async function houseForPrompt(db: Db, character: { id: string }, yours: boolean, now: Date = new Date(), env: Env = process.env): Promise<string[]> {
  try {
    if (!houseTextsOn(env)) return [];
    const all = await inFlight(db, "house-texts:recent", () => shared("house-texts:recent", () => recentEvents(db, now, env, HOUSE_PROMPT_DAYS, 21)));
    let mine = all.filter((e) => e.me.id === character.id);
    if (!mine.length) return [];
    if (yours) {
      const forgot = new Set((await db.query<{ source: string }>(`select source from character_heard where holder_id = $1 and forgotten_at is not null and position($2 in source) = 1`, [character.id, HOUSE_WORD_SOURCE])).rows.map((r) => r.source));
      mine = mine.filter((e) => !forgot.has(houseWordSource(e.ref)));
    }
    return houseBlock(mine.map(housePromptLine));
  } catch {
    return [];
  }
}
