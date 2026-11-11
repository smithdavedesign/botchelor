import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import PhoneActionBar from "@/app/PhoneActionBar";
import { redirect } from "next/navigation";
import Avatar from "@/app/Avatar";
import { pageMetadata, SITE_DESCRIPTION, SITE_TITLE } from "@/lib/seo";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { PACK_5 } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { listAiredFeed, listAiringSoon, listMyCharacters } from "@/lib/game";
import { feedEpisodes } from "@/lib/feed-items";
import { balancedColumns } from "@/lib/grid-balance";
import { countNotifications } from "@/lib/notifications";
import { sinceYouWereHere } from "@/lib/since";
import When from "@/app/When";
import { cachedConstellation } from "@/lib/graph-cache";
import { PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { seasonCastCards } from "@/lib/season-cast";
import { seasonFormatNow } from "@/lib/season-format-store";
import { GENERATE_FROM_DAY } from "@/lib/season-gen";
import { userIdFromCookieStore } from "@/lib/http";
import { ownedSkus } from "@/lib/payments";
import { FREE_EPISODES_PER_SEASON, PODIUM_SIZE } from "@/lib/rules";
import { cleanRef } from "@/lib/waitlist";
import DateExcerpt from "./DateExcerpt";
import { pickFeaturedDate } from "@/lib/featured-date";
import { CallsLine } from "./YourCalls";
import { airWindowMinutes } from "@/lib/air";
import { callRecord } from "@/lib/streaks";
import { sharerOf } from "@/lib/share-record-name";
import DareVote from "./DareVote";
import SituationVote from "./SituationVote";
import TonightBand from "./TonightBand";
import EpisodeShelf from "./EpisodeShelf";
import { listLobby } from "@/lib/watch";
import SeasonBanner from "./SeasonBanner";
import ShowSince from "./ShowSince";
import { showSince } from "@/lib/show-since";
import { dareBoard } from "@/lib/dares";
import { situationBoard } from "@/lib/situations";
import { revealBoard } from "@/lib/weekly-reveal";
import { getProfileName } from "@/lib/people";
import { forViewer, shared } from "@/lib/shared-cache";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({ title: SITE_TITLE, description: SITE_DESCRIPTION, path: "/" });

/** The house cast on the landing page: a taste (three rows of two); the directory has them all. */
const HOME_CAST_SHOWN = 6;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// How it works, in three rows with an icon (2026-10-31 UX audit, A2): the six feature cards and the four long steps said
// the same things; what's left of them (the soul, looks, seasons) is in the questions below.
const STEPS = [
  { icon: "🎨", title: "Make an original character", body: "A name, a short bio, three traits, a want and a dealbreaker: under a minute. A private soul and their looks if you like." },
  { icon: "🎲", title: "Send them on a blind date", body: "An engine decides how it ends and the AI writes it as a short episode. Nobody can steer it, not even you." },
  { icon: "🍿", title: "Watch it air", body: "Friends predict the ending for free points. Characters remember every date, and sparks and rivalries build." },
];

const FAQ = [
  { q: "Is it free?", a: `Yes. ${FREE_EPISODES_PER_SEASON} free dates a week, your first date is always free, and points can never be bought. Optional packs add dates, never points or odds.` },
  { q: "Can I steer the date?", a: "No, and that's the point. A deterministic engine decides the outcome; the AI only writes the dialogue to match it." },
  { q: "How do I date someone else's character?", a: "Swipe for your character. A like both ways is a match: the two of them text, and each decides whether it wants a date. If both do, you book it, and their chat goes into the date. This season's house cast needs no match." },
  { q: "Is my character's soul private?", a: "Yes. The soul is a private side only you see, and it can surprise you on a date. It can be kept local-only so it never touches any model, and you can delete it anytime." },
  { q: "Can I choose how they look?", a: "Yes. Pick their looks and a portrait is drawn from them, free; or describe them in your own words, or style them from an image read in your browser." },
  { q: "What's a season?", a: `A month. When it closes on the 1st, the top ${PODIUM_SIZE} in each friend league earn a badge, the two best-reviewed cast members stay on, and the open places go to people's own characters first: audition yours on the casting page and the votes decide.` },
  { q: "Who can use it?", a: "Characters are fictional adults only — no real people, no sexual content. Every episode is AI-labeled with a report button." },
  { q: "Do I need an account?", a: "No sign-up to start. Make a character and send it on a date right away; sign in later to keep it across devices." },
];

/**
 * The landing page, pitched at AI-friendly roleplayers, with two front doors (the 2026-11-07 outside reviews: too many
 * features compete for a first visit; one journey — create, watch, come back — should lead):
 *  - A first visit gets the pitch first: the hero, then the tonight band as proof the show is on, the latest aired
 *    dates, how it works, the cast, the reviews, questions. The audience cards (the situation vote, dares, your calls,
 *    the season banner) wait until they have a character; their boards aren't even fetched.
 *  - Someone with a character gets the show first (docs/show-style.md: lead with tonight): the tonight band, the season
 *    banner, "Since you were here" (2026-11-01 audit, J4: lib/since.ts), then everything else as before.
 */
export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const { ref, said, bots } = await searchParams;
  const refSlug = cleanRef(typeof ref === "string" ? ref : undefined);
  // The reviews' filters and pages moved to /reviews (2026-10-31 UX audit); an old link to them still lands there.
  if (typeof said === "string" || typeof bots === "string") {
    const q = new URLSearchParams();
    if (typeof said === "string") q.set("said", said);
    if (typeof bots === "string") q.set("bots", bots);
    if (refSlug) q.set("ref", refSlug);
    redirect(`/reviews?${q}`);
  }
  const viewerId = userIdFromCookieStore(await cookies());
  const db = viewerId ? await getDb() : null;
  const conn = db ?? (await getDb());
  // The viewer's own cards and the show's boards, all at once (2026-11-04 performance audit: one after another they were
  // eleven database round trips in a row, ~70 ms each from New York to the database in Oregon).
  const myCharactersP = db && viewerId ? listMyCharacters(db, viewerId) : Promise.resolve<Awaited<ReturnType<typeof listMyCharacters>>>([]);
  const profileNameP = db && viewerId ? getProfileName(db, viewerId).catch(() => null) : Promise.resolve(null);
  // A returning visitor sees what happened first (J4); a first visit is unchanged.
  const sinceP: Promise<[Awaited<ReturnType<typeof sinceYouWereHere>>, number]> = myCharactersP.then((mine) =>
    db && viewerId && mine.length
      ? Promise.all([sinceYouWereHere(db, viewerId, mine).catch(() => []), countNotifications(db, viewerId, { unread: true }).catch(() => 0)])
      : [[], 0],
  );
  const [owned, tokens, myCharacters, [since, unread], profileName, sharer, showNews, [aired, sky, situation, dares, record, airing, rooms, onSeason, reveal, seasonDef]] = await Promise.all([
    db && viewerId ? ownedSkus(db, viewerId) : Promise.resolve<string[]>([]),
    db && viewerId ? episodeAllowance(db, viewerId) : freshAllowance(),
    myCharactersP,
    sinceP,
    // Your calls line offers "Put my name on the board" to someone with no display name yet (app/BoardName.tsx).
    profileNameP,
    // Their shared calls link carries that name when it's theirs alone (lib/share-record-name.ts).
    profileNameP.then((name) => (db && viewerId && name ? sharerOf(db, viewerId).catch(() => null) : null)),
    // What happened on the show since their last visit (lib/show-since.ts): inside that card for an owner, its own card for
    // a spectator. Nothing on a first visit.
    db && viewerId ? showSince(db, viewerId).catch(() => null) : null,
    // Someone signed out sees what everyone does: from a few seconds' shared copy (lib/shared-cache.ts).
    Promise.all([
      // A mixer night is one card (2026-11-08 UI audit, item 2). Its own key: the gate caches listAiredPage as "home:aired".
      forViewer(viewerId, "home:feed", () => listAiredFeed(conn, viewerId, 1, 6)).catch(() => null),
      cachedConstellation(conn).catch(() => null), // the minute-old sky is plenty (2026-11-01 audit, R9)
      // The audience boards are a creator's: a first visit doesn't show them, so it doesn't pay for them either.
      myCharactersP.then((mine) => (mine.length ? forViewer(viewerId, "home:situation", () => situationBoard(conn, viewerId)).catch(() => null) : null)),
      myCharactersP.then((mine) => (mine.length ? forViewer(viewerId, "home:dares", () => dareBoard(conn, viewerId)).catch(() => null) : null)),
      // Your calls (lib/streaks.ts): your record and run, and how many dates you could still call.
      myCharactersP.then((mine) => (mine.length ? forViewer(viewerId, "home:calls", () => callRecord(conn, viewerId)).catch(() => null) : null)),
      forViewer(viewerId, "home:airing", () => listAiringSoon(conn, viewerId, airWindowMinutes())).catch(() => []),
      // The tonight band's live rooms (lib/watch.ts): what's on the air right now.
      forViewer(viewerId, "lobby", () => listLobby(conn)).catch(() => []),
      // This season's handful of house characters (lib/season-cast.ts), the same for everyone.
      shared("season-cast", () => seasonCastCards(conn)),
      // Sunday's reveal (lib/weekly-reveal.ts): the tonight band points at it while its vote is open, for everyone.
      forViewer(viewerId, "home:reveal", () => revealBoard(conn, viewerId)).catch(() => null),
      // This season's format, for the arc under the header (the same cached read /watch makes).
      shared("watch:season-format", () => seasonFormatNow(conn)).catch(() => null),
    ]),
  ]);

  // Plus any premium house character this viewer owns.
  const cast: { id: string; name: string; traits: string[]; premium: boolean; fan?: boolean; portrait?: string | null }[] = [
    ...onSeason.map((c) => ({ id: c.id, name: c.name, traits: [...c.traits], premium: false, fan: c.fan, portrait: c.portrait })),
    ...PREMIUM_HOUSE_CHARACTERS.filter((c) => owned.includes(c.sku)).map((c) => ({
      id: c.id,
      name: c.name,
      traits: [...c.traits],
      premium: true,
    })),
  ];
  const [heroA, heroB] = onSeason;
  // A real date's opening lines for the hero (lib/featured-date.ts), from the aired episodes already loaded.
  const airedEpisodes = feedEpisodes(aired?.items ?? []);
  const featured = pickFeaturedDate(airedEpisodes);
  // Next month's newcomers are written from the 20th (lib/season-gen.ts): from then, the cast strip points at them.
  const candidatesOut = new Date().getUTCDate() >= GENERATE_FROM_DAY;
  const creator = myCharacters.length > 0;
  const tonight = <TonightBand rooms={rooms} airing={airing} situation={situation} reveal={reveal} latest={airedEpisodes[0] ?? null} now={Date.now()} />;

  return (
    <div className="home page-wide">
      {/* A creator's show is on before anything else (docs/show-style.md: lead with tonight); a first visit meets the
          pitch first and the band right under it. */}
      {creator && tonight}
      {/* The first week of a month: last season's finale (lib/season-ref.ts). */}
      {creator && <SeasonBanner format={seasonDef?.title ?? null} />}
      {creator && (
        <section id="start" className="card start-card since-card" aria-labelledby="since-title">
          <div className="section-head">
            <h2 id="since-title">Since you were here</h2>
            {unread > 0 && (
              <Link href="/notifications">
                {unread} new {unread === 1 ? "notification" : "notifications"} →
              </Link>
            )}
          </div>
          <ul className="list since-list">
            {since.map((s) => (
              <li key={s.character.id} className="since-row">
                <Avatar seed={s.character.id} name={s.character.name} hue={s.character.hue} portraitSrc={s.character.portrait} size={40} />
                <span className="since-text">
                  <strong>{s.character.name}</strong>
                  <span className="muted small">
                    {s.news}
                    {s.at && (
                      <>
                        {" · "}
                        <When iso={s.at} />
                      </>
                    )}
                  </span>
                </span>
                <Link className="button-ghost small" href={s.href} aria-label={`${s.action}: ${s.character.name}`}>
                  {s.action}
                </Link>
              </li>
            ))}
          </ul>
          {showNews && <ShowSince card={showNews} inside />}
          <p className="muted small since-foot">
            {tokens.left} {tokens.left === 1 ? "date" : "dates"} left this week; free ones come back Monday. Want more? &ldquo;{PACK_5.name}&rdquo;
            is in the <Link href="/shop">shop</Link>. <Link href="/create">Build a new character</Link>.
          </p>
        </section>
      )}
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">For OC roleplayers</p>
          <h1>Send your OC on a blind date. Then just watch.</h1>
          <p className="lede">
            The showrunner writes the date — one short episode, written by AI, that nobody can steer. Build a character
            in under a minute. Free, no sign-up.
          </p>
          <p className="cta-row" id="hero-cta">
            <Link className="button" href="/create">
              Make your character
            </Link>
            <Link className="button-ghost" href="/watch">
              Watch episodes
            </Link>
          </p>
          {myCharacters.length === 0 && (
            <p className="small">
              In a hurry? <Link href="/create?sample=1">Start from a sample character</Link>.
            </p>
          )}
          <p className="trust-micro">Fictional characters only, no real people</p>
        </div>
        {/* The show itself where a made-up box score used to be (2026-11-07 audit, item 2): the opening lines of a real
            aired date, typing in, and the way to watch how it ends. The old matchup only when nothing has aired. */}
        {featured ? (
          <div className="hero-art has-date">
            {/* A first visit calls the ending on the card (app/FirstRunCall.tsx); a creator's hero just plays it. */}
            <DateExcerpt date={featured} call={!creator} />
          </div>
        ) : (
          heroA &&
          heroB && (
            <div className="hero-art">
              <div className="matchup">
                <Avatar seed={heroA.id} name={heroA.name} house size={64} />
                <span className="vs">×</span>
                <Avatar seed={heroB.id} name={heroB.name} house size={64} />
              </div>
              <p className="muted mini-cap">An engine decides how every date ends; friends guess it first.</p>
            </div>
          )
        )}
      </section>
      {myCharacters.length === 0 && (
        <PhoneActionBar watch="hero-cta">
          <Link className="button" href="/create">
            Make your character
          </Link>
        </PhoneActionBar>
      )}
      {/* The season's arc for a visitor too (the design system, 2026-11-11): the show has a month, and this is where in it we are. */}
      {!creator && <SeasonBanner format={seasonDef?.title ?? null} />}
      {!creator && tonight}
      {!creator && showNews && <ShowSince card={showNews} />}

      {situation && <SituationVote board={situation} now={Date.now()} />}
      {dares && <DareVote board={dares} />}
      {record && (record.called > 0 || airing.length > 0) && <CallsLine record={record} airing={airing.length} href="/watch#airing-soon" nameless={viewerId !== null && profileName === null} sharer={sharer} where="home" />}

      {aired && aired.items.length > 0 && (
        <section className="home-aired">
          <div className="section-head">
            <h2>Just aired</h2>
            <Link href="/watch">Watch more →</Link>
          </div>
          {/* A shelf of small title cards, not rows (docs/show-style.md: faces first). */}
          <EpisodeShelf items={aired.items.slice(0, 6)} />
        </section>
      )}

      <section className="home-how">
        <h2>How it works</h2>
        <ol className="features home-features">
          {STEPS.map((f) => (
            <li className="feature card" key={f.title}>
              <span className="feature-icon" aria-hidden="true">
                {f.icon}
              </span>
              <div>
                <h3>{f.title}</h3>
                <p className="muted">{f.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2>This season&apos;s cast</h2>
        <p className="muted">
          A handful a month. Date one now, or <Link href="/swipe">swipe</Link> to match with another creator&apos;s character.
        </p>
        <ul className="home-cast-faces grid-balanced" style={{ "--cols": balancedColumns(Math.min(cast.length, HOME_CAST_SHOWN), 4) } as CSSProperties}>
          {cast.slice(0, HOME_CAST_SHOWN).map((p) => (
            <li key={p.id} className="card tap-card home-cast-tile">
              <Avatar seed={p.id} name={p.name} house={!p.fan} portraitSrc={p.portrait ?? null} size={72} />
              <Link className="stretch home-cast-name" href={`/characters/${p.id}`}>
                <strong>{p.name}</strong>
              </Link>
              {p.premium && <span className="badge">Premium</span>}
              {p.fan && <span className="badge">Fan pick</span>}
              <span className="home-cast-traits">{p.traits.slice(0, 2).join(" · ")}</span>
            </li>
          ))}
        </ul>
        <p className="muted home-cast-more">
          <Link href="/characters">
            <strong>See every character →</strong>
          </Link>{" "}
          · <Link href="/casting">🎬 Audition yours for next month</Link>
          {candidatesOut && (
            <>
              {" "}
              · <Link href="/characters#next-season">Meet next month&apos;s candidates</Link>
            </>
          )}
        </p>
        {/* The Constellation's own card is gone (A2): its numbers ride on the link. */}
        <p className="muted small home-sky-line">
          <Link href="/graph">✨ The Constellation: a map of who&apos;s dated whom</Link>
          {sky && sky.stats.couples > 0 && ` · ${sky.stats.characters} characters, ${sky.stats.couples} couples`}
        </p>
        <p className="muted small home-sky-line">
          Free tools: <Link href="/tools/oc-chemistry-test">the OC chemistry test</Link> ·{" "}
          <Link href="/tools/ship-name-generator">a ship name generator</Link>
        </p>
      </section>

      <section className="faq">
        <h2>Questions</h2>
        {FAQ.map((item) => (
          <details className="card ux-fold" key={item.q}>
            <summary>{item.q}</summary>
            <p className="muted">{item.a}</p>
          </details>
        ))}
      </section>

      <p className="cta-row cta-final">
        <Link className="button" href="/create">
          Make your character
        </Link>
      </p>
    </div>
  );
}
