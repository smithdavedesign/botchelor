import type { Metadata } from "next";
import { Fragment, type CSSProperties } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import Icon, { type IconName } from "@/app/Icon";
import PhoneActionBar from "@/app/PhoneActionBar";
import { redirect } from "next/navigation";
import Avatar from "@/app/Avatar";
import { pageMetadata, SITE_DESCRIPTION, SITE_TITLE } from "@/lib/seo";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { PACK_5 } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { listAiredFeed, listAiringSoon, listMyCharacters, listStandoutDates } from "@/lib/game";
import { feedEpisodes } from "@/lib/feed-items";
import { balancedColumns } from "@/lib/grid-balance";
import { countNotifications } from "@/lib/notifications";
import { sinceYouWereHere } from "@/lib/since";
import { characterPhone } from "@/lib/character-phone";
import { showIdeasOn } from "@/lib/show-ideas-switch";
import { stepInOpen } from "@/lib/step-in-switch";
import CharacterPhone from "./CharacterPhone";
import RememberCharacter from "./RememberCharacter";
import { rememberedCharacter } from "@/lib/current-character";
import When from "@/app/When";
import { skyCounts } from "@/lib/graph";
import { PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { seasonCastCards } from "@/lib/season-cast";
import { seasonFormatNow } from "@/lib/season-format-store";
import { ceremonyBoard } from "@/lib/ceremony";
import { castingFirstDateLine, castingHeroLine, castingLead } from "@/lib/casting";
import { GENERATE_FROM_DAY } from "@/lib/season-gen";
import { userIdFromCookieStore } from "@/lib/http";
import { ownedSkus } from "@/lib/payments";
import { FREE_EPISODES_PER_SEASON } from "@/lib/rules";
import { cleanRef } from "@/lib/waitlist";
import { IMPORT_CAI_PATH } from "@/lib/import-character";
import { ALTERNATIVES, alternativePath } from "@/lib/alternatives";
import { FREE_TOOLS } from "@/lib/tools";
import DateExcerpt from "./DateExcerpt";
import { pickFeaturedDate } from "@/lib/featured-date";
import { CallsLine } from "./YourCalls";
import { airWindowMinutes } from "@/lib/air";
import { callRecord } from "@/lib/streaks";
import { sharerOf } from "@/lib/share-record-name";
import SituationVote from "./SituationVote";
import TonightBand from "./TonightBand";
import TonightVotes from "./TonightVotes";
import { storyToday } from "@/lib/producer";
import { latestHouseScene } from "@/lib/house-scenes";
import EpisodeShelf from "./EpisodeShelf";
import { listLobby } from "@/lib/watch";
import { nextPremiere } from "@/lib/sunday-premiere";
import ShowSince from "./ShowSince";
import { showSince } from "@/lib/show-since";
import { dareBoard } from "@/lib/dares";
import { situationBoard } from "@/lib/situations";
import { revealBoard } from "@/lib/weekly-reveal";
import { getProfileName } from "@/lib/people";
import { forViewer, shared } from "@/lib/shared-cache";
import { clipCaption, homeExpressBoxOn, homeHeroClipOn, latestHomeClip } from "@/lib/home-clip";
import HomeClip from "./HomeClip";
import { PROMO } from "@/lib/promo-videos";
import HomeExpressBox from "./HomeExpressBox";
import HomeOpen from "./HomeOpen";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";
import { homeOpenOn, homePhoneClipOn, openKicker, openLine, openTonight, type OpenTonight } from "@/lib/home-open";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({ title: SITE_TITLE, description: SITE_DESCRIPTION, path: "/" });

/** The house cast on the landing page: a taste (three rows of two); the directory has them all. */
const HOME_CAST_SHOWN = 6;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// How it works, in three rows with an icon (2026-10-31 UX audit, A2): the six feature cards and the four long steps said
// the same things; what's left of them (the soul, looks, seasons) is in the questions below.
const STEPS: { icon: IconName; title: string; body: string }[] = [
  { icon: "wand", title: msg("Make an original character"), body: msg("A name, a short bio, three traits, a want and a dealbreaker, or 🎲 Surprise me fills the blanks. A private soul and their looks if you like.") },
  { icon: "send", title: msg("Send them on a blind date"), body: msg("An engine decides how it ends and the AI writes it as a short episode. Nobody can steer it, not even you.") },
  { icon: "tv", title: msg("Watch it air"), body: msg("Viewers call the ending for free points. Characters remember every date, and sparks and rivalries build.") },
];

// The three questions a first visit asks; the rest are on /faq (the audit, 2026-11-11, 2.1). The first date uses one of
// the week's free dates (lib/allowance.ts): nothing reserves it separately, so the answer says that.
/** In the page's language (docs/i18n.md). The first answer carries a number, so it's a template. */
const homeFaq = (t: (s: string, v?: Record<string, string | number>) => string) => [
  { q: t("Is it free?"), a: t("Yes. {n} free dates a week, no sign-up; your first date uses one of them. Points can never be bought, and optional packs add dates, never points or odds.", { n: FREE_EPISODES_PER_SEASON }) },
  { q: t("Can I steer the date?"), a: t("No, and that's the point. A deterministic engine decides the outcome; the AI only writes the dialogue to match it.") },
  { q: t("Do I need an account?"), a: t("No sign-up to start. Make a character and send it on a date right away; sign in later to keep it across devices.") },
];

/**
 * The landing page, pitched at AI-friendly roleplayers, with two front doors (the 2026-11-07 outside reviews: too many
 * features compete for a first visit; one journey — create, watch, come back — should lead):
 *  - A first visit gets one screen with one job (app/HomeOpen.tsx; the growth plan, 2026-11-19, and the product audit,
 *    2026-11-21): the stage, the promise, the sentence box and the day's clip, whose button is the way to watch. Under
 *    it: a real date to call the ending of, what just aired, how it works, three questions and the way in again. The
 *    tonight band, the votes, the cast and the map wait until they have a character; their boards aren't even fetched.
 *    (HOME_OPEN=0 brings back the page as it was: the hero, the band, the situation vote, the cast.)
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
  const cookieStore = await cookies();
  // The page in the visitor's language (docs/i18n.md): a first visit's page is translated; an owner's, not yet.
  const t = await getT();
  const viewerId = userIdFromCookieStore(cookieStore);
  const db = viewerId ? await getDb() : null;
  const conn = db ?? (await getDb());
  // Open casting (lib/casting.ts): who a new character's first date goes to while a Botchelor lead is taking walk-ons.
  // Started here so it rides alongside the reads below; the same few seconds' shared copy for everyone.
  const castingP = shared("casting-lead", () => castingLead(conn)).catch(() => null);
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
  // Their character's phone (lib/character-phone.ts): one read next to "Since you were here", no round trip of its own.
  // It leads with the character the header shows (lib/current-character.ts); with none remembered, its own pick becomes
  // the remembered one (RememberCharacter below), so the header and every page that follows it agree.
  const picked = rememberedCharacter(cookieStore);
  const phoneP = myCharactersP.then((mine) => (db && viewerId && mine.length ? characterPhone(db, viewerId, mine, undefined, undefined, picked).catch(() => null) : null));
  // A stranger's first screen (lib/home-open.ts): tonight's story (who steps forward on the stage), read only for someone
  // with no character while HOME_OPEN is on; the same few seconds' shared copy for everyone.
  const openP: Promise<{ story: OpenTonight | null } | null> = myCharactersP.then((mine) =>
    mine.length || !homeOpenOn() ? null : shared("home:open-tonight", () => openTonight(conn)).then((story) => ({ story })).catch(() => ({ story: null })),
  );
  const [owned, tokens, myCharacters, [since, unread], phone, profileName, sharer, showNews, [aired, standout, sky, situation, dares, record, airing, rooms, onSeason, reveal, seasonDef, ceremony, house, story, clipRow, premiere], openRead] = await Promise.all([
    db && viewerId ? ownedSkus(db, viewerId) : Promise.resolve<string[]>([]),
    db && viewerId ? episodeAllowance(db, viewerId) : freshAllowance(),
    myCharactersP,
    sinceP,
    phoneP,
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
      // The hero's sample date: the week's best-rated dates (lib/game.ts listStandoutDates), shared with the 18+ gate.
      forViewer(viewerId, "home:standout", () => listStandoutDates(conn, viewerId)).catch(() => []),
      // Two counts for the Constellation link, not the whole sky (2026-11-19): a few seconds' shared copy.
      shared("home:sky-counts", () => skyCounts(conn)).catch(() => null),
      // Tonight's situation: an owner's Tonight card and band. A first visit's one screen has neither (the votes are on
      // /watch), so it doesn't pay for the board; with HOME_OPEN=0 the old page shows it to everyone, as before.
      myCharactersP.then((mine) => (mine.length || !homeOpenOn() ? forViewer(viewerId, "home:situation", () => situationBoard(conn, viewerId)).catch(() => null) : null)),
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
      // The rose ceremony (lib/ceremony.ts): the tonight band points at its vote on a Botchelor season; null otherwise.
      forViewer(viewerId, "watch:ceremony", () => ceremonyBoard(conn, viewerId)).catch(() => null),
      // The newest scene in the show's house (lib/house-scenes.ts): the tonight band's house line, the same for everyone.
      shared("house:latest", () => latestHouseScene(conn)).catch(() => null),
      // Today's story from the producer (lib/producer.ts): the band's "Tonight:" line. The same for everyone; null most days.
      shared("story:today", () => storyToday(conn)).catch(() => null),
      // The day's clip for a stranger's hero (lib/home-clip.ts): the same for everyone, so from the shared copy; an owner's
      // home (their character's phone) doesn't show it and doesn't read it.
      myCharactersP.then((mine) => (mine.length || !homeHeroClipOn() ? null : shared("home:clip", () => latestHomeClip(conn)).catch(() => null))),
      // The Sunday premiere (lib/sunday-premiere.ts): the tonight band's slot on its day, before its room opens. Only read
      // on a Sunday (UTC), the same for everyone.
      new Date().getUTCDay() === 0 ? shared("premiere:next", () => nextPremiere(conn)).catch(() => null) : null,
    ]),
    openP,
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
  const airedEpisodes = feedEpisodes(aired?.items ?? []);
  // The hero's real date (lib/featured-date.ts): the best moment of one of the week's best-rated dates (2026-11-11
  // bounce review: the newest one was often hard to follow cold), else the newest date's opening.
  const best = pickFeaturedDate(standout, undefined, { best: true });
  const featured = best ?? pickFeaturedDate(airedEpisodes);
  // Next month's newcomers are written from the 20th (lib/season-gen.ts): from then, the cast strip points at them.
  const candidatesOut = new Date().getUTCDate() >= GENERATE_FROM_DAY;
  const creator = myCharacters.length > 0;
  // Open casting: a stranger's hero says who their character's first date is with; an owner's hero is unchanged.
  const casting = creator ? null : await castingP;
  // A stranger's hero plays the day's clip when there is a fresh one (lib/home-clip.ts); otherwise it is what it was.
  const clip = creator ? null : clipRow;
  // The sentence box under the headline, for a visitor with no character, while one-sentence create is on.
  const expressBox = !creator && homeExpressBoxOn();
  // The one screen for someone with no character (app/HomeOpen.tsx): the cast on the stage with tonight's people stepped
  // forward, what to do in a sentence, the box and the clip (whose own button is the way to watch first).
  const open = (() => {
    if (!openRead) return null;
    const { story: openStory } = openRead;
    const leads = openStory?.who ?? (featured ? [...featured.characters] : []);
    return {
      // The season strip under the header steps aside on this screen whenever it would say the season's arc.
      arc: openKicker(new Date(), seasonDef) !== null,
      line: openLine(onSeason, leads),
      lede: [expressBox ? t("Describe a character in a sentence.") : t("Make a character in a minute."), casting ? castingFirstDateLine(casting, t) : t("They go on a blind date an AI writes."), t("You watch it air. Free, no sign-up.")].join(" "),
      // On a phone the clip stands on the stage, playing in the first screen (HOME_PHONE_CLIP=0: under the box again).
      stage: homePhoneClipOn(),
    };
  })();
  const tonight = <TonightBand rooms={rooms} airing={airing} situation={situation} reveal={reveal} ceremony={ceremony} latest={airedEpisodes[0] ?? null} house={house} now={Date.now()} insider={creator} story={story} premiere={premiere} />;

  return (
    <div className="home page-wide">
      {/* A creator's show is on before anything else (docs/show-style.md: lead with tonight); a first visit meets the
          pitch first and the band right under it. */}
      {/* An owner lands on their character (2026-11-15): its phone first, then the show (HOME_PHONE=0: the show first, as before). */}
      {/* An owner's home has no hero any more (B10), so its one h1 is for screen readers. */}
      {creator && <h1 className="sr-only">Your characters and the show</h1>}
      {phone && <CharacterPhone phone={phone} />}
      {phone && <RememberCharacter id={phone.character.id} />}
      {creator && tonight}
      {/* The first week of a month: last season's finale (lib/season-ref.ts). */}
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
      {/* A first visit's one screen (app/HomeOpen.tsx): the promise, the sentence box, the day's clip (the show's own loop
          on a day without one; on a phone, on the stage in the first screen), and one quiet way to watch first. */}
      {open && (
        <HomeOpen
          arc={open.arc}
          line={open.line}
          lede={open.lede}
          onStage={open.stage}
          t={t}
          box={expressBox ? <HomeExpressBox /> : null}
          clip={
            clip ? (
              <HomeClip loopSrc={clip.loop_src} posterSrc={clip.poster_src} width={clip.width} height={clip.height} watchHref={clip.watch_href} caption={clipCaption(clip, t)} home={{ stage: open.stage }} />
            ) : (
              <HomeClip
                loopSrc={PROMO.homeLoop.src}
                posterSrc={PROMO.homeLoop.poster}
                width={PROMO.homeLoop.width}
                height={PROMO.homeLoop.height}
                watchHref="/watch"
                caption={`Juniper Vale × Nell Abiodun · ${t("How does it end?")}`}
                kicker={t("From the show")}
                watchLabel={t("Watch episodes")}
                home={{ stage: open.stage }}
              />
            )
          }
        />
      )}
      {/* The page as it was, with HOME_OPEN=0: the pitch in a hero of its own. The pitch is a visitor's (the 2026-11-20
          mobile audit, B10): an owner already made a character, so their home goes straight to the show. */}
      {!creator && !open && (
      <section className={clip ? "hero has-clip" : "hero"}>
        <div className="hero-copy">
          {/* The promise (docs/ideas.md "The core, 2026-11-14"): your character has a love life, and you're in their corner. */}
          <p className="kicker">Your character&apos;s love life</p>
          <h1 className="hero-title">Give your character a love life.</h1>
          <p className="lede">
            {casting
              ? `${castingHeroLine(casting)} `
              : "They go on blind dates nobody steers, text you how it went, and take your advice into the next one. "}
            Make one in a minute — free, no sign-up.
          </p>
          {expressBox && <HomeExpressBox />}
          {/* One "Make your character" door above the fold and one at the end (the 2026-11-20 mobile audit, A2). */}
          <p className="cta-row" id="hero-cta">
            {/* With the box above, the box's own button is the main one and this is the long way in. */}
            <Link className={expressBox ? "button-ghost" : "button"} href="/create">
              Make your character
            </Link>
            {/* One loud way in and one quiet one (design review 2026-11-16, D-18): with the clip beside the copy, its own
                "Watch the whole date" is the way to watch, so the hero doesn't ask twice. */}
            {!clip && (
              <Link className="button-ghost" href="/watch">
                Watch episodes
              </Link>
            )}
          </p>
          {/* The sample and the Character.AI rescue door (2026-11-14) share one quiet line, for a visitor with no character yet. */}
          {myCharacters.length === 0 && (
            <p className="small hero-doors">
              In a hurry?{" "}
              <Link className="tap-link" href="/create?sample=1">
                Start from a sample character
              </Link>
              . Leaving Character.AI?{" "}
              <Link className="tap-link" href={IMPORT_CAI_PATH} data-track="hero-import">
                Bring your character
              </Link>
              .
            </p>
          )}
          <p className="trust-micro">Fictional characters only, no real people. Every date is written by AI.</p>
        </div>
        {/* The show itself where a made-up box score used to be (2026-11-07 audit, item 2): a few lines of a real aired
            date (its best moment, 2026-11-11), typing in, and the way to watch how it ends. The old matchup only when
            nothing has aired. */}
        {clip ? (
          // The show itself, moving (2026-11-15): the day's clip in a phone. The typed-in date moves under the hero.
          <div className="hero-art has-clip">
            <HomeClip loopSrc={clip.loop_src} posterSrc={clip.poster_src} width={clip.width} height={clip.height} watchHref={clip.watch_href} caption={clipCaption(clip)} />
          </div>
        ) : featured ? (
          <div className="hero-art has-date">
            {/* A first visit calls the ending on the card (app/FirstRunCall.tsx); a creator's hero just plays it. */}
            <DateExcerpt date={featured} call={!creator} />
          </div>
        ) : creator ? (
          // An owner's hero is as it was: no clip, so the matchup of two house faces.
          heroA &&
          heroB && (
            <div className="hero-art">
              <div className="matchup">
                <Avatar seed={heroA.id} name={heroA.name} house portraitSrc={heroA.portrait} size={64} />
                <span className="vs">×</span>
                <Avatar seed={heroB.id} name={heroB.name} house portraitSrc={heroB.portrait} size={64} />
              </div>
              <p className="muted mini-cap">An engine decides how every date ends; friends guess it first.</p>
            </div>
          )
        ) : (
          // A stranger with nothing aired to show (a new database, a quiet fortnight): the show's own ad
          // (lib/promo-videos.ts), where the matchup of two house faces used to stand.
          <div className="hero-art has-clip">
            <HomeClip
              loopSrc={PROMO.homeLoop.src}
              posterSrc={PROMO.homeLoop.poster}
              width={PROMO.homeLoop.width}
              height={PROMO.homeLoop.height}
              watchHref="/watch"
              caption="Juniper Vale × Nell Abiodun · How does it end?"
              kicker="From the show"
              watchLabel="Watch episodes"
            />
          </div>
        )}
      </section>
      )}
      {/* With the clip up top, the real date a first visit calls the ending of (app/FirstRunCall.tsx) follows it. */}
      {(open ? featured : clip && featured) && featured && (
        <section className="home-date" aria-label={t("A date from the show")}>
          <DateExcerpt date={featured} call={!creator} wide />
        </section>
      )}
      {/* Two doors in thumb reach, so both labels are short: measured one line each at 360px and up (2026-11-14). Only on
          the old page: the one screen keeps its field in the first screen, and nothing floats over it. */}
      {myCharacters.length === 0 && !open && (
        <PhoneActionBar watch="hero-cta">
          <Link className="button" href="/create" aria-label="Make your character">
            Make yours
          </Link>
          <Link className="button-ghost" href={IMPORT_CAI_PATH} data-track="hero-import" aria-label="Leaving Character.AI? Bring your character">
            Bring yours
          </Link>
        </PhoneActionBar>
      )}
      {/* The old page showed a visitor the band too; the one screen leaves tonight's workings to /watch. */}
      {!creator && !open && tonight}
      {!creator && showNews && <ShowSince card={showNews} />}

      {/* Tonight's two votes are one card for an owner (app/TonightVotes.tsx). A visitor sees the situation only on the
          old page; on the one screen the board isn't read. */}
      {creator ? <TonightVotes situation={situation} dares={dares} now={Date.now()} insider /> : situation && <SituationVote board={situation} now={Date.now()} />}
      {record && (record.called > 0 || airing.length > 0) && <CallsLine record={record} airing={airing.length} href="/watch#airing-soon" nameless={viewerId !== null && profileName === null} sharer={sharer} where="home" />}

      {aired && aired.items.length > 0 && (
        <section className="home-aired">
          <div className="section-head">
            <h2>{t("Just aired")}</h2>
            <Link href="/watch">{t("Watch more")} →</Link>
          </div>
          {/* A shelf of small title cards, not rows (docs/show-style.md: faces first). Three: the hero already plays the
              latest and /watch has the rest (the audit, 2026-11-11, 2.1: six cards, two of them the same mixer). */}
          <EpisodeShelf items={aired.items.slice(0, 3)} />
        </section>
      )}

      {/* The shows that could come next (lib/show-ideas.ts): one quiet line, the demand test's way in from the front door. */}
      {showIdeasOn() && (creator || !open) && (
        <p className="house-link home-shows-link">
          <span aria-hidden="true">📺</span> One show is on air. More could come next: a mystery, a shared house, a quest.{" "}
          <Link href="/shows" data-track="shows" data-track-where="home">
            Say which you&apos;d want →
          </Link>
        </p>
      )}

      {!creator && (
      <section className="home-how">
        <h2>{t("How it works")}</h2>
        <ol className="features home-features">
          {STEPS.map((f) => (
            <li className="feature card" key={f.title}>
              <span className="feature-icon" aria-hidden="true">
                <Icon name={f.icon} />
              </span>
              <div>
                <h3>{t(f.title)}</h3>
                <p className="muted">{t(f.body)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      )}

      {/* The cast, the map and the tools are an owner's (and the old page's): a first visit's page ends on its questions. */}
      {(creator || !open) && (
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
          {sky && sky.couples > 0 && ` · ${sky.characters} characters, ${sky.couples} couples`}
        </p>
        <p className="muted small home-sky-line">
          Free tools: <Link href="/tools/random-oc-generator">a random OC generator</Link> ·{" "}
          <Link href="/tools/oc-chemistry-test">a ship compatibility test</Link> ·{" "}
          <Link href="/tools/ship-name-generator">a ship name generator</Link> ·{" "}
          <Link href="/tools/oc-name-generator">an OC name generator</Link> ·{" "}
          <Link href="/tools/place-name-generator">a place name generator</Link> ·{" "}
          <Link href="/tools/relationship-trope-generator">a relationship trope generator</Link> ·{" "}
          <Link href="/tools/oc-questions">questions to ask your OC</Link>
        </p>
      </section>
      )}

      {!creator && (
      <section className="faq">
        <h2>{t("Questions")}</h2>
        {/* The three a first visit asks; the rest are on /faq (the audit, 2026-11-11, 2.1: eight rows repeated that page). */}
        {homeFaq(t).map((item) => (
          <details className="card ux-fold" key={item.q}>
            <summary>{item.q}</summary>
            <p className="muted">{item.a}</p>
          </details>
        ))}
        <p className="faq-more">
          <Link href="/faq">{t("More questions")} →</Link>
        </p>
      </section>
      )}

      {!creator && (
        <p className="cta-row cta-final">
          <Link className="button" href="/create">
            {t("Make your character")}
          </Link>
        </p>
      )}

      {/* Below the fold of a first visit's one screen (which keeps its one job): the free tools, the way in from another
          app, the seasons, Step in and the bots' reviews, the landings search hadn't fetched (2026-11-22 audit: the home
          page linked none of them for a first visit). An owner's page has its own lines for these in the cast section above. */}
      {!creator && open && (
        <nav className="home-more-links" aria-label={t("More of Botchelor")}>
          <p className="muted small home-sky-line">
            {t("Free tools:")}{" "}
            {FREE_TOOLS.map((tool, i) => (
              <Fragment key={tool.path}>
                {i > 0 && " · "}
                <Link href={tool.path}>{t(tool.name)}</Link>
              </Fragment>
            ))}
          </p>
          <p className="muted small home-sky-line">
            {t("Coming from another app?")}{" "}
            {ALTERNATIVES.map((a, i) => (
              <Fragment key={a.slug}>
                {i > 0 && " · "}
                <Link href={alternativePath(a.slug)}>{a.name}</Link>
              </Fragment>
            ))}
            {" · "}
            <Link href="/import">{t("import your character")}</Link>
          </p>
          <p className="muted small home-sky-line">
            {t("The show:")} <Link href="/seasons">{t("every season so far")}</Link> · <Link href="/casting">{t("casting for next month")}</Link>
            {stepInOpen() && (
              <>
                {" · "}
                <Link href="/step-in">{t("step into a date yourself")}</Link>
              </>
            )}
            {" · "}
            <Link href="/reviews">{t("what the bots say about it")}</Link>
          </p>
        </nav>
      )}

      {/* LaunchNest's and Toolradar's listings check the home page for their badges (their embed code, as given). Only
          here, not on every page: they're third-party images, so each load tells the directory about the visit. Lazy, so
          only a visit that scrolls down to them asks for them, and the privacy notice says so (Analytics; the 2026-11-22
          audit). Toolradar's is its wide dark badge, drawn at LaunchNest's height. */}
      <p className="home-badges">
        <a href="https://launchnest.io/p/botchelor" target="_blank" rel="noopener">
          {/* eslint-disable-next-line @next/next/no-img-element -- third-party badge, served by LaunchNest */}
          <img src="https://launchnest.io/badge/botchelor.svg?variant=featured" alt="Botchelor on LaunchNest" width="220" height="56" loading="lazy" />
        </a>
        <a href="https://toolradar.com/tools/botchelor" target="_blank" rel="noopener">
          {/* eslint-disable-next-line @next/next/no-img-element -- third-party badge, served by Toolradar */}
          <img
            src="https://toolradar.com/api/badge/botchelor?type=category-rank&category=media-entertainment&style=dark&shape=wide&v=5"
            alt="Botchelor on Toolradar"
            width="196"
            height="56"
            loading="lazy"
          />
        </a>
      </p>
    </div>
  );
}
