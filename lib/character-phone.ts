/**
 * The owner's home is their character's phone (2026-11-15). Someone with a character used to land on the same page as a
 * stranger, with the show first and their character a row in "Since you were here". The loop is "your character has a
 * love life, and you're in their corner" (docs/ideas.md), so the top of `/` is now that character's phone
 * (app/CharacterPhone.tsx): its last texts to them with an unread dot, the open question as chips that lead into the
 * thread (where they act; nothing is booked from the home page), what is next, and one action: "Open {first}'s texts",
 * or "Hear from {first}" when they never opted in to its texts.
 *
 * One read for every character the person has (the home page's depth budget, tests/perf-pages.test.ts: it runs next to
 * "Since you were here", so the page waits on no extra round trip). No model, no writes.
 * HOME_PHONE=0 turns the block off.
 */
import { isStoredQuestion, type StoredQuestion } from "./character-question-fields";
import type { StoredOffers } from "./companion-offers";
import { companionOpen, companionThreadHref, COMPANION_OFFER_KINDS, offerLabel } from "./companion-shared";
import { generationPaused } from "./compute";
import type { Db } from "./db";
import type { CharacterRef } from "./game";

export function homePhoneOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.HOME_PHONE?.trim() !== "0";
}

/** Texts of the character's the phone shows at the most. */
export const PHONE_TEXTS = 3;
/** "What's next" lines at the most. */
export const PHONE_NEXT = 3;
/** Other characters in the row under the phone. */
export const PHONE_OTHERS = 6;
/** The house's weekly date comes at most this often (= lib/character-life.ts LIFE_GAP_DAYS; a test keeps them equal). */
export const PHONE_WEEKLY_GAP_DAYS = 6;
/** How far back "this week" looks for Sunday's recap (= lib/character-life.ts WEEK_DAYS). */
export const PHONE_WEEK_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name;

export type PhoneText = { id: string; text: string; at: string; /** A photo from a date (lib/date-photo.ts): `text` is its alt text. */ photo: boolean };
export type PhoneChip = { label: string; href: string };
export type PhoneNext = {
  key: "on_date" | "ready" | "scheduled" | "weekly" | "recap" | "first_date";
  text: string;
  href: string | null;
  /** A moment to show by the viewer's clock (a scheduled date), or null. */
  at: string | null;
};
export type PhoneAction =
  /** They opted in: the thread. */
  | { kind: "open"; label: string; href: string }
  /** They never opted in and a date's ending stands: the character texts them about it (POST /api/companion/after-date). */
  | { kind: "hear"; label: string; episodeId: string }
  /** No ending to hear about yet: the date being filmed, or the first date. */
  | { kind: "link"; label: string; href: string };

export type CharacterPhoneView = {
  character: CharacterRef;
  first: string;
  /** The thread with this character, when there is one. */
  threadHref: string | null;
  /** They tapped "Hear from" once (companion_threads.muted_proactive = false). */
  optedIn: boolean;
  /** The character's last texts, oldest first. */
  texts: PhoneText[];
  /** A text from the character they haven't opened (an unread `character_texted_you`). */
  unread: boolean;
  /** What the screen says with no texts on it. */
  empty: string | null;
  /** The newest open question as chips: links into the thread, where the tap happens. */
  chips: PhoneChip[];
  next: PhoneNext[];
  action: PhoneAction;
  /** The thread, when the main action is something else. */
  secondary: { label: string; href: string } | null;
  others: { character: CharacterRef; href: string; unread: boolean }[];
};

type ThreadRow = {
  character_id: string;
  thread_id: string;
  muted_proactive: boolean;
  last_at: Date | string;
  answered_at: Date | string | null;
  unread: boolean;
  /** `offers`: a date's menu (lib/companion-offers.ts) or a question about the sheet (lib/character-question-fields.ts). */
  texts: { id: string; text: string; via: string; offers: StoredOffers | StoredQuestion | null; created_at: string }[] | null;
};

type DateRow = {
  character_id: string;
  visibility: string;
  open_to_dates: boolean;
  episode_id: string | null;
  status: string | null;
  ending_final: boolean | null;
  aired: boolean | null;
  partner: string | null;
  created_at: Date | string | null;
  last_life_at: Date | string | null;
  scheduled_at: Date | string | null;
  has_ready: boolean;
};

/**
 * One read for every character: its thread with its owner (the opt-in, the unread dot, its last few texts, newest
 * last), its newest date on the show (After Dark's stay on its own host), its next booking and its last house date.
 */
const phoneRows = (db: Db, userId: string, ids: readonly string[], now: Date) =>
  db.query<DateRow & Partial<ThreadRow>>(
    `select c.id as character_id, c.visibility, c.open_to_dates,
            d.episode_id, d.status, d.ending_final, d.aired, d.partner, d.created_at,
            (select max(l.created_at) from episodes l where l.character_a = c.id and l.setup->>'met_via' = 'life') as last_life_at,
            (select min(s.run_at) from scheduled_dates s where s.character_id = c.id and s.ran_at is null and s.run_at > $3::timestamptz) as scheduled_at,
            exists (select 1 from episodes r where c.id in (r.character_a, r.character_b) and r.status = 'ready') as has_ready,
            t.id as thread_id, t.muted_proactive, t.last_at,
            (select max(u.created_at) from companion_messages u where u.thread_id = t.id and u.role = 'user') as answered_at,
            exists (select 1 from notifications n where n.user_id = t.user_id and n.read_at is null and n.kind = 'character_texted_you' and n.link = '/companion/' || t.id) as unread,
            (select jsonb_agg(to_jsonb(x) order by x.created_at, x.id)
               from (select m.id, m.text, m.via, m.offers, m.created_at from companion_messages m
                      where m.thread_id = t.id and m.role = 'character' and m.replaced_by is null
                      order by m.created_at desc, m.id desc limit 8) x) as texts
       from characters c
       left join companion_threads t on t.character_id = c.id and t.user_id = $2
       left join lateral (
         select e.id as episode_id, e.status, (e.setup->>'ending_final')::boolean as ending_final, e.revealed_at is not null as aired,
                p.name as partner, e.created_at
           from episodes e
           join characters p on p.id = case when e.character_a = c.id then e.character_b else e.character_a end
          where c.id in (e.character_a, e.character_b) and e.status in ('generating', 'ready')
            and coalesce((e.setup->>'after_dark')::boolean, false) = false
          order by e.created_at desc, e.id limit 1) d on true
      where c.id = any($1::text[])`,
    [ids, userId, now.toISOString()],
  );

/** A date's ending won't move: ready, or still being finished with the early verdict in (= lib/after-date-text.ts endingStands, kept apart so the home page doesn't load the companion's model code). */
const endingStands = (e: { status: string; ending_final: boolean | null }): boolean => e.status === "ready" || (e.status === "generating" && e.ending_final === true);

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

/** Whether the house still takes characters out (lib/character-life.ts lifeDatesPerDay: LIFE_DATES_PER_DAY=0 is off). */
const weeklyDatesOn = (env: Record<string, string | undefined>): boolean => !generationPaused(env) && env.LIFE_DATES_PER_DAY?.trim() !== "0";

/**
 * The phone for the person's characters (one read): the lead is the character with an unread text,
 * else the one something happened to most recently (a text or a date), else the newest; the rest are the row under it.
 * Null when they have no character, companions aren't open to them, or the switch is off.
 */
export async function characterPhone(db: Db, userId: string, mine: readonly CharacterRef[], now = new Date(), env: Record<string, string | undefined> = process.env): Promise<CharacterPhoneView | null> {
  if (!mine.length || !homePhoneOn(env) || !companionOpen(env)) return null;
  const ids = mine.map((c) => c.id);
  const { rows } = await phoneRows(db, userId, ids, now);
  const dateOf = new Map<string, DateRow>(rows.map((r) => [r.character_id, r]));
  const threadOf = new Map<string, ThreadRow>(rows.filter((r) => r.thread_id).map((r) => [r.character_id, r as ThreadRow]));

  const activity = (id: string): string => {
    const t = threadOf.get(id);
    const texted = t?.texts?.length ? iso(t.texts[t.texts.length - 1].created_at) : null;
    return [texted, iso(dateOf.get(id)?.created_at)].filter(Boolean).sort().pop() ?? "";
  };
  const ranked = mine
    .map((character, i) => ({ character, i, unread: threadOf.get(character.id)?.unread === true, at: activity(character.id) }))
    .sort((x, y) => Number(y.unread) - Number(x.unread) || y.at.localeCompare(x.at) || x.i - y.i);
  const lead = ranked[0].character;
  const view = phoneOf(lead, threadOf.get(lead.id) ?? null, dateOf.get(lead.id) ?? null, now, env);
  return {
    ...view,
    others: ranked.slice(1, 1 + PHONE_OTHERS).map(({ character, unread }) => {
      const t = threadOf.get(character.id);
      return { character, href: t ? companionThreadHref(t.thread_id) : `/characters/${encodeURIComponent(character.id)}`, unread };
    }),
  };
}

/** One character's phone from its thread and its newest date (pure). */
export function phoneOf(character: CharacterRef, t: ThreadRow | null, d: DateRow | null, now: Date, env: Record<string, string | undefined> = process.env): Omit<CharacterPhoneView, "others"> {
  const first = firstNameOf(character.name);
  const threadHref = t ? companionThreadHref(t.thread_id) : null;
  const optedIn = t ? !t.muted_proactive : false;
  const all = t?.texts ?? [];
  const texts: PhoneText[] = all.slice(-PHONE_TEXTS).map((m) => ({ id: m.id, text: m.via === "photo" ? "A photo from the date" : m.text, at: iso(m.created_at)!, photo: m.via === "photo" }));
  const date = d?.episode_id ? d : null;
  const partner = date?.partner ? firstNameOf(date.partner) : null;
  const episode = date ? `/episodes/${encodeURIComponent(date.episode_id!)}` : null;
  const filming = date?.status === "generating";
  const stands = date ? endingStands({ status: date.status!, ending_final: date.ending_final }) : false;

  // The chips: the newest date menu still open (nobody tapped one, and no date newer than the one it is about), as
  // links into the thread; else one chip to answer: the newest question about its sheet while its box is open
  // (lib/character-question-fields.ts openQuestion), or a text that ends on a question nobody answered.
  const chips: PhoneChip[] = [];
  if (threadHref) {
    const menu = [...all].reverse().map((m) => m.offers).find((o): o is StoredOffers => Boolean(o && !isStoredQuestion(o) && o.episode_id && !o.taken));
    const asked = [...all].reverse().map((m) => m.offers).find(isStoredQuestion);
    const lastText = [...all].reverse().find((m) => m.via !== "photo");
    if (menu && (!date || date.episode_id === menu.episode_id)) {
      for (const k of menu.kinds) if ((COMPANION_OFFER_KINDS as readonly string[]).includes(k)) chips.push({ label: offerLabel(k, { partner: menu.partner, character: character.name }), href: threadHref });
    } else if ((asked && !asked.taken) || (lastText && /\?\s*$/.test(lastText.text) && (!t?.answered_at || new Date(t.answered_at) < new Date(lastText.created_at)))) {
      chips.push({ label: `Answer ${first}`, href: threadHref });
    }
  }

  const next: PhoneNext[] = [];
  if (date && filming && !stands) next.push({ key: "on_date", text: `On a date with ${partner} right now`, href: `${episode}?play=1`, at: null });
  else if (date && date.status === "ready" && !date.aired) next.push({ key: "ready", text: `The date with ${partner} is ready to watch`, href: episode, at: null });
  if (d?.scheduled_at) next.push({ key: "scheduled", text: "A date is booked for", href: `/characters/${encodeURIComponent(character.id)}`, at: iso(d.scheduled_at) });
  if (!date) next.push({ key: "first_date", text: "A first date is a speed date: about a minute, and free", href: `/create?character=${encodeURIComponent(character.id)}`, at: null });
  // The house's weekly date (lib/character-life.ts candidates): a character with a date behind it and a portrait, public
  // or at least open to dates. Said only when it can happen, and never with a day it may not keep.
  if (d?.has_ready && character.portrait && (d.visibility === "public" || d.open_to_dates) && weeklyDatesOn(env)) {
    const due = d.last_life_at ? new Date(new Date(d.last_life_at).getTime() + PHONE_WEEKLY_GAP_DAYS * DAY_MS) : null;
    const text =
      due && due > now
        ? `The house takes ${first} out again from ${due.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}`
        : `The house takes ${first} out on a date this week`;
    next.push({ key: "weekly", text, href: null, at: null });
  }
  // Sunday's recap (lib/character-life.ts sendCharacterWeeks) goes to characters something happened to this week.
  const weekAgo = now.getTime() - PHONE_WEEK_DAYS * DAY_MS;
  const busy = (date?.created_at && new Date(date.created_at).getTime() > weekAgo) || all.some((m) => new Date(m.created_at).getTime() > weekAgo);
  if (busy) next.push({ key: "recap", text: now.getUTCDay() === 0 ? `${first}'s week on the show comes today` : `Sunday: ${first}'s week on the show`, href: now.getUTCDay() === 0 ? "/notifications" : null, at: null });

  const action: PhoneAction =
    threadHref && optedIn
      ? { kind: "open", label: `Open ${first}'s texts`, href: threadHref }
      : date && stands
        ? { kind: "hear", label: `Hear from ${first}`, episodeId: date.episode_id! }
        : date
          ? { kind: "link", label: `Watch ${first}'s date`, href: `${episode}?play=1` }
          : { kind: "link", label: `Send ${first} on a first date`, href: `/create?character=${encodeURIComponent(character.id)}` };

  const empty = texts.length
    ? null
    : action.kind === "hear"
      ? `${first} hasn't texted you yet. Tap "Hear from ${first}" and they'll tell you how the date with ${partner} went.`
      : action.kind === "open"
        ? `Nothing new from ${first}.`
        : date
          ? `${first} is on a date with ${partner}. They can text you once it's over.`
          : `${first} hasn't been on a date yet. Send them on one and they'll text you how it went.`;

  return {
    character,
    first,
    threadHref,
    optedIn,
    texts,
    unread: t?.unread === true,
    empty,
    chips,
    next: next.slice(0, PHONE_NEXT),
    action,
    secondary: threadHref && action.kind !== "open" ? { label: `Open ${first}'s texts`, href: threadHref } : null,
  };
}
