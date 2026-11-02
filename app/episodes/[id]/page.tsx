import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "@/app/JsonLd";
import { breadcrumbJsonLd } from "@/lib/seo";
import { episodeCardPath, pageTitle, SHARE_QUESTION, shareDescription, shareTitle } from "@/lib/episode-share";
import EpisodeNotices from "@/app/Notices";
import { siteUrl } from "@/lib/site";
import { getDb } from "@/lib/db";
import { adultViewerFromCookies } from "@/lib/adult/mode";
import { afterDarkHref } from "@/lib/after-dark-host";
import { getEpisodeView, getPoints } from "@/lib/game";
import { partyIdForEpisode } from "@/lib/watch";
import { PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { userIdFromCookieStore } from "@/lib/http";
import { secondDateState } from "@/lib/second-date";
import { siblingEpisode } from "@/lib/group-dates";
import { mixerNightOf } from "@/lib/mixer-night";
import { getDealbreakerQuiz, getSurprise } from "@/lib/mechanics";
import { getProfileName } from "@/lib/people";
import { DATE_ACTS, dateLabel, dateNumberOf, DRAMA_QUESTION_LABELS, dramaAnswerLabel, endingLabel, HIDDEN_EPISODE_MESSAGE } from "@/lib/rules";
import { formatLabel } from "@/lib/formats";
import { venuePhrase, venueBackdropCss, venueName } from "@/lib/venues";
import { venueBackdrop } from "@/lib/portraits";
import Avatar from "@/app/Avatar";
import CharacterName from "@/app/CharacterName";
import Afterglow, { SecondDate } from "./Afterglow";
import EpisodeTheater from "./EpisodeTheater";
import ChatThread from "@/app/ChatThread";
import BoxScore from "./BoxScore";
import DiaryCam from "./DiaryCam";
import ConfessionalShare from "./ConfessionalShare";
import CreatorReveal from "./CreatorReveal";
import DealbreakerQuiz from "./DealbreakerQuiz";
import EpisodeActions from "./EpisodeActions";
import DatePhotos from "./DatePhotos";
import { DATE_PHOTO_STYLES, datePhotoState } from "@/lib/studio/date-photos";
import RecapToggle from "./RecapToggle";
import { airIfDue, airWindowMinutes } from "@/lib/air";
import { endingsLately } from "@/lib/endings-lately";
import SafetyActions from "./SafetyActions";
import SlidingDoors from "./SlidingDoors";
import WatchPartyLaunch from "./WatchPartyLaunch";
import GeneratingPoller from "./GeneratingPoller";
import PushToggle from "@/app/notifications/PushToggle";
import { pushKeys } from "@/lib/push";
import { withoutLeadName } from "./lead-name";

export const dynamic = "force-dynamic";

const PREMIUM_IDS = new Set(PREMIUM_HOUSE_CHARACTERS.map((c) => c.id));

/**
 * Each episode gets its own title and summary for search and link previews, from the public view only (no
 * spoilers: the setting is the teaser). Only public, unhidden episodes are indexable; unlisted, private and
 * hidden ones tell crawlers to stay out.
 *
 * The link preview is the share card (/api/og/episode/<id>): a "How does it end?" poll, as a large Twitter card.
 * Setting openGraph.images here is what puts it ahead of ./opengraph-image (the box score card, still served).
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const episode = await getEpisodeView(await getDb(), id, null);
  if (!episode || episode.hidden) return { title: "Episode · Botchelor", robots: { index: false, follow: false } };
  const [a, b] = episode.characters;
  const names: [string, string] = [a.name, b.name];
  const indexable = episode.visibility === "public";
  const description = shareDescription(names, episode.setting, episode.revealed);
  const card = { url: episodeCardPath(id), width: 1200, height: 630, alt: `${a.name} × ${b.name}: ${SHARE_QUESTION} A poll with three answers.` };
  // The place in words ("the night market"), never its id (2026-10-23: titles read "at night_market").
  const venue = typeof episode.venue === "string" ? venuePhrase(episode.venue) : null;
  return {
    // #SEO: richer long-tail title (name × name + venue) in the HTML <title>; social cards keep the "How does it end?"
    // headline. Never includes the ending — a Google snippet shouldn't spoil what visitors can predict for points.
    title: pageTitle(names, venue),
    description,
    alternates: { canonical: `/episodes/${id}` },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
    // The root layout's openGraph and twitter are replaced, not merged, so the site's own fields are repeated here.
    openGraph: { type: "website", siteName: "Botchelor", locale: "en_US", url: `/episodes/${id}`, title: shareTitle(names), description, images: [card] },
    twitter: { card: "summary_large_image", title: shareTitle(names), description, images: [{ url: card.url, alt: card.alt }] },
  };
}

/** The way in for anyone who isn't one of this date's creators, most often someone who followed a shared link. */
function MakeYourOwn() {
  return (
    <section className="make-your-own card">
      <div>
        <h2>Send your own character on a date</h2>
        <p className="muted">Make an original character in a minute and the show writes their blind date. Free to start, no sign-up.</p>
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
  children,
}: {
  characters: [HeroCharacter, HeroCharacter];
  venue: string | null;
  setting: string | null;
  chips: (string | null | false | undefined)[];
  children?: React.ReactNode;
}) {
  const [a, b] = characters;
  const photo = venue ? venueBackdrop(venue) : null;
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
      <div className="episode-hero-inner">
        <p className="episode-hero-kicker">
          <span>Botchelor</span>
          {venue && <span>{venueName(venue)}</span>}
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
  // `?play=1`: the creator just sent this date, so it opens on the theater stage and plays when it's filmed.
  // `&from=N`: they watched N lines live while it was filmed, so the playback carries on from there.
  const query = await searchParams;
  const play = query.play === "1";
  const from = Math.max(0, Math.floor(Number(query.from) || 0));
  const viewerId = userIdFromCookieStore(await cookies());
  const db = await getDb();
  // Dates air by default once their prediction window closes (lib/air.ts): opening one that's due airs it.
  await airIfDue(db, id).catch(() => null);
  const episode = await getEpisodeView(db, id, viewerId);
  // 🌙 on a date that carried an After Dark memory, only for someone After Dark is open to (never a hint to anyone else).
  const afterDarkLink = episode?.after_dark && (await adultViewerFromCookies(db, await cookies())) ? afterDarkHref(`/after-dark/${[episode!.characters[0].id, episode!.characters[1].id].sort().join("/")}`) : null;
  // When an unaired date airs on its own (its booking plus the prediction window), for the host's controls.
  const airsAt =
    episode && !episode.revealed && episode.is_host
      ? await db
          .query<{ at: Date | string }>(`select coalesce(air_after, created_at + $2 * interval '1 minute') as at from episodes where id = $1`, [id, airWindowMinutes()])
          .then((r) => (r.rows[0] ? new Date(r.rows[0].at).toISOString() : null))
          .catch(() => null)
      : null;
  // #728: how recent aired public dates ended, beside the prediction form, so a pick isn't blind (never this date's ending).
  const lately = episode && !episode.revealed && !episode.is_creator ? await endingsLately(db).then((l) => (l.of ? l.says : null)).catch(() => null) : null;
  // Hidden after reports: a 404 for everyone except its creators (see ./not-found.tsx).
  if (!episode || (episode.hidden && !episode.is_creator)) notFound();

  const points = viewerId ? await getPoints(db, viewerId) : 0;
  const profileName = episode.is_creator ? await getProfileName(db, viewerId) : null;
  // The $0 mechanics: spectators get the dealbreaker quiz; the owner (host) sees the surprise reveal.
  const quiz = !episode.is_creator ? await getDealbreakerQuiz(db, id, viewerId) : null;
  const surprise = episode.is_creator ? await getSurprise(db, id, viewerId) : null;
  // Their second date, when both characters want one (lib/second-date.ts): owners only.
  const secondDate = episode.is_creator && viewerId ? await secondDateState(db, id, viewerId) : null;
  // 📸 Date photos, for the owner of one of the two (lib/studio/date-photos.ts; null for anyone else).
  const datePhotos = viewerId ? await datePhotoState(db, viewerId, id).catch(() => null) : null;
  const partyId = await partyIdForEpisode(db, id);
  // Performed by its creator's own AI (an agent dating two of its own characters, lib/own-date.ts)?
  // Who performed the lines (docs/agents-and-people.md): the show's model, one agent's AI, or each character's own agent.
  const performer = (
    await db.query<{ performed_by: string; two_agent: boolean }>(`select performed_by, partner_performer is not null as two_agent from episodes where id = $1`, [id])
  ).rows[0];
  const selfPerformed = performer?.performed_by === "agent";
  const twoAgent = selfPerformed && performer?.two_agent === true;
  const [a, b] = episode.characters;
  const names: [string, string] = [a.name, b.name];
  const nameOf = (characterId: string) => episode.characters.find((c) => c.id === characterId)?.name;
  // A speaker's face and name, for the agendas and confessionals.
  const who = (id: string) => {
    const c = episode.characters.find((x) => x.id === id);
    return c ? <CharacterName character={c} strong /> : null;
  };
  // A creator of a house date has nobody to block; everyone else blocks "whoever made this".
  const canBlock = !episode.is_creator || episode.characters.every((c) => !c.house);

  // M10: the date is generated in the background. Until it's ready, show a waiting state that polls.
  if (episode.status !== "ready") {
    return (
      <article className="episode-page">
        <EpisodeHero characters={episode.characters} venue={episode.venue ?? null} setting={null} chips={["🎬 Being filmed", "AI-generated"]}>
          {!episode.is_creator && (
            <div className="episode-hero-cta">
              <Link className="episode-hero-link" href="/create">
                Make your own character
              </Link>
            </div>
          )}
        </EpisodeHero>
        <div className="episode-body">
          {selfPerformed && (
            <p className="muted">
              {twoAgent
                ? "🎭 Each character's own agent is performing this date on its own AI, taking turns. The ending is already decided."
                : "🎭 Its creator's own AI is performing this date, one line at a time. The ending is already decided."}
            </p>
          )}
          <GeneratingPoller
            episodeId={episode.id}
            stage={play && episode.is_creator ? { characters: episode.characters, venue: episode.venue ?? null, canSetScene: !selfPerformed } : undefined}
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
  // Which date this is for the couple: a happy ending on their third date reads "A fourth date", never "A second date".
  const dateNo = dateNumberOf(episode);
  const squash = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  // A double date (lib/group-dates.ts): the other couple's episode of the same night, when both tables aired publicly.
  const sibling = await siblingEpisode(db, episode.id).catch(() => null);
  // A mixer's table (lib/mixer-night.ts): its round, and the way back to the whole room's night.
  const mixer = sibling ? null : await mixerNightOf(db, episode.id).catch(() => null);
  const lastAct = episode.scenes?.length ? episode.scenes.length - 1 : -1;
  const finaleRepeats =
    lastAct >= 0 && Boolean(episode.finale) && squash(withoutActLabel(episode.scenes![lastAct], DATE_ACTS[lastAct])) === squash(episode.finale);
  return (
    <article className="episode-page">
      {episode.visibility === "public" && !episode.hidden && (
        <JsonLd
          data={[{
            "@context": "https://schema.org",
            "@type": "CreativeWork",
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
        chips={[
          "AI-generated",
          episode.followup_of ? dateLabel(episode.date_number ?? 2) : null,
          episode.format ? formatLabel(episode.format) : null,
          episode.roleplay ? `${episode.roleplay.icon} Roleplay: ${episode.roleplay.title}` : null,
          a.house && b.house ? "House cast" : a.house || b.house ? "With a house character" : null,
          a.agent || b.agent ? "🤖 Agent-made" : null,
          sibling ? "💞💞 A double date" : null,
          mixer ? `🍸 Mixer · round ${mixer.round} of ${mixer.rounds}` : null,
          selfPerformed ? (twoAgent ? "🎭 Performed by both characters' agents" : "🎭 Performed by its creator's AI") : null,
        ]}
      >
        <div className="episode-hero-cta">
          {hasTheater && episode.ending && episode.transcript ? (
            <EpisodeTheater
              episodeId={episode.id}
              characters={episode.characters}
              venue={episode.venue ?? null}
              transcript={episode.transcript}
              endingLabel={endingLabel(episode.ending, dateNo)}
              autoOpen={play && episode.is_creator}
              startAt={play && episode.is_creator ? from : 0}
              roleplay={episode.roleplay ?? null}
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

      <div className="episode-body">
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
        {/* J3: a creator's finished date is when they want to hear what happens next (gone once notifications are on). */}
        {episode.is_creator && episode.status === "ready" && push && (
          <PushToggle publicKey={push.publicKey} prompt emailFallback title="Tell me when they text" body="They text each other after a date. Hear it as it happens, even with the site closed." />
        )}

        {episode.transcript && episode.transcript.length > 0 && (
          // The theater is the way to watch; the line-by-line read folds away under it (open when there's no theater).
          <details className="card transcript episode-read" id="the-date" open={!hasTheater}>
            <summary>
              <h2>Read it line by line</h2>
              <span className="muted">The two characters played this out turn by turn: nobody scripted the lines in advance.</span>
            </summary>
            <ChatThread characters={episode.characters} turns={episode.transcript} feedback={{ kind: "episode", refId: episode.id }} />
          </details>
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
            <p className="ending">Ending: {endingLabel(episode.ending, dateNo)}</p>
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

        {episode.box_score && <BoxScore boxScore={episode.box_score} bestLine={episode.best_line} why={episode.why} note={episode.box_score_note} />}

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
                {episode.confessionals.map((c) => (
                  <p key={c.character_id} className="confessional">
                    {who(c.character_id)}: “{c.line}”
                  </p>
                ))}
                {episode.is_host && <ConfessionalShare episodeId={episode.id} shared={episode.confessionals_shared} />}
              </>
            )}
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
      {episode.diary && <DiaryCam diary={episode.diary} characters={episode.characters} folded={hasTheater} />}

      {episode.afterglow && (
        <Afterglow episodeId={episode.id} characters={episode.characters} afterglow={episode.afterglow} secondDate={secondDate} dateNumber={dateNo} />
      )}
      {datePhotos && <DatePhotos episodeId={episode.id} state={datePhotos} styles={DATE_PHOTO_STYLES.map((s) => ({ id: s.id, label: s.label }))} />}
      {!episode.afterglow && secondDate?.mutual && (
        <section className="card">
          <SecondDate episodeId={episode.id} state={secondDate} />
        </section>
      )}

      {episode.is_creator && episode.box_score && <SlidingDoors episodeId={episode.id} dateNumber={dateNo} />}

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

      {episode.revealed && !episode.is_creator && (
        <section className="card">
          {episode.my_pick ? (
            <p className={episode.my_points ? "notice" : undefined}>
              You picked {endingLabel(episode.my_pick, dateNo)}
              {episode.drama_question &&
                episode.my_drama_pick &&
                ` and ${dramaAnswerLabel(episode.drama_question, episode.my_drama_pick, names)}`}
              : {episode.my_points ? `+${episode.my_points}` : "0"} points.
            </p>
          ) : (
            <p className="muted">You didn&apos;t predict this one.</p>
          )}
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
      </div>
    </article>
  );
}

/** A recap scene without the "act 1: First impressions." the writer sometimes starts it with, when it repeats the
 *  heading above it. Only that act's own label is taken off, never a first sentence. */
function withoutActLabel(scene: string, label: string | undefined): string {
  if (!label) return scene;
  const name = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scene.replace(new RegExp(`^\\s*act\\s*\\d+\\s*[:.\\-–—]\\s*${name}\\s*[.:\\-–—]\\s*`, "i"), "");
}
