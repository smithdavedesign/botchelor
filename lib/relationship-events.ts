/**
 * The moments in a relationship worth telling people about (lib/notifications.ts). Kept apart from the graph
 * itself (lib/relationships.ts), which stays a pure, derived record.
 */
import { shortName } from "./names";
import type { Db } from "./db";
import { settleCommitment, warnWhenSparksOut } from "./partners";
import { resolveArcs } from "./arcs";
import { pairCharacterFollowers } from "./character-follows";
import { followerIds } from "./follows";
import { notifyAll, ownersOf } from "./notifications";
import { overnightAired } from "./overnight";
import { justSplit, STAGE_NEWS, steppedUp as movedUp } from "./relationship-stages";
import { pairKey, refreshRelationship, STAGE_LABELS, storedStages, viewRelationship } from "./relationships";
import { endingLabel } from "./rules";
import { midSentence } from "./sentence-case";
import { socialHook } from "./social/hook";

/**
 * Refreshes a pair's edge after one of their dates airs, then tells people about it:
 *  - a move up a stage ("Mira & Rafe: 💞 Dating"; how far along each stage is: lib/relationship-stages.ts STAGE_RANK) to
 *    the characters' owners and the couple's followers, and the one piece of bad news, a couple who were going steady
 *    or more splitting ("💔 Broke up"); a date that didn't click, exes and bad blood are never announced;
 *  - otherwise, a new public date to its followers ("Mira & Rafe went on another date");
 *  - the same two notices to whoever follows either character (lib/character-follows.ts), once a person, when both
 *    characters are public: the pair's first public date reads "went on a date";
 * records an overnight date's milestone (lib/overnight.ts), and settles the arc predictions the new public record
 * decides (lib/arcs.ts). Only on airing, so making a date
 * private and public again can't re-announce anything. Returns who was told of a step up (#1032: they need no "aired" notice too).
 */
export async function refreshAndAnnounce(db: Db, x: string, y: string, opts: { episodeId?: string; quiet?: readonly string[] } = {}): Promise<Set<string>> {
  const [lo, hi] = pairKey(x, y);
  // The stage as it is shown (the base stage with RELATIONSHIP_STAGES_V2=0). A row the backfill hasn't reached reads as
  // its own dates say, so the new rules alone never announce anything: only what this date changed.
  const before = (await storedStages(db, lo, hi)).public_shown;
  const rel = await refreshRelationship(db, lo, hi);
  const after = rel?.public.shown ?? null;
  const names = new Map(
    (await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [[lo, hi]])).rows.map((r) => [r.id, shortName(r.name)]),
  );
  const couple = `${names.get(lo)} & ${names.get(hi)}`;
  const [owners, coupleFollowers, fans] = await Promise.all([ownersOf(db, [lo, hi]), followerIds(db, lo, hi), pairCharacterFollowers(db, lo, hi).catch(() => [] as string[])]);
  // The couple's followers and either character's: each person hears once (notifyAll sends to each id once).
  const followers = [...new Set([...coupleFollowers, ...fans])];
  const steppedUp = movedUp(before, after) || justSplit(before, after);
  const told = new Set<string>();
  if (steppedUp) {
    const body = STAGE_NEWS[after!] ?? "They've become a fixture.";
    const notice = { kind: "stage_up" as const, title: `${couple}: ${STAGE_LABELS[after!]}`, body, link: `/couples/${lo}/${hi}` };
    // #1033: the step up is the public record's (aired, public dates), but an owner's get_relationships counts every date
    // they can see (unaired, unlisted, their private ones), so it could say Friends beside a Sparks notice. An owner
    // whose view names another stage hears both: the title says it's the public stage, the body names theirs.
    const ownerIds = [...new Set([owners.get(lo), owners.get(hi)].filter((x): x is string => Boolean(x)))];
    // `quiet`: owners who hear nothing of this date (a mixer's house fillers, lib/group-dates.ts mixerQuietUsers).
    for (const owner of ownerIds.filter((o) => !opts.quiet?.includes(o))) {
      const theirs = rel ? (viewRelationship(rel, { userId: owner, owner: true })?.stage ?? null) : null;
      await notifyAll(
        db,
        [owner],
        theirs && theirs !== after
          ? {
              ...notice,
              title: `${couple}: ${STAGE_LABELS[after!]} (public record)`,
              body: `${body} That's their stage on aired, public dates (public_stage in get_relationships). Counting every date you can see, they're ${STAGE_LABELS[theirs]} (its stage).`,
            }
          : notice,
      );
      told.add(owner);
    }
    // Followers see the public record only, as get_relationships shows it to them.
    await notifyAll(db, followers.filter((f) => !told.has(f)), notice);
    for (const f of followers) told.add(f);
  } else if (opts.episodeId && followers.length) {
    // A followed couple's new date, when it's in the public record (aired, public, not hidden).
    const aired = rel?.history.find((h) => h.episode_id === opts.episodeId && h.public);
    if (aired) {
      // A character's follower can be here for the pair's first public date; a couple's follower never is.
      const firstDate = (rel?.history.filter((h) => h.public).length ?? 0) <= 1;
      await notifyAll(db, followers, {
        kind: "couple_date",
        title: firstDate ? `${couple} went on a date` : `${couple} went on another date`,
        // Its own date number (a follow-up's), so a happy third date reads "a fourth date", as on its page; in a sentence's
        // case, as home's clip says it (2026-11-22 audit: "It ended: A fifth date" read as two headings).
        body: `How it ended: ${midSentence(endingLabel(aired.ending, aired.date_number))}.`,
        link: `/episodes/${opts.episodeId}`,
      });
    }
  }
  // An overnight date that just aired and ended in leaving together (lib/overnight.ts): the pair's milestone, once, and
  // each opted-in owner hears from their own character. Any other date, and any other ending, does nothing here.
  if (opts.episodeId) await overnightAired(db, opts.episodeId).catch(() => null);
  // The locked picture's text (lib/locked-picture-texts.ts): after a couple leaves an overnight date together, or now and
  // then after a steady couple's date ends in another. Texts only; imported when needed, as most airings send none.
  if (opts.episodeId) {
    const episodeId = opts.episodeId;
    await import("./locked-picture-texts").then(({ lockedPictureAired }) => lockedPictureAired(db, episodeId, { quiet: opts.quiet })).catch(() => null);
  }
  await resolveArcs(db, lo, hi).catch(() => 0);
  // In a relationship now? Each side settles one partner or more, and a one-partner side closes to dates.
  await settleCommitment(db, lo, hi).catch(() => {});
  // 2.4.2: Sparks (the stage that counts every date, as settleCommitment's does)? One more second date makes them a Dating
  // couple, so a one-partner side's owner hears it first, with the opt-out. 2.9.0: when the date that made them Sparks airs,
  // once (lib/partners.ts warnWhenSparksOut; 2.7.0 sent it when that date was written, ahead of its airing).
  await warnWhenSparksOut(db, lo, hi, rel).catch(() => 0);
  // The social network (lib/social/derive.ts): an aired public date counts toward its venue and its group night.
  if (opts.episodeId) {
    const episodeId = opts.episodeId;
    await socialHook("date", (d, deadline) => d.onDate(db, episodeId, { deadline }), { key: `date:${episodeId}` });
  }
  return told;
}
