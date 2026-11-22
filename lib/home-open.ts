/**
 * A stranger's first screen on home: the cast on the stage under the neon heart, tonight's people stepped forward and
 * lit, the promise, the sentence box and the day's clip (app/HomeOpen.tsx).
 *
 * It began as the design system's first screen B, "the season promo" (2026-11-18): tonight's story in a line and one
 * call to watch, above the hero, the tonight band and the shelves. On 2026-11-21 the screen and the hero became one
 * (the growth plan and the product audit: too many first steps, too much assumed context), so the page reads from here
 * only who is on the stage and whether the season strip steps aside; tonight's story stays the producer's and /watch's.
 *
 * Data only. HOME_OPEN=0 turns it off and the page is as it was: the hero leads, with the band and the vote under it.
 * Someone with a character never sees it: their home opens on their character's phone.
 */
import type { Db } from "@/lib/db";
import { LINK_WORDS, isLinkKind, linkBetween } from "@/lib/character-links";
import { portraitPathSql } from "@/lib/portrait-sql";
import { beatFor, dayOf } from "@/lib/producer";
import { REPORT_HIDE_THRESHOLD } from "@/lib/rules";
import { seasonArc, type SeasonFormatDef } from "@/lib/season-format";
import { isMonthlySeason, seasonNumber } from "@/lib/season-ref";
import { seasonIdOf } from "@/lib/season-window";

type Env = Record<string, string | undefined>;

/** HOME_OPEN=0: no first screen; a stranger's home opens on the hero again. */
export const homeOpenOn = (env: Env = process.env): boolean => env.HOME_OPEN?.trim() !== "0";

export type OpenFace = { id: string; name: string; hue: number | null; portrait: string | null };

/** Tonight's story, as the first screen says it. */
export type OpenTonight = {
  /** Tonight's people, two or three, stepped forward in the line. */
  who: OpenFace[];
  /** "Sable × Teo" on a story arc's night (the two the arc is between); null when the line names them itself. */
  names: string | null;
  /** The pair's history in a word, on an arc's night ("Exes"). */
  label: string | null;
  /** What follows "Tonight:": the arc's hook, or the producer's own line for the night. */
  text: string;
  /** Today's aired public date between tonight's people, when there is one: the call opens it. */
  episode: string | null;
};

/** The longest hook a first screen carries: about two lines on a phone under the title. */
export const OPEN_HOOK_MAX = 90;

/**
 * The end of a history (character_links.story), which is where its sting is: as many whole sentences from the end as
 * fit OPEN_HOOK_MAX, and always the last one. "They dated one summer. On their anniversary Sable … proposed in front
 * of everyone. He took the ring box home and never opened it. Neither has mentioned it since." → its last two.
 */
export function hookOf(story: string, max = OPEN_HOOK_MAX): string {
  const text = story.replace(/\s+/g, " ").trim();
  const sentences = (text.match(/[^.!?]+[.!?]+["'”’)]*/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
  let out = "";
  for (let i = sentences.length - 1; i >= 0; i--) {
    const next = out ? `${sentences[i]} ${out}` : sentences[i];
    if (out && next.length > max) break;
    out = next;
  }
  return out || text;
}

/** "exes" → "Exes", "a fake couple" → "Fake couple": the chip beside the names. */
export const linkLabel = (pair: string): string => {
  const bare = pair.replace(/^an? /i, "");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
};

const firstName = (name: string): string => name.split(" ")[0];

/**
 * Tonight on the show, from the producer's beat for today (lib/producer.ts): on a story arc's night, the two it is
 * between, the history in a word and its hook; on another beat, its people and its own "Tonight:" line. Null on a
 * night with no beat, or when fewer than two of its people are public.
 */
export async function openTonight(db: Db, now: Date = new Date(), env: Env = process.env): Promise<OpenTonight | null> {
  const beat = await beatFor(db, dayOf(now), env).catch(() => null);
  if (!beat || beat.who.length < 2) return null;
  const ids = beat.who.slice(0, 3);
  const { rows } = await db.query<OpenFace>(
    `select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait from characters c where c.id = any($1) and c.visibility = 'public'`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const who = ids.map((id) => byId.get(id)).filter((f): f is OpenFace => Boolean(f));
  if (who.length < 2) return null;
  // Today's date between them, aired and public, not reported away (the clip pipeline's own test, lib/producer.ts).
  const start = new Date(`${dayOf(now)}T00:00:00.000Z`);
  const { rows: eps } = await db.query<{ id: string }>(
    `select e.id from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
      where e.character_a = any($1) and e.character_b = any($1) and e.created_at >= $2
        and e.revealed_at is not null and e.revealed_at <= $3 and e.visibility = 'public' and ca.visibility = 'public' and cb.visibility = 'public'
        and (select count(*) from reports r where r.episode_id = e.id) < $4
      order by e.revealed_at desc limit 1`,
    [who.map((w) => w.id), start.toISOString(), now.toISOString(), REPORT_HIDE_THRESHOLD],
  );
  const episode = eps[0]?.id ?? null;
  if (beat.arc && isLinkKind(beat.arc.kind)) {
    const [a, b] = who;
    const story = (await linkBetween(db, a.id, b.id).catch(() => null))?.story?.trim();
    return {
      who: [a, b],
      names: `${firstName(a.name)} × ${firstName(b.name)}`,
      label: linkLabel(LINK_WORDS[beat.arc.kind].pair),
      text: story ? hookOf(story) : beat.tonight.replace(/^Tonight:\s*/, ""),
      episode,
    };
  }
  return { who, names: null, label: null, text: beat.tonight.replace(/^Tonight:\s*/, ""), episode };
}

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

export type OpenKicker = { head: string; long: string; short: string };

/**
 * The eyebrow over the title: where in the season tonight is, as the season strip under the header says it
 * (app/SeasonBanner.tsx), which the first screen stands in for. `long` and `short` are its last part on a wide screen
 * and on a phone ("12 days to the finale", "12 days left"), so the line stays one line. Null outside a monthly season.
 */
export function openKicker(now: Date, def: SeasonFormatDef | null): OpenKicker | null {
  const id = seasonIdOf(now);
  const number = seasonNumber(id);
  if (!isMonthlySeason(id) || number === null) return null;
  const { night, left, to } = seasonArc(now, def);
  const head = `Season ${number} · Night ${night}`;
  if (to === "end") return { head, long: left === 0 ? "The last night" : `${days(left)} left`, short: left === 0 ? "Last night" : `${days(left)} left` };
  if (left === 0) return { head, long: "The finale is tonight", short: "Finale tonight" };
  return { head, long: `${days(left)} to the finale`, short: `${days(left)} left` };
}

/** The season stays in view: this one's cast on the stage, tonight's people in the middle at nearly twice the size. */
export function openLine(cast: readonly OpenFace[], leads: readonly OpenFace[], max = 6): { face: OpenFace; lead: boolean }[] {
  const leadIds = new Set(leads.map((l) => l.id));
  // Three leads leave room for two faces beside them on a phone; two leave room for four.
  const back = cast.filter((c) => !leadIds.has(c.id)).slice(0, Math.max(0, Math.min(max - leads.length, leads.length > 2 ? 2 : 4)));
  const left = back.slice(0, Math.ceil(back.length / 2));
  const right = back.slice(left.length);
  return [...left.map((face) => ({ face, lead: false })), ...leads.map((face) => ({ face, lead: true })), ...right.map((face) => ({ face, lead: false }))];
}
