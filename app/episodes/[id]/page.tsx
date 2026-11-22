import type { Metadata } from "next";
import StoryButton from "@/app/StoryButton";
import { canMakeStory, storyFor } from "@/lib/stories";
import { STORY_TOKENS, storyPrice as storyPriceFor } from "@/lib/writing-style";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "@/app/JsonLd";
import { breadcrumbJsonLd, dateAuthored } from "@/lib/seo";
import { ENDING_CARD, endingCardAllowed, episodeCardPath, pageTitle, SHARE_QUESTION, shareDescription, shareTitle, wentWellTitle } from "@/lib/episode-share";
import EpisodeNotices from "@/app/Notices";
import { siteUrl } from "@/lib/site";
import { reportCardPath } from "@/lib/report-card";
import { getDb } from "@/lib/db";
import { dateListed } from "@/lib/public-cast";
import { viewerBridge } from "@/lib/adult/bridge-viewer";
import { viewerContinue } from "@/lib/adult/overnight";
import { isOvernight } from "@/lib/overnight";
import { OVERNIGHT_COPY, overnightClose, overnightDatesOn, overnightEndingLabel } from "@/lib/overnight-shared";
import { adultViewerFromCookies } from "@/lib/adult/mode";
import { ADULT_COOKIE } from "@/lib/age";
import { afterDarkHref } from "@/lib/after-dark-host";
import { dareReveal, VERDICT_WORDS } from "@/lib/dares";
import { callRecord, NO_CALLS } from "@/lib/streaks";
import ShareRecord from "@/app/ShareRecord";
import { shareOf } from "@/app/YourCalls";
import { sharerOf } from "@/lib/share-record-name";
import { getEpisodeView, getPoints } from "@/lib/game";
import { episodeClip, episodeCut } from "@/lib/home-clip";
import { coldOpenOf, coldOpenOn } from "@/lib/cold-open";
import { partyIdForEpisode } from "@/lib/watch";
import { PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { authFromCookieStore, userIdFromCookieStore } from "@/lib/http";
import { chatDateLinks, companionAllowed, companionEligible, companionOpen, companionThreadHref } from "@/lib/companion";
import { textsAboutDate, type TextedAbout } from "@/lib/chat-date-links";
import TalkButton from "@/app/companion/TalkButton";
import { companionGuestFromCookies } from "@/lib/companion-access";
import { secondDateState } from "@/lib/second-date";
import { siblingEpisode } from "@/lib/group-dates";
import { mixerNightOf } from "@/lib/mixer-night";
import { getDealbreakerQuiz, getSurprise } from "@/lib/mechanics";
import { getProfileName } from "@/lib/people";
import { seasonRef } from "@/lib/season-ref";
import { seasonIdOf } from "@/lib/season-window";
import { CONVERSATION_TURNS, DATE_ACTS, dateLabel, dateNumberOf, DRAMA_QUESTION_LABELS, dramaAnswerLabel, endingLabel, endingWithDetail, HIDDEN_EPISODE_MESSAGE } from "@/lib/rules";
import { DEFAULT_FORMAT, format as showFormat, formatLabel } from "@/lib/formats";
import { venuePhrase, venueBackdropCss, venueName } from "@/lib/venues";
import { episodeCode, templateEpisodeTitle } from "@/lib/episode-title";
import { previouslyOn } from "@/lib/previously-on";
import { venueBackdrop } from "@/lib/portraits";
import { showSetBackground, showSetPath, type ShowSet } from "@/lib/show-sets";
import Avatar from "@/app/Avatar";
import RememberCharacter from "@/app/RememberCharacter";
import CharacterName from "@/app/CharacterName";
import Afterglow, { SecondDate } from "./Afterglow";
import EndingSeen from "./EndingSeen";
import EpisodeTheater, { type TheaterVerdict } from "./EpisodeTheater";
import ShareEnding from "./ShareEnding";
import BoxScore from "./BoxScore";
import DiaryCam from "./DiaryCam";
import ConfessionalShare from "./ConfessionalShare";
import CreatorReveal from "./CreatorReveal";
import DealbreakerQuiz from "./DealbreakerQuiz";
import EpisodeActions from "./EpisodeActions";
import DatePhotos from "./DatePhotos";
import { DATE_PHOTO_STYLES, datePhotoState } from "@/lib/studio/date-photos";
import RecapToggle from "./RecapToggle";
import TranscriptRead from "./TranscriptRead";
import { airIfDue, airWindowMinutes } from "@/lib/air";
import { endingsLately } from "@/lib/endings-lately";
import SafetyActions from "./SafetyActions";
import SlidingDoors from "./SlidingDoors";
import WatchPartyLaunch from "./WatchPartyLaunch";
import GeneratingPoller from "./GeneratingPoller";
import PushToggle from "@/app/notifications/PushToggle";
import { pushKeys } from "@/lib/push";
import { withoutLeadName } from "./lead-name";
import UpNext from "./UpNext";
import { upNextFor, type UpNextEpisode } from "@/lib/up-next";

export const dynamic = "force-dynamic";

const PREMIUM_IDS = new Set(PREMIUM_HOUSE_CHARACTERS.map((c) => c.id));

/**
 * Each episode gets its own title and summary for search and link previews, from the public view only (no
 * spoilers: the setting is the teaser). Only public, unhidden episodes are indexable; unlisted, private and
 * hidden ones tell crawlers to stay out, as does one with a deleted account's character (lib/public-cast.ts). A public
 * date between two machine-made characters stays linked but says noindex (lib/seo.ts authoredDateSql, as the sitemap).
 *
 * The link preview is the share card (/api/og/episode/<id>): a "How does it end?" poll, as a large Twitter card.
 * Setting openGraph.images here is what puts it ahead of ./opengraph-image (the box score card, still served).
 */
export async function generateMetadata({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const { id } = await params;
  const db = await getDb();
  const [episode, clip, listed, authored] = await Promise.all([
    getEpisodeView(db, id, null),
    episodeClip(db, id).catch(() => null),
    dateListed(db, id).catch(() => true),
    dateAuthored(db, id).catch(() => true),
  ]);
  if (!episode || episode.hidden) return { title: "Episode · Botchelor", robots: { index: false, follow: false } };
  const [a, b] = episode.characters;
  const names: [string, string] = [a.name, b.name];
  const indexable = episode.visibility === "public" && listed && authored;
  // Public but between two machine-made characters: out of search, its links still followed.
  const thin = episode.visibility === "public" && listed && !authored;
  // An owner's share of a date that went well (lib/episode-share.ts ownerSharedPath, David 2026-11-11): the card and the
  // headline name the second date, only once aired and only for that ending; any other date keeps the question.
  const wentWell = (await searchParams)?.card === ENDING_CARD && endingCardAllowed(episode);
  const dateNo = wentWell ? dateNumberOf(episode) : null;
  const description = wentWell ? `${wentWellTitle(names, dateNo)} Watch how it happened, then send a character of your own.` : shareDescription(names, episode.setting, episode.revealed);
  const card = wentWell
    ? { url: `${episodeCardPath(id)}?card=${ENDING_CARD}`, width: 1200, height: 630, alt: wentWellTitle(names, dateNo) }
    : { url: episodeCardPath(id), width: 1200, height: 630, alt: `${a.name} × ${b.name}: ${SHARE_QUESTION} A poll with three answers.` };
  const headline = wentWell ? wentWellTitle(names, dateNo) : shareTitle(names);
  // The place in words ("the night market"), never its id (2026-10-23: titles read "at night_market").
  const venue = typeof episode.venue === "string" ? venuePhrase(episode.venue) : null;
  return {
    // #SEO: richer long-tail title (name × name + venue) in the HTML <title>; social cards keep the "How does it end?"
    // headline. Never includes the ending — a Google snippet shouldn't spoil what visitors can predict for points.
    title: pageTitle(names, venue),
    description,
    alternates: { canonical: `/episodes/${id}` },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: thin },
    // The root layout's openGraph and twitter are replaced, not merged, so the site's own fields are repeated here.
    // A date with a clip of its own (lib/home-clip.ts episodeClip) unfurls as a playable video where the app plays
    // og:video (Discord, Facebook); the card picture stays for everything else, X included.
    openGraph: {
      type: "website",
      siteName: "Botchelor",
      locale: "en_US",
      url: `/episodes/${id}`,
      title: headline,
      description,
      images: [card],
      ...(clip ? { videos: [{ url: clip.loop_src, type: "video/mp4", width: clip.width, height: clip.height }] } : {}),
    },
    twitter: { card: "summary_large_image", title: headline, description, images: [{ url: card.url, alt: card.alt }] },
  };
}

/** The way in for anyone who isn't one of this date's creators, most often someone who followed a shared link. */
function MakeYourOwn() {
  return (
    <section className="make-your-own card">
      <div>
        <h2>Send your own character on a date</h2>
        <p className="muted">Make an original character in a few minutes and the show writes their blind date. Free to start, no sign-up.</p>
      </div>
      <Link className="button" href="/create">
        Make your character
      </Link>
    </section>
  );
}

type HeroCharacter = { id: string; name: string; hue: number | null; house: boolean; portrait: string | null; agent?: boolean; private?: boolean };

/**
 * The top of an episode (David, 2026-10-21: "expand the setting image so it's like a hero background… entice people
 * who want to watch"): the venue's photo behind the pair, the setting as the teaser, and the way to watch. The venue's
 * own gradient stands in where there's no reviewed photo. Never the ending: that's for the theater.
 */
function EpisodeHero({
  characters,
  venue,
  setting,
  chips,
  code,
  title,
  set = null,
  children,
}: {
  characters: [HeroCharacter, HeroCharacter];
  venue: string | null;
  setting: string | null;
  chips: (string | null | false | undefined)[];
  /** "S1 · Night 18" once it has aired (lib/episode-title.ts episodeCode). */
  code?: string | null;
  /** The episode's own title, quoted on the card ("The Fountain Incident"). */
  title?: string | null;
  /** One of the show's sets in place of the venue's photo (lib/show-sets.ts): the blind-date booth while it's being filmed. */
  set?: ShowSet | null;
  children?: React.ReactNode;
}) {
  const [a, b] = characters;
  const photo = set ? showSetPath(set) : venue ? venueBackdrop(venue) : null;
  const background = [
    // Dark at the bottom, where the words sit, so they read on any photo.
    "linear-gradient(180deg, rgba(14,8,20,0.20) 0%, rgba(14,8,20,0.55) 45%, rgba(14,8,20,0.92) 100%)",
    photo ? `url(${photo})` : null,
    venue ? venueBackdropCss(venue) : "linear-gradient(135deg, #3a1630, #1d1030)",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <header className={`episode-hero${photo ? "" : " no-photo"}`} style={{ backgroundImage: background }}>
      {/* The theater's camera on the venue: a slow push-in on the same picture (pass 2 of the visual pop audit). */}
      <span className="episode-hero-art" aria-hidden="true" style={{ backgroundImage: background }} />
      <div className="episode-hero-inner">
        <p className="episode-hero-kicker">
          <span>Botchelor</span>
          {code && <span>{code}</span>}
          {/* The venue names the card only until there's a title: with one, the title and the setting carry the place. */}
          {venue && !title && <span>{venueName(venue)}</span>}
        </p>
        <div className="episode-hero-cast" aria-hidden="true">
          <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={84} />
          <span className="episode-hero-x">×</span>
          <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={84} />
        </div>
        <h1>
          {/* The × stays with the first name, so a two-line title never starts with it or leaves it alone. */}
          <span className="nowrap">
            <CharacterName character={a} avatar={false} /> <span className="episode-hero-x">×</span>
          </span>{" "}
          <CharacterName character={b} avatar={false} />
        </h1>
        {title && <p className="episode-hero-title">“{title}”</p>}
        {setting && <p className="episode-hero-setting">{setting}</p>}
        {children}
        <ul className="episode-hero-chips" aria-label="About this episode">
          {chips.filter(Boolean).map((c) => (
            <li key={String(c)}>{c}</li>
          ))}
        </ul>
      </div>
    </header>
  );
}

export default async function EpisodePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ play?: string; from?: string }>;
}) {
  const { id } = await params;
  // `?play=1`: the date opens in the theater and plays: for its creator, the date they just sent (on the filming stage
  // while it's written); for anyone else, an aired date from a link that says "watch it" (home, /watch, the gate).
  // `&from=N`: the creator watched N lines live while it was filmed, so the playback carries on from there.
  const query = await searchParams;
  const play = query.play === "1";
  const from = Math.max(0, Math.floor(Number(query.from) || 0));
  const viewerId = userIdFromCookieStore(await cookies());
  const db = await getDb();
  // Dates air by default once their prediction window closes (lib/air.ts): opening one that's due airs it.
  await airIfDue(db, id).catch(() => null);
  const episode = await getEpisodeView(db, id, viewerId);
  // Hidden after reports: a 404 for everyone except its creators (see app/episodes/not-found.tsx).
  if (!episode || (episode.hidden && !episode.is_creator)) notFound();
  const cookieStore = await cookies();
  // Everything below starts at once (2026-11-04 performance audit: one after another, the owner's date page waited on
  // 25 database round trips in a row, ~70 ms each from New York to the database in Oregon).
  const ready = episode.status === "ready";
  // After an aired date: talk with either of them one to one (lib/companion.ts), where companions are open to the
  // viewer and the character is one they may talk with. Signed out, the same characters get a sign-in link.
  const auth = authFromCookieStore(cookieStore);
  // The date told as a story (lib/stories.ts): one that exists reads free for everyone who gets the lines; making it is
  // for the date's own people, the Companion Plan's members and admins (included with the plan, else a bought date).
  // Started now and read after the page's other reads, so it adds no round trip of its own.
  const storyState = storyFor(db, "episode", id, null)
    .catch(() => null)
    .then(async (kept) => {
      if (kept) return { open: true, kept, price: undefined as string | undefined };
      const can = await canMakeStory(db, viewerId, episode.is_creator);
      return { open: can, kept: null, price: can ? ((await storyPriceFor(db, viewerId ?? "")) ? `${STORY_TOKENS} bought date` : "included") : undefined };
    });
  const talkP: Promise<{ id: string; name: string; signIn: boolean }[]> =
    ready && episode.revealed
      ? (async () => {
          const signedIn = Boolean(auth?.authenticated);
          if (signedIn ? !(await companionAllowed(db, auth)) : !companionOpen()) return [];
          // Without an account: a guest tries a few replies first (lib/companion-access.ts), else a sign-in link.
          const guest = companionGuestFromCookies(auth, cookieStore);
          const out: { id: string; name: string; signIn: boolean }[] = [];
          for (const c of episode.characters) {
            if (await companionEligible(db, auth?.userId ?? "", c.id)) out.push({ id: c.id, name: c.name, signIn: !signedIn && !guest });
          }
          return out;
        })().catch(() => [])
      : Promise.resolve([]);
  const [
    afterDarkLink,
    airsAt,
    lately,
    points,
    profileName,
    quiz,
    surprise,
    secondDate,
    datePhotos,
    partyId,
    dare,
    myShare,
    performerRows,
    sibling,
    mixerTable,
    prev,
    creatorSide,
    adBridge,
    overnight,
    continueNight,
    textedAbout,
    cut,
    upNext,
  ] = await Promise.all([
    // 🌙 on a date that carried an After Dark memory, only for someone After Dark is open to (never a hint to anyone else).
    episode.after_dark
      ? adultViewerFromCookies(db, cookieStore).then((ok) => (ok ? afterDarkHref(`/after-dark/${[episode.characters[0].id, episode.characters[1].id].sort().join("/")}`) : null))
      : null,
    // When an unaired date airs on its own (its booking plus the prediction window), for the host's controls.
    !episode.revealed && episode.is_host
      ? db
          .query<{ at: Date | string }>(`select coalesce(air_after, created_at + $2 * interval '1 minute') as at from episodes where id = $1`, [id, airWindowMinutes()])
          .then((r) => (r.rows[0] ? new Date(r.rows[0].at).toISOString() : null))
          .catch(() => null)
      : null,
    // #728: how recent aired public dates ended, beside the prediction form, so a pick isn't blind (never this date's ending).
    !episode.revealed && !episode.is_creator ? endingsLately(db).then((l) => (l.of ? l.says : null)).catch(() => null) : null,
    viewerId ? getPoints(db, viewerId) : 0,
    episode.is_creator ? getProfileName(db, viewerId) : null,
    // The $0 mechanics: spectators get the dealbreaker quiz; the owner (host) sees the surprise reveal.
    !episode.is_creator ? getDealbreakerQuiz(db, id, viewerId) : null,
    episode.is_creator ? getSurprise(db, id, viewerId) : null,
    // Their second date, when both characters want one (lib/second-date.ts): owners only.
    episode.is_creator && viewerId ? secondDateState(db, id, viewerId) : null,
    // 📸 Date photos, for the owner of one of the two (lib/studio/date-photos.ts; null for anyone else).
    viewerId ? datePhotoState(db, viewerId, id).catch(() => null) : null,
    partyIdForEpisode(db, id),
    // The dare reveal (lib/dares.ts): the audience's dare and the engine's own verdict, once the date has aired.
    episode.revealed ? dareReveal(db, id).catch(() => null) : null,
    // A scored call: the viewer's record, for the spoiler-free share card (lib/share-record.ts).
    episode.revealed && !episode.is_creator && episode.my_pick && viewerId
      ? Promise.all([callRecord(db, viewerId).catch(() => NO_CALLS), sharerOf(db, viewerId).catch(() => null)]).then(([record, sharer]) => shareOf(record, new Date(), sharer))
      : null,
    // Performed by its creator's own AI (an agent dating two of its own characters, lib/own-date.ts)?
    // Who performed the lines (docs/agents-and-people.md): the show's model, one agent's AI, or each character's own agent.
    db.query<{ performed_by: string; two_agent: boolean; step_in: boolean }>(
      `select performed_by, partner_performer is not null as two_agent, coalesce(setup->>'met_via' = 'step_in', false) as step_in from episodes where id = $1`,
      [id],
    ),
    // A double date (lib/group-dates.ts): the other couple's episode of the same night, when both tables aired publicly.
    ready ? siblingEpisode(db, episode.id).catch(() => null) : null,
    // A mixer's table (lib/mixer-night.ts): its round, and the way back to the whole room's night (never on a double date).
    ready ? mixerNightOf(db, episode.id).catch(() => null) : null,
    // The cold open, for a pair with history: their last aired date, told in one line (lib/previously-on.ts).
    ready && (dateNumberOf(episode) ?? 0) > 1 ? previouslyOn(db, episode.id).catch(() => null) : null,
    // The creator's own side: which one is theirs (the header's face follows it, below) and, arriving from sending the
    // date (?play=1), that side's reflection (the preview of the first text on the verdict card, VerdictCard.tsx) and
    // whether this is that character's first date.
    episode.is_creator && viewerId
      ? db
          .query<{ side: 0 | 1 | null; reflection: string | null; dates: number }>(
            `select case when a.owner_id = $2 then 0 when b.owner_id = $2 then 1 end as side,
                    case when a.owner_id = $2 then e.reflections->>'a' when b.owner_id = $2 then e.reflections->>'b' end as reflection,
                    coalesce((select count(*)::int from episodes x where x.character_a = m.id or x.character_b = m.id), 0) as dates
               from episodes e
               join characters a on a.id = e.character_a
               join characters b on b.id = e.character_b
               left join characters m on m.id = case when a.owner_id = $2 then a.id when b.owner_id = $2 then b.id end
              where e.id = $1`,
            [id, viewerId],
          )
          .then((r) => r.rows[0] ?? null)
          .catch(() => null)
      : null,
    // The After Dark bridge (lib/adult/bridge.ts): one line on the creator's verdict card when the date ended in a
    // second date. Asked only for the creator arriving at their own date, and only once they've said they're 18+.
    play && episode.is_creator
      ? headers()
          .then((h) => viewerBridge(db, auth, h, cookieStore.get(ADULT_COOKIE)?.value === "1"))
          .catch(() => null)
      : null,
    // An overnight date (lib/overnight.ts): its ending is told as leaving together, from templates. Off, it reads as any date.
    overnightDatesOn() ? isOvernight(db, id).catch(() => false) : false,
    // "Continue the night in After Dark" (lib/adult/overnight.ts): only for a viewer After Dark already admits who owns
    // one of the two, on an overnight date that aired and ended in leaving together. Asked only of a signed-in owner
    // who has said they're 18+; null for everyone else, who sees nothing new.
    ready && episode.revealed && episode.is_creator && auth?.authenticated
      ? headers()
          .then((h) => viewerContinue(db, auth, h, cookieStore, cookieStore.get(ADULT_COOKIE)?.value === "1", id))
          .catch(() => null)
      : null,
    // "{Name} texted you about this" (lib/chat-date-links.ts): the viewer's own threads whose character texted them
    // about this date. Asked only for an owner of one of the two; nobody else is ever shown it. CHAT_DATE_LINKS=0: never.
    ready && episode.is_creator && viewerId && chatDateLinks() ? textsAboutDate(db, viewerId, id).catch((): TextedAbout[] => []) : ([] as TextedAbout[]),
    // The date's short version (lib/home-clip.ts episodeCut): the voiced cut of an aired public date, when one was made.
    ready && episode.revealed ? episodeCut(db, episode.id).catch(() => null) : null,
    // "Up next" (lib/up-next.ts, the 2026-11-22 audit): the couple's next date, then the newest others, in one cheap read.
    ready ? upNextFor(db, episode.id, viewerId).catch((): UpNextEpisode[] => []) : ([] as UpNextEpisode[]),
  ]);
  const { open: storyOpen, kept: keptStory, price: storyPrice } = await storyState.catch(() => ({ open: false, kept: null, price: undefined }));
  const talk = await talkP;
  const performer = performerRows.rows[0];
  const mixer = sibling ? null : mixerTable;
  // Step into the date (lib/step-in.ts): a person played one side live, the show's model the cast member's.
  const steppedIn = performer?.step_in === true;
  const selfPerformed = performer?.performed_by === "agent" && !steppedIn;
  const twoAgent = selfPerformed && performer?.two_agent === true;
  const [a, b] = episode.characters;
  const names: [string, string] = [a.name, b.name];
  const nameOf = (characterId: string) => episode.characters.find((c) => c.id === characterId)?.name;
  // A speaker's face and name, for the agendas and confessionals (the name alone beside a confessional shot).
  const who = (id: string, avatar = true) => {
    const c = episode.characters.find((x) => x.id === id);
    return c ? <CharacterName character={c} strong avatar={avatar} /> : null;
  };
  // Their confessional shot (lib/show-shots.ts): waist-up in the confessional's armchair, once it's drawn.
  const confessionalShot = (id: string) => episode.characters.find((x) => x.id === id)?.shots?.confessional ?? null;
  // A creator of a house date has nobody to block; everyone else blocks "whoever made this".
  const canBlock = !episode.is_creator || episode.characters.every((c) => !c.house);
  // The header's face follows the creator's own character in this date (app/RememberCharacter.tsx; 2026-11-22 audit: it
  // showed another of theirs while they watched this one's date).
  const mine = creatorSide && creatorSide.side !== null ? episode.characters[creatorSide.side]?.id ?? null : null;
  const remember = mine ? <RememberCharacter id={mine} /> : null;

  // M10: the date is generated in the background. Until it's ready, show a waiting state that polls.
  if (episode.status !== "ready") {
    return (
      <article className="episode-page">
        {remember}
        <EpisodeHero characters={episode.characters} venue={episode.venue ?? null} setting={null} set="booth" chips={["🎬 Being filmed", "AI-generated"]}>
          {!episode.is_creator && (
            <div className="episode-hero-cta">
              <Link className="episode-hero-link" href="/create">
                Make your own character
              </Link>
            </div>
          )}
        </EpisodeHero>
        <div className="episode-body">
          {steppedIn && (
            <p className="muted">
              {episode.is_creator ? (
                <>
                  🎬 You&apos;re on this date. <Link href={`/step-in/${episode.id}`}>Back to it</Link>
                </>
              ) : (
                "🎬 A viewer stepped into this date and is playing it live. The ending is already decided."
              )}
            </p>
          )}
          {selfPerformed && (
            <p className="muted">
              {twoAgent
                ? "🎭 Each character's own agent is performing this date on its own AI, taking turns. The ending is already decided."
                : "🎭 Its creator's own AI is performing this date, one line at a time. The ending is already decided."}
            </p>
          )}
          <GeneratingPoller
            episodeId={episode.id}
            characters={episode.characters}
            // About how long it runs (the format's length): the wait says "4 of about 12 lines filmed".
            totalLines={showFormat(episode.format ?? DEFAULT_FORMAT).turns ?? CONVERSATION_TURNS}
            creator={episode.is_creator}
            pushKey={pushKeys()?.publicKey ?? null}
            stage={
              play && episode.is_creator
                ? {
                    characters: episode.characters,
                    venue: episode.venue ?? null,
                    canSetScene: !selfPerformed && !steppedIn,
                    // The early verdict (GeneratingPoller.tsx): the card the theater would show, as soon as the ending stands.
                    // No reflection yet (it's written after the ending), so the card says the character will text them.
                    dateNumber: dateNumberOf(episode),
                    overnight,
                    verdict: creatorSide && creatorSide.side !== null ? { mine: creatorSide.side, reflection: null, pushKey: pushKeys()?.publicKey ?? null, afterDark: adBridge } : null,
                  }
                : undefined
            }
          />
          {!episode.is_creator && <MakeYourOwn />}
          <footer className="episode-foot">
            <p>
              <Link href="/watch">More episodes</Link>
            </p>
            {/* The site footer, straight below, carries the crisis links. */}
            <EpisodeNotices crisis={false} />
          </footer>
        </div>
      </article>
    );
  }

  const base = siteUrl();
  const push = pushKeys();
  // The theater can play it (the ending is known and there are lines), so the written recap folds behind a toggle.
  const hasTheater = Boolean(episode.ending && episode.transcript && episode.transcript.length > 0);
  // The verdict card at the end of the creator's just-filmed date (VerdictCard.tsx): their character, its reflection, push.
  const verdict: TheaterVerdict | null =
    play && episode.is_creator && creatorSide && creatorSide.side !== null
      ? {
          mine: creatorSide.side,
          reflection: creatorSide.reflection?.trim() || null,
          pushKey: push?.publicKey ?? null,
          // Only when their date ended in a second date (the live stage checks the ending itself).
          afterDark: episode.ending === "second_date" ? adBridge : null,
        }
      : null;
  // The date's report card (lib/report-card.ts): only once it has aired, and never for a date only its creator sees.
  const reportCard = episode.revealed && episode.box_score && episode.visibility !== "private" && !episode.hidden ? reportCardPath(episode.id) : null;
  // A creator's first date, just filmed: the page under the theater stays clear of the games (the card is the next step).
  const firstDateJustFilmed = play && episode.is_creator && (creatorSide?.dates ?? 0) <= 1;
  // What comes next, at the foot of the date and on the theater's ending; not on a first date just filmed, whose next
  // step is the verdict card (its character texting them).
  const next = firstDateJustFilmed ? [] : upNext;
  // Which date this is for the couple: a happy ending on their third date reads "A fourth date", never "A second date".
  const dateNo = dateNumberOf(episode);
  // Which monthly season the date aired in (lib/season-ref.ts), for the TVEpisode markup; none before the seasons began.
  const season = episode.aired_at ? (({ number, label, path }) => (number > 0 ? { number, label, path } : null))(seasonRef(seasonIdOf(new Date(episode.aired_at)))) : null;
  const squash = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  // The title card (docs/show-style.md): the episode's code and title once it airs. Older aired episodes have no
  // stored title, so the $0 template stands in; an unaired episode shows none (the setting is the tease).
  const code = episodeCode(episode.aired_at);
  const displayTitle = episode.title ?? (episode.revealed ? templateEpisodeTitle({ venue: episode.venue ?? null, dateNumber: dateNo ?? null }) : null);
  // How the ending is told: an overnight date that ended in another date fades to black on them leaving together
  // (lib/overnight-shared.ts, templates); any other date, and any other ending, keeps its own label.
  const endingUsual = episode.ending ? endingWithDetail(episode.ending, dateNo, episode.ending_detail) : "";
  const endingTold = overnight ? overnightEndingLabel(episode.ending, endingUsual) : endingUsual;
  // The cold open (lib/cold-open.ts): who they are, what each wants and what's at stake, before the theater's first line.
  // Only what the page already shows before the read, so it spoils nothing; the theater decides who sees it.
  const coldOpen =
    hasTheater && coldOpenOn()
      ? coldOpenOf({
          characters: episode.characters,
          goals: episode.goals,
          dateNumber: dateNo ?? null,
          venue: typeof episode.venue === "string" ? venuePhrase(episode.venue) : null,
          format: episode.format ? formatLabel(episode.format) : null,
          roleplay: episode.roleplay ? { icon: episode.roleplay.icon, title: episode.roleplay.title } : null,
          setting: episode.setting,
          previously: prev?.line ?? null,
        })
      : null;
  const lastAct = episode.scenes?.length ? episode.scenes.length - 1 : -1;
  const finaleRepeats =
    lastAct >= 0 && Boolean(episode.finale) && squash(withoutActLabel(episode.scenes![lastAct], DATE_ACTS[lastAct])) === squash(episode.finale);
  return (
    <article className="episode-page">
      {remember}
      {episode.visibility === "public" && !episode.hidden && (
        <JsonLd
          data={[{
            "@context": "https://schema.org",
            // A TVEpisode too (2026-11-11 growth plan): a date is an episode of a show with seasons; no VideoObject,
            // since there is no video file to point at.
            "@type": ["CreativeWork", "TVEpisode"],
            partOfSeries: { "@type": "TVSeries", name: "Botchelor", url: `${base}/watch` },
            ...(season ? { partOfSeason: { "@type": "TVSeason", name: season.label, seasonNumber: season.number, url: `${base}${season.path}` } } : {}),
            ...(episode.aired_at ? { datePublished: episode.aired_at } : {}),
            name: `${a.name} × ${b.name}`,
            headline: `${a.name} × ${b.name}: an AI blind date`,
            description: episode.setting,
            url: `${base}/episodes/${episode.id}`,
            genre: ["Comedy", "Reality", "Interactive fiction"],
            inLanguage: "en",
            isAccessibleForFree: true,
            creditText: "Written by an AI model; the outcome is decided by a deterministic engine.",
            character: episode.characters.map((c) => ({ "@type": "Person", name: c.name, url: `${base}/characters/${c.id}` })),
            image: `${base}/episodes/${episode.id}/opengraph-image`,
            isPartOf: { "@id": `${base}/#website` },
            publisher: { "@type": "Organization", "@id": `${base}/#org`, name: "Botchelor", url: base, logo: `${base}/icon.svg` },
          }, breadcrumbJsonLd([
            { name: "Botchelor", path: "/" },
            { name: "Watch", path: "/watch" },
            { name: `${a.name} × ${b.name}`, path: `/episodes/${episode.id}` },
          ])]}
        />
      )}
      <EpisodeHero
        characters={episode.characters}
        venue={episode.venue ?? null}
        setting={episode.setting}
        code={code}
        title={displayTitle}
        chips={[
          "AI-generated",
          episode.followup_of ? dateLabel(episode.date_number ?? 2) : null,
          overnight ? OVERNIGHT_COPY.chip : null,
          episode.format ? formatLabel(episode.format) : null,
          episode.roleplay ? `${episode.roleplay.icon} Roleplay: ${episode.roleplay.title}` : null,
          a.house && b.house ? "House cast" : a.house || b.house ? "With a house character" : null,
          a.agent || b.agent ? "🤖 Made by an AI agent" : null,
          sibling ? "💞💞 A double date" : null,
          mixer ? `🍸 Speed-dating night · date ${mixer.round} of ${mixer.rounds}` : null,
          selfPerformed ? (twoAgent ? "🎭 Performed by both characters' agents" : "🎭 Performed by its creator's AI") : null,
          steppedIn ? "🎬 A viewer stepped in" : null,
        ]}
      >
        <div className="episode-hero-cta">
          {hasTheater && episode.ending && episode.transcript ? (
            <EpisodeTheater
              episodeId={episode.id}
              characters={episode.characters}
              venue={episode.venue ?? null}
              transcript={episode.transcript}
              endingLabel={endingTold}
              autoOpen={play}
              justFilmed={play && episode.is_creator}
              startAt={play && episode.is_creator ? from : 0}
              roleplay={episode.roleplay ?? null}
              verdict={verdict}
              coldOpen={coldOpen}
              cut={cut ? { src: cut.src, poster_src: cut.poster_src, seconds: cut.seconds } : null}
              reportCard={reportCard}
              upNext={next[0] ? { href: `${next[0].share_path}?play=1`, characters: next[0].characters } : null}
            />
          ) : (
            episode.transcript &&
            episode.transcript.length > 0 && (
              <a className="button" href="#the-date">
                Read the date
              </a>
            )
          )}
          {!episode.revealed && !episode.is_creator && (
            <a className="button-ghost" href="#predict">
              Call the ending
            </a>
          )}
          {!episode.is_creator && (
            <Link className="episode-hero-link" href="/create">
              Make your own character
            </Link>
          )}
        </div>
      </EpisodeHero>

      {/* Two columns on a wide screen, as the design system draws the episode page (all-screens board, 2026-11-11): the
          date on the left; on the right, the rail with what came before and what comes after. One column on a phone. */}
      <div className="episode-body episode-layout">
        <div className="episode-main">
        {/* J1: a finished date whose lines didn't (all) come out says so, instead of quietly turning into a prose recap. */}
        {episode.transcript_note && <p className="notice episode-transcript-note">{episode.transcript_note}</p>}
        {episode.roleplay && (
          // A roleplay both sides agreed to (lib/date-roleplays.ts): billing, like the format, shown from the start.
          <p className="notice episode-roleplay">
            {episode.roleplay.icon} <strong>Tonight&apos;s roleplay: {episode.roleplay.title}.</strong> {episode.roleplay.premise}
            {episode.roleplay.roles && <span className="muted small"> {episode.roleplay.roles}.</span>}
          </p>
        )}
        {sibling && (
          <p className="muted">
            💞💞 A double date: {sibling.names.join(" and ")} shared the table —{" "}
            <Link href={`/episodes/${sibling.episode_id}`}>their date</Link> is its own episode.
          </p>
        )}
        {mixer && (
          <p className="muted">
            🍸 Round {mixer.round} of {mixer.rounds} at the mixer at {venuePhrase(mixer.venue)}: everyone was in one room.{" "}
            <Link href={`/mixers/${mixer.night_id}`}>Watch the whole night</Link>, every table in order.
          </p>
        )}
        {textedAbout.length > 0 && (
          // Their own character's texts about this date, one tap away (the owner of a side only: see the read above).
          <p className="muted" data-chat-about>
            💬{" "}
            {textedAbout.length === 1 ? (
              <Link href={companionThreadHref(textedAbout[0].thread_id)} data-track="episode-texted-about" data-track-character={textedAbout[0].character_id}>
                {firstName(textedAbout[0].name)} texted you about this
              </Link>
            ) : (
              <>
                {textedAbout.map((x, i) => (
                  <span key={x.thread_id}>
                    {i > 0 && (i === textedAbout.length - 1 ? " and " : ", ")}
                    <Link href={companionThreadHref(x.thread_id)} data-track="episode-texted-about" data-track-character={x.character_id}>
                      {firstName(x.name)}
                    </Link>
                  </span>
                ))}{" "}
                texted you about this
              </>
            )}
          </p>
        )}
        {episode.creators && (
          <p className="creators">
            Made by{" "}
            {episode.creators.map((c, i) => (
              <span key={c.character_id}>
                {i > 0 && " and "}
                <strong>{c.name}</strong> ({nameOf(c.character_id)}&apos;s creator)
              </span>
            ))}
          </p>
        )}
        {episode.hidden && <p className="error">{HIDDEN_EPISODE_MESSAGE} Only its creators can still open it.</p>}
        {afterDarkLink && (
          <p className="after-dark-marker">
            <Link href={afterDarkLink}>🌙 They spent the night together before this date. See their night</Link>
          </p>
        )}
        {continueNight && (
          // Only someone After Dark already admits, who owns one of the two, ever gets this (lib/adult/overnight.ts).
          <p className="after-dark-marker" data-overnight-continue>
            <a href={continueNight.href} data-track="overnight-continue">
              🌙 {OVERNIGHT_COPY.continueButton}
            </a>
          </p>
        )}

        <section className="episode-wants" aria-labelledby="wants-title">
          <h2 id="wants-title">What they want</h2>
          <ul>
            {episode.goals.map((g) => {
              const c = episode.characters.find((x) => x.id === g.character_id);
              // The goal usually opens with their name already: the face-and-name label takes its place, said once.
              const rest = c ? withoutLeadName(g.goal, c.name) : null;
              return (
                <li key={g.character_id} className="card">
                  {c && <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={40} />}
                  <p>
                    {c ? <CharacterName character={c} avatar={false} strong /> : <strong>{nameOf(g.character_id)}</strong>}
                    {rest !== null ? rest : <>: {g.goal}</>}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Predicting comes before the read: once the lines are read, there's nothing left to call. */}
        <div id="predict" className="episode-predict">
          <EpisodeActions
            episodeId={episode.id}
            sharePath={episode.share_path}
            shareBase={base}
            isCreator={episode.is_creator}
            isHost={episode.is_host}
            revealed={episode.revealed}
            names={names}
            dramaQuestion={episode.drama_question}
            myPick={episode.my_pick}
            myDramaPick={episode.my_drama_pick}
            dateNumber={dateNo}
            visibility={episode.visibility}
            airsAt={airsAt}
            lately={lately}
          />
        </div>

        {episode.transcript && episode.transcript.length > 0 && (
          // The date itself, on the page (design audit 2026-11-14): its first exchange shows, the rest one tap away
          // ("Read the whole date"). Only the lines this viewer already gets (none before the finale airs, for a spectator).
          <TranscriptRead episodeId={episode.id} characters={episode.characters} turns={episode.transcript} thoughts={episode.inner?.thoughts} />
        )}
        {storyOpen && episode.status === "ready" && episode.transcript && episode.transcript.length > 0 && (
          // Read it as a story (lib/stories.ts): made once by one of the date's own people or a plan member, then kept for everyone.
          <StoryButton endpoint={`/api/episodes/${episode.id}/story`} initial={keptStory} price={storyPrice} className="card episode-story" />
        )}

      {/* The recap, the box score and the other ending reveals: folded away behind one toggle when the theater can
          play the date, so nobody scrolling past is told how it ends (open as before when there's no transcript). */}
      <RecapToggle hasTheater={hasTheater}>
        {episode.ending ? (
          <section className="card">
            <h2>The date</h2>
            {episode.scenes?.map((scene, i) => (
              <div key={i}>
                <h3 className="act">{DATE_ACTS[i] ?? `Act ${i + 1}`}</h3>
                <p>{withoutActLabel(scene, DATE_ACTS[i])}</p>
              </div>
            ))}
            <h2>The twist</h2>
            <p>{episode.twist}</p>
            {/* The last act ("The decision") is sometimes the finale word for word: then it isn't said twice. */}
            {!finaleRepeats && (
              <>
                <h2>The finale</h2>
                <p>{episode.finale}</p>
              </>
            )}
            <div className="ending-beat">
              <p className="ending">Ending: {endingWithDetail(episode.ending, dateNo, episode.ending_detail)}</p>
              {/* An overnight date closes on its card (lib/overnight-shared.ts): the fade to black, or the night called. */}
              {overnight && (
                <p className="overnight-close" data-overnight-close={episode.ending === "second_date" ? "left" : "night"}>
                  {overnightClose(episode.ending)}
                </p>
              )}
              {/* A reader who scrolled this far saw how it ended: the funnel's "Watched it end" (EndingSeen.tsx). */}
              {episode.revealed && <EndingSeen />}
            </div>
            {episode.drama_question && episode.drama_answer && (
              <p>
                {DRAMA_QUESTION_LABELS[episode.drama_question]}{" "}
                <strong>{dramaAnswerLabel(episode.drama_question, episode.drama_answer, names)}</strong>
              </p>
            )}
            {!episode.revealed && <p className="muted">Only the creators can see this until the finale airs.</p>}
          </section>
        ) : (
          <section className="card">
            <p className="muted">The date, the twist and the ending stay hidden until the finale airs.</p>
          </section>
        )}

        {episode.box_score && <BoxScore boxScore={episode.box_score} bestLine={episode.best_line} why={episode.why} note={episode.box_score_note} reportCard={reportCard} />}

        {/* Behind the scenes: the agendas and the confessionals, one card instead of two in a row (UX audit 2026-10-23). */}
        {(episode.agendas || episode.confessionals) && (
          <section className="card behind-scenes">
            <h2>Behind the scenes</h2>
            {episode.agendas && (
              <>
                <h3>Secret agendas &amp; the producer</h3>
                {episode.producer && (
                  <p className="muted">
                    The producer&apos;s act-2 situation: <strong>{episode.producer}</strong>.
                  </p>
                )}
                <ul>
                  {episode.agendas.map((ag) => {
                    const rest = withoutLeadName(ag.agenda, nameOf(ag.character_id) ?? "");
                    return (
                      <li key={ag.character_id}>
                        {who(ag.character_id)}
                        {rest !== null ? rest : <>: {ag.agenda}</>}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {episode.confessionals && (
              <>
                <h3>The confessionals</h3>
                {/* Said to the camera in the confessional (lib/show-sets.ts). */}
                <div className="confessional-set on-set" style={{ backgroundImage: showSetBackground("confessional", 0.55) }}>
                  {episode.confessionals.map((c) => {
                    const shot = confessionalShot(c.character_id);
                    return shot ? (
                      <div key={c.character_id} className="confessional-with-shot">
                        {/* eslint-disable-next-line @next/next/no-img-element -- a PG shot from its own route, already small */}
                        <img className="confessional-shot" src={shot} alt="" width={64} height={80} loading="lazy" />
                        <p className="confessional">
                          {who(c.character_id, false)}: “{c.line}”
                        </p>
                      </div>
                    ) : (
                      <p key={c.character_id} className="confessional">
                        {who(c.character_id)}: “{c.line}”
                      </p>
                    );
                  })}
                </div>
                {episode.is_host && <ConfessionalShare episodeId={episode.id} shared={episode.confessionals_shared} />}
              </>
            )}
          </section>
        )}

        {dare && (
          <section className="card dare-reveal">
            <h2>The producers dared {nameOf(dare.character_id) ?? dare.name}</h2>
            <p>
              The audience voted, and {who(dare.character_id) ?? <strong>{dare.name}</strong>} walked in with it in the pocket: <em>“{dare.text}”</em> Their
              date never knew.
            </p>
            <p>
              Did they go through with it?{" "}
              <strong>
                {dare.verdict ? VERDICT_WORDS[dare.verdict].charAt(0).toUpperCase() + VERDICT_WORDS[dare.verdict].slice(1) : "Watch the date and decide."}
              </strong>
            </p>
          </section>
        )}

        {episode.debrief && (
          <section className="card debrief">
            <h2>Your private debrief</h2>
            <p className="muted">A report on your own AI&apos;s date. Only you can see this.</p>
            <ul>
              <li>Wants another date: <strong>{episode.debrief.wants_another ? "yes" : "no"}</strong></li>
              <li>What it liked: {episode.debrief.liked ? <>something about “{episode.debrief.liked}”</> : "nothing in particular"}</li>
              <li>What made it uncomfortable: {episode.debrief.uncomfortable ? <>“{episode.debrief.uncomfortable}”</> : "nothing major"}</li>
              <li>Its secret agenda ({episode.debrief.agenda}): <strong>{episode.debrief.agenda_met ? "met" : "not met"}</strong></li>
              {episode.debrief.note_followed !== null && (
                <li>Your note in the pocket: <strong>{episode.debrief.note_followed ? "it took your advice" : "it ignored your advice"}</strong></li>
              )}
            </ul>
            {surprise && (
              <p className={surprise.surprised ? "notice" : undefined}>
                You guessed {endingLabel(surprise.self_pick, dateNo)}; your AI landed on {endingLabel(surprise.actual, dateNo)}.{" "}
                {surprise.surprised ? "It surprised you." : "Exactly as you expected."}
              </p>
            )}
          </section>
        )}
      </RecapToggle>

      {/* The diary cam: each side's take to camera, once the date has aired (never before the ending is out). */}
      {/* ...with each side's own answer to "see them again?" (living dates, lib/choices.ts), once it has aired. */}
      {(episode.diary || episode.inner) && (
        <DiaryCam
          diary={episode.diary ?? []}
          choices={episode.inner?.choices ?? []}
          thoughts={episode.characters.map((c, i) => ({
            character_id: c.id,
            thoughts: (episode.transcript ?? []).flatMap((t, n) => (t.side === (i === 0 ? "a" : "b") && episode.inner?.thoughts[n] ? [episode.inner.thoughts[n]!] : [])),
          }))}
          characters={episode.characters}
          folded={hasTheater}
        />
      )}

      {episode.afterglow && (
        <Afterglow episodeId={episode.id} characters={episode.characters} afterglow={episode.afterglow} secondDate={secondDate} dateNumber={dateNo} shareable={episode.visibility !== "private"} />
      )}
      {datePhotos && <DatePhotos episodeId={episode.id} state={datePhotos} styles={DATE_PHOTO_STYLES.map((s) => ({ id: s.id, label: s.label }))} />}
      {!episode.afterglow && secondDate?.mutual && (
        <section className="card">
          {episode.visibility !== "private" && <ShareEnding episodeId={episode.id} names={[episode.characters[0].name, episode.characters[1].name]} dateNumber={dateNo} kind="owner_well" />}
          <SecondDate episodeId={episode.id} state={secondDate} />
        </section>
      )}

      {episode.is_creator && episode.box_score && !firstDateJustFilmed && <SlidingDoors episodeId={episode.id} dateNumber={dateNo} />}

      {quiz && (
        <DealbreakerQuiz
          episodeId={episode.id}
          characterName={a.name}
          options={quiz.options}
          myPick={quiz.my_pick}
          revealed={quiz.revealed}
          answer={quiz.answer}
          correct={quiz.correct}
        />
      )}

      {/* The ending's call, once it has aired: only for someone who made one (the 2026-11-22 audit: "You didn't predict this
          one." under "You didn't guess this one." was the page's last word to everyone who never played). */}
      {episode.revealed && !episode.is_creator && episode.my_pick && (
        <section className="card">
          <p className={episode.my_points ? "notice" : undefined}>
            You picked {endingLabel(episode.my_pick, dateNo)}
            {episode.drama_question &&
              episode.my_drama_pick &&
              ` and ${dramaAnswerLabel(episode.drama_question, episode.my_drama_pick, names)}`}
            : {episode.my_points ? `+${episode.my_points}` : "0"} points.
            {myShare && (
              <>
                {" "}
                <ShareRecord share={myShare} where="episode" />
              </>
            )}
          </p>
        </section>
      )}

      {episode.identity && (
        <CreatorReveal
          episodeId={episode.id}
          consented={episode.identity.consented}
          consents={episode.identity.consents}
          needed={episode.identity.needed}
          revealed={Boolean(episode.creators)}
          hasName={profileName !== null}
          premiumPartner={episode.characters.some((c) => PREMIUM_IDS.has(c.id))}
        />
      )}

      <UpNext episodes={next} />
        </div>
        <aside className="episode-rail" aria-label="Around this date">
          {prev && (
            <aside className="episode-prev" aria-label="Previously on Botchelor">
              <span className="episode-prev-label">Previously on</span>
              <p>
                {prev.line} <Link href={`/episodes/${prev.episode_id}`}>Watch that one</Link>
              </p>
            </aside>
          )}
          {/* J3: a creator's finished date is when they want to hear what happens next (gone once notifications are on).
              Before it airs (2026-11-11 growth plan: push is live and nothing asked at the moment it matters), the same
              row asks about the airing itself: date_aired already reaches push (lib/air.ts notifyOwnersAired). */}
          {episode.is_creator && episode.status === "ready" && push && (
            <PushToggle
              publicKey={push.publicKey}
              prompt
              emailFallback
              place="episode"
              title={episode.revealed ? "Tell me when they text" : "Tell me when it airs"}
              body={
                episode.revealed
                  ? "They text each other after a date. Hear it as it happens, even with the site closed."
                  : "One notification when their date is on the air, and when they text after it, even with the site closed."
              }
            />
          )}
          {/* After the date and how it ended (2026-11-07 audit, item 4: it asked "how did it go?" above the date itself). */}
          {talk.length > 0 && (
            <section className="card episode-talk" aria-labelledby="episode-talk-head">
              <p className="kicker">After the date</p>
              <h2 id="episode-talk-head">Ask {talk.length === 1 ? talk[0].name.split(/\s+/)[0] : "them"} how it went</h2>
              <p className="muted small">Off the show, one to one. They&apos;ll tell you their side. Every companion is an AI character.</p>
              <p className="episode-talk-actions">
                {talk.map((c) =>
                  c.signIn ? (
                    <Link key={c.id} className="button secondary small" href={`/account?next=${encodeURIComponent(`/characters/${c.id}`)}`}>
                      Sign in to talk to {c.name.split(/\s+/)[0]}
                    </Link>
                  ) : (
                    <TalkButton key={c.id} characterId={c.id} name={c.name.split(/\s+/)[0]} label={`Talk to ${c.name.split(/\s+/)[0]}`} className="button secondary small" />
                  ),
                )}
              </p>
            </section>
          )}
          <WatchPartyLaunch episodeId={episode.id} isHost={episode.is_host} partyId={partyId} />

          {!episode.is_creator && <MakeYourOwn />}

          <footer className="episode-foot">
            <p className="muted">
              Your points: {points}. <Link href="/watch">More episodes</Link>
              {episode.characters[0] && (
                <>
                  {" · "}
                  <Link href={`/graph?focus=${encodeURIComponent(episode.characters[0].id)}`}>✨ Where they sit in the Constellation</Link>
                </>
              )}
            </p>
            {/* Report and block: one tap away on every episode, folded so it doesn't sit in the way. */}
            <details className="episode-safety">
              <summary>Something wrong? Report or block</summary>
              <SafetyActions episodeId={episode.id} canBlock={canBlock} blocked={episode.blocked} />
            </details>
            {/* The site footer, straight below, carries the crisis links. */}
            <EpisodeNotices crisis={false} />
          </footer>
        </aside>
      </div>
    </article>
  );
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** A recap scene without the "act 1: First impressions." the writer sometimes starts it with, when it repeats the
 *  heading above it. Only that act's own label is taken off, never a first sentence. */
function withoutActLabel(scene: string, label: string | undefined): string {
  if (!label) return scene;
  const name = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scene.replace(new RegExp(`^\\s*act\\s*\\d+\\s*[:.\\-–—]\\s*${name}\\s*[.:\\-–—]\\s*`, "i"), "");
}
