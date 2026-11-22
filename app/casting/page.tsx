import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import SetHero from "@/app/SetHero";
import LeadFace from "./LeadFace";
import Avatar from "@/app/Avatar";
import FaceLoop from "@/app/FaceLoop";
import Tilt from "@/app/motion/Tilt";
import Icon from "@/app/Icon";
import { AUDITION_MIN_DATES, auditionPicks, castingBoard, type AuditionPick } from "@/lib/auditions";
import { auditionWords } from "@/lib/audition-words";
import { isInsider } from "@/lib/crowd-threshold";
import { getDb, type Db } from "@/lib/db";
import { authFromCookieStore, userIdFromCookieStore } from "@/lib/http";
import { portraitPathSql } from "@/lib/portrait-sql";
import { HOUSE_MIN, SURVIVORS, leadOverride, seasonCastCards, seasonCastSize, seasonMonth, type CastCard } from "@/lib/season-cast";
import { seasonFormat, type SeasonFormatDef } from "@/lib/season-format";
import { seasonFormatSlug } from "@/lib/season-format-store";
import { seasonPageLiveOn } from "@/lib/season-page";
import { seasonPath } from "@/lib/season-ref";
import { pageMetadata } from "@/lib/seo";
import CastingBoard from "./CastingBoard";
import OpenSlots from "./OpenSlots";

export const dynamic = "force-dynamic";

const DESCRIPTION = "People's own characters, auditioning for next month's cast on Botchelor. Vote for the one you want on the show.";

export const metadata: Metadata = pageMetadata({ title: "Casting: who's on next month's Botchelor", description: DESCRIPTION, path: "/casting" });

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/** A face in a taken slot: this month's cast member, or a lead format's lead. */
type SlotCard = Pick<CastCard, "id" | "name" | "hue" | "fan" | "portrait" | "archetype">;

/** The lead's card when they aren't on this month's cast (the admin can pick any public house character). */
async function leadCard(db: Db, id: string): Promise<SlotCard | null> {
  const { rows } = await db.query<{ id: string; name: string; hue: number | null; portrait: string | null }>(
    `select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait from characters c where c.id = $1`,
    [id],
  );
  const r = rows[0];
  return r ? { id: r.id, name: r.name, hue: r.hue ?? 200, fan: false, portrait: r.portrait, archetype: "From the house" } : null;
}

/**
 * No auditions yet: the places as slots, so the empty board still shows what's being cast for (the lift, 2026-11-13: one
 * plain box over a blank column). This month's cast in the taken slots, the open places as dashed empty ones, and the
 * one step: make a character to audition, or go to your own when you have one.
 *
 * On a lead format (The Botchelor) next month isn't this month's cast: it is the lead and the suitors. The lead, when
 * picked, has a slot of their own marked as the lead, then the suitors' places; nobody from this month's cast sits in
 * one (visual audit 2026-11-20: Nell, December's lead, filled a slot under "No suitors yet", as if applying to date herself).
 */
function CastingSlots({ label, month, cast, lead, size, open, picks, def }: { label: string; month: string; cast: SlotCard[]; lead: SlotCard | null; size: number; open: number; picks: AuditionPick[] | null; def: SeasonFormatDef }) {
  const hasOwn = (picks?.length ?? 0) > 0;
  const words = auditionWords(def.lead);
  const taken = def.lead ? [] : cast.slice(0, size);
  return (
    <section className="card casting-empty" aria-labelledby="casting-empty-title">
      <h2 id="casting-empty-title">No {def.lead ? "suitors" : "auditions"} yet for {label}</h2>
      <p className="muted">
        {def.lead ? (
          <>
            Be the first: press an open place and pick one of your characters. {label} is {def.title}: one lead from the house, and{" "}
            {open} {open === 1 ? "place" : "places"} for people&apos;s characters as the suitors, with a rose ceremony every Sunday.
          </>
        ) : (
          <>
            Be the first: press an open place and pick one of your characters. Next month has {size} places; the {SURVIVORS} most loved of this
            month&apos;s cast stay on, and {open} {open === 1 ? "place is" : "places are"} open to people&apos;s characters.
          </>
        )}
      </p>
      <ul className="casting-slots" aria-label={def.lead ? `${month}'s lead, and the suitors' open places` : "This month's cast, and next month's open places"}>
        {def.lead && lead && (
          <Tilt as="li" className="casting-slot is-taken is-lead tap-card" max={5}>
            <FaceLoop id={lead.id} radius={56 * 0.28}>
              <Avatar seed={lead.id} name={lead.name} hue={lead.hue} house={!lead.fan} portraitSrc={lead.portrait} size={56} decorative />
            </FaceLoop>
            <span className="casting-slot-text">
              <Link className="stretch" href={`/characters/${lead.id}`}>
                <strong>{lead.name}</strong>
              </Link>
              <span className="muted small">{`${lead.archetype} · ${month}'s lead`}</span>
            </span>
          </Tilt>
        )}
        {taken.map((c) => (
          <Tilt as="li" key={c.id} className="casting-slot is-taken tap-card" max={5}>
            <FaceLoop id={c.id} radius={56 * 0.28}>
              <Avatar seed={c.id} name={c.name} hue={c.hue} house={!c.fan} portraitSrc={c.portrait} size={56} decorative />
            </FaceLoop>
            <span className="casting-slot-text">
              <Link className="stretch" href={`/characters/${c.id}`}>
                <strong>{c.name}</strong>
              </Link>
              <span className="muted small">{c.archetype} · on this month&apos;s cast</span>
            </span>
          </Tilt>
        ))}
        {/* The open places are buttons: a press picks one of your characters and puts it up (app/casting/OpenSlots.tsx). */}
        <OpenSlots count={open} picks={picks} noun={def.lead ? words.noun : null} label={label} />
      </ul>
      <p className="cta-row">
        {hasOwn ? (
          <Link href="/account" className="button" data-track="casting-empty-yours">
            Your characters
          </Link>
        ) : (
          <>
            <Link href="/create" className="button" data-track="casting-empty-create">
              Make a character to audition
            </Link>
            {/* The rule the button can't say (the 2026-11-22 audit: it was only in the rail, below the fold on a phone). */}
            <span className="muted small">It can audition after {AUDITION_MIN_DATES} public dates, so voters have something to judge.</span>
          </>
        )}
      </p>
    </section>
  );
}

/**
 * Casting (/casting): next month's auditions (lib/auditions.ts), most votes first. People's characters only: the
 * shortlisted ones with the most votes take the open places on the cast when the month starts.
 */
export default async function CastingPage() {
  const store = await cookies();
  const viewer = userIdFromCookieStore(store);
  const auth = authFromCookieStore(store);
  const db = await getDb();
  const [board, insider] = await Promise.all([castingBoard(db, viewer), isInsider(db, viewer)]);
  // Next season's format (lib/season-format.ts): on The Botchelor the open places are the lead's suitors (lib/ceremony.ts).
  const def = seasonFormat(await seasonFormatSlug(db, board.season_id).catch(() => null));
  const words = auditionWords(def.lead);
  const size = def.lead ? def.lead.places : seasonCastSize();
  const open = def.lead ? def.lead.places - 1 : Math.max(0, size - HOUSE_MIN);
  // Only an empty board draws the slots, so a board with auditions costs nothing more.
  const [cast, own, leadId] = board.auditions.length
    ? [[], [], null]
    : await Promise.all([
        seasonCastCards(db).catch(() => [] as CastCard[]),
        // Their own characters, each with what stands between it and an audition, for the open places' picker.
        viewer ? auditionPicks(db, { userId: viewer, authenticated: auth?.authenticated === true }).catch(() => []) : Promise.resolve(null),
        // A lead format's lead, once picked on /admin/season (lib/season-cast.ts leadOverride; else it's known on the 1st).
        def.lead ? leadOverride(db, board.season_id).catch(() => null) : Promise.resolve(null),
      ]);
  const lead = leadId ? (cast.find((c) => c.id === leadId) ?? (await leadCard(db, leadId).catch(() => null))) : null;
  // The page as the design system draws it (all-screens board, 2026-11-11): the auditions, and beside them how a
  // character gets in and how to put one up. The rules are lib/season-cast.ts pickCast's, in words.
  return (
    <article className="casting-page page-wide">
      {/* On the stage, where the cast is chosen (the visual pop audit, 2026-11-20). */}
      <SetHero
        set="stage"
        kicker={`Casting · ${board.label}`}
        title={def.lead ? `Who dates the lead on ${def.title}?` : "Who's on next month's show?"}
        // The question's answer, once the lead is picked: their face, big and moving (app/casting/LeadFace.tsx).
        media={def.lead && lead ? <LeadFace lead={lead} month={seasonMonth(board.season_id)} /> : undefined}
        // "Vote for the one you want to watch" only once there's someone to vote for, and the season's name as a name, not
        // a possessive (the 2026-11-22 audit: "December 2026's The Botchelor" over an empty board).
        lede={
          def.lead
            ? board.auditions.length
              ? `These are characters people made, applying to be the suitors on ${def.title} in ${board.label}: one lead from the house, and a rose ceremony every Sunday. Vote for the one you want to watch: one vote a viewer, and voting again moves it.`
              : `Characters people made apply here to be the suitors on ${def.title} in ${board.label}: one lead from the house, and a rose ceremony every Sunday. Once they do, you vote for the one you want to watch.`
            : board.auditions.length
              ? `These are characters people made, auditioning for the ${board.label} cast. Vote for the one you want to watch: one vote a viewer, and voting again moves it.`
              : `Characters people made audition here for the ${board.label} cast. Once they do, you vote for the one you want to watch.`
        }
      >
        {/* The lead season's own page (docs/season-page.md): one quiet line, for whoever came to vote not knowing the show. */}
        {def.lead && seasonPageLiveOn() && (
          <p className="small casting-what">
            <Link href={seasonPath(board.season_id)} data-track="casting-season-page">
              What is {def.title}? →
            </Link>
          </p>
        )}
      </SetHero>
      <div className="casting-layout">
        <div className="casting-main">
          {board.auditions.length ? <CastingBoard board={board} viewer={viewer} insider={insider} /> : <CastingSlots label={board.label} month={seasonMonth(board.season_id)} cast={cast} lead={lead} size={size} open={open} picks={own} def={def} />}
        </div>
        <aside className="casting-rail" aria-label="How casting works">
          <section className="card casting-rules">
            <h2>{def.lead ? "How a character becomes a suitor" : "How a character gets in"}</h2>
            {def.lead ? (
              <ol>
                <li>
                  {board.label} runs as <strong>{def.title}</strong>: one lead from the house cast and <strong>{open} suitors</strong>, people&apos;s
                  own characters first.
                </li>
                <li>The lead is last season&apos;s most reviewed survivor. The suitors date the lead all week, in turn.</li>
                <li>
                  When the month starts on {day(board.closes_at)}, the <strong>shortlisted</strong> applicants with the most votes take the suitors&apos;
                  places; the house&apos;s own agent-made characters fill whatever is left.
                </li>
                <li>Every Sunday a rose ceremony sends two home: one by the audience&apos;s vote, one by how the lead&apos;s dates went. The last Sunday is the final rose.</li>
                <li>Votes and reviews never change a date, the odds or anyone&apos;s points.</li>
              </ol>
            ) : (
              <ol>
                <li>
                  Each season is a month, and its cast has <strong>{size} places</strong>. Anyone can date a cast member by name, all
                  month.
                </li>
                <li>
                  The last season&apos;s <strong>{SURVIVORS} most loved</strong> stay on, by their reviews.
                </li>
                <li>
                  When the month starts on {day(board.closes_at)}, the <strong>shortlisted</strong> auditions with the most votes take
                  up to {open} of the open places.
                </li>
                <li>House newcomers fill whatever is left.</li>
                <li>Votes and reviews never change a date, the odds or anyone&apos;s points.</li>
              </ol>
            )}
          </section>
          <section className="card casting-yours">
            <h2>Got a character?</h2>
            <p className="small">
              Open its page and press <em>{def.lead ? words.verb : `Audition for ${board.label}`}</em>. People&apos;s own characters only, with{" "}
              {AUDITION_MIN_DATES} public dates first so voters have something to judge. You can withdraw it at any time.
            </p>
            <Link href="/account" className="button secondary small">
              Your characters
            </Link>
          </section>
        </aside>
      </div>
    </article>
  );
}
