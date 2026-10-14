import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import EpisodeNotices from "@/app/Notices";
import { getDb } from "@/lib/db";
import { getEpisodeView, getPoints } from "@/lib/game";
import { partyIdForEpisode } from "@/lib/watch";
import { PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { readUserId, USER_COOKIE } from "@/lib/http";
import { getDealbreakerQuiz, getSurprise } from "@/lib/mechanics";
import { getProfileName } from "@/lib/people";
import { DATE_ACTS, DRAMA_QUESTION_LABELS, dramaAnswerLabel, ENDING_LABELS, HIDDEN_EPISODE_MESSAGE } from "@/lib/rules";
import { formatLabel } from "@/lib/formats";
import { venueBackdropCss, venueName } from "@/lib/venues";
import { venueBackdrop } from "@/lib/portraits";
import Avatar from "@/app/Avatar";
import Afterglow from "./Afterglow";
import EpisodeTheater from "./EpisodeTheater";
import BoxScore from "./BoxScore";
import ConfessionalShare from "./ConfessionalShare";
import CreatorReveal from "./CreatorReveal";
import DealbreakerQuiz from "./DealbreakerQuiz";
import EpisodeActions from "./EpisodeActions";
import SafetyActions from "./SafetyActions";
import SlidingDoors from "./SlidingDoors";
import WatchPartyLaunch from "./WatchPartyLaunch";
import GeneratingPoller from "./GeneratingPoller";

export const dynamic = "force-dynamic";

const PREMIUM_IDS = new Set(PREMIUM_HOUSE_CHARACTERS.map((c) => c.id));

export default async function EpisodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewerId = readUserId((await cookies()).get(USER_COOKIE)?.value);
  const db = await getDb();
  const episode = await getEpisodeView(db, id, viewerId);
  // Hidden after reports: a 404 for everyone except its creators (see ./not-found.tsx).
  if (!episode || (episode.hidden && !episode.is_creator)) notFound();

  const points = viewerId ? await getPoints(db, viewerId) : 0;
  const profileName = episode.is_creator ? await getProfileName(db, viewerId) : null;
  // The $0 mechanics: spectators get the dealbreaker quiz; the owner (host) sees the surprise reveal.
  const quiz = !episode.is_creator ? await getDealbreakerQuiz(db, id, viewerId) : null;
  const surprise = episode.is_creator ? await getSurprise(db, id, viewerId) : null;
  const partyId = await partyIdForEpisode(db, id);
  const [a, b] = episode.characters;
  const names: [string, string] = [a.name, b.name];
  const nameOf = (characterId: string) => episode.characters.find((c) => c.id === characterId)?.name;
  // A creator of a house date has nobody to block; everyone else blocks "whoever made this".
  const canBlock = !episode.is_creator || episode.characters.every((c) => !c.house);

  // M10: the date is generated in the background. Until it's ready, show a waiting state that polls.
  if (episode.status !== "ready") {
    return (
      <article>
        <p className="kicker">Botchelor episode</p>
        <EpisodeNotices />
        <div className="matchup">
          <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} size={60} />
          <span className="vs">×</span>
          <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} size={60} />
        </div>
        <h1>
          {a.name} × {b.name}
        </h1>
        <GeneratingPoller episodeId={episode.id} />
        <p className="muted">
          <Link href="/feed">More episodes</Link>
        </p>
      </article>
    );
  }

  return (
    <article>
      <p className="kicker">Botchelor episode</p>
      <EpisodeNotices />
      <div className="matchup">
        <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} size={60} />
        <span className="vs">×</span>
        <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} size={60} />
      </div>
      <h1>
        {a.name} × {b.name}
      </h1>
      <p className="muted">
        {a.name}
        {a.house && <span className="badge">House character</span>} meets {b.name}
        {b.house && <span className="badge">House character</span>}
        {episode.format && <span className="badge badge-format">{formatLabel(episode.format)}</span>}
      </p>
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
      {episode.hidden && (
        <p className="error">{HIDDEN_EPISODE_MESSAGE} Only its creators can still open it.</p>
      )}

      <section className="card">
        <h2>The setting</h2>
        {episode.venue && (
          <p
            className="venue"
            style={{
              // A legibility scrim over the reviewed backdrop photo (lib/portraits.ts), with the venue's
              // gradient as the fallback when there's no photo for this venue.
              backgroundImage: [
                "linear-gradient(rgba(15,10,20,0.30), rgba(15,10,20,0.48))",
                venueBackdrop(episode.venue) ? `url(${venueBackdrop(episode.venue)})` : null,
                venueBackdropCss(episode.venue),
              ]
                .filter(Boolean)
                .join(", "),
            }}
          >
            {venueName(episode.venue)}
          </p>
        )}
        <p>{episode.setting}</p>
        <h2>What they want</h2>
        <ul>
          {episode.goals.map((g) => (
            <li key={g.character_id}>
              <strong>{nameOf(g.character_id)}:</strong> {g.goal}
            </li>
          ))}
        </ul>
        {episode.drama_question && (
          <p className="muted">Bonus question: {DRAMA_QUESTION_LABELS[episode.drama_question]}</p>
        )}
      </section>

      {episode.ending ? (
        <section className="card">
          <h2>The date</h2>
          {episode.scenes?.map((scene, i) => (
            <div key={i}>
              <h3 className="act">{DATE_ACTS[i] ?? `Act ${i + 1}`}</h3>
              <p>{scene}</p>
            </div>
          ))}
          <h2>The twist</h2>
          <p>{episode.twist}</p>
          <h2>The finale</h2>
          <p>{episode.finale}</p>
          <p className="ending">Ending: {ENDING_LABELS[episode.ending]}</p>
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

      {episode.transcript && episode.transcript.length > 0 && (
        <section className="card transcript">
          <h2>The date, line by line</h2>
          <p className="muted">The two characters played this out turn by turn — nobody scripted the lines in advance.</p>
          {episode.ending && (
            <p className="theater-cta">
              <EpisodeTheater
                characters={episode.characters}
                venue={episode.venue ?? null}
                transcript={episode.transcript}
                endingLabel={ENDING_LABELS[episode.ending]}
              />
              <span className="muted"> Watch it play out as a scene.</span>
            </p>
          )}
          {episode.transcript.map((t, i) => {
            const prev = episode.transcript![i - 1];
            const showAct = !prev || prev.act !== t.act;
            const who = t.side === "a" ? a : b;
            const meta = [t.action, t.emotion].filter(Boolean).join(" · ");
            return (
              <div key={i}>
                {showAct && <h3 className="act">{DATE_ACTS[t.act] ?? `Act ${t.act + 1}`}</h3>}
                <div className={`turn turn-${t.side}`}>
                  <Avatar seed={who.id} name={who.name} hue={who.hue} house={who.house} size={30} />
                  <div className="turn-body">
                    <p className="turn-line">
                      <strong>{who.name}</strong> {t.dialogue}
                    </p>
                    {meta && <p className="turn-meta">{meta}</p>}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {episode.box_score && <BoxScore boxScore={episode.box_score} bestLine={episode.best_line} />}

      {episode.agendas && (
        <section className="card">
          <h2>Secret agendas &amp; the producer</h2>
          {episode.producer && (
            <p className="muted">
              The producer&apos;s act-2 situation: <strong>{episode.producer}</strong>.
            </p>
          )}
          <ul>
            {episode.agendas.map((ag) => (
              <li key={ag.character_id}>
                <strong>{nameOf(ag.character_id)}:</strong> {ag.agenda}
              </li>
            ))}
          </ul>
        </section>
      )}

      {episode.confessionals && (
        <section className="card">
          <h2>The confessionals</h2>
          {episode.confessionals.map((c) => (
            <p key={c.character_id} className="confessional">
              <strong>{nameOf(c.character_id)}:</strong> “{c.line}”
            </p>
          ))}
          {episode.is_host && <ConfessionalShare episodeId={episode.id} shared={episode.confessionals_shared} />}
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
              You guessed {ENDING_LABELS[surprise.self_pick]}; your AI landed on {ENDING_LABELS[surprise.actual]}.{" "}
              {surprise.surprised ? "It surprised you." : "Exactly as you expected."}
            </p>
          )}
        </section>
      )}

      {episode.afterglow && (
        <Afterglow episodeId={episode.id} characters={episode.characters} afterglow={episode.afterglow} />
      )}

      {episode.is_creator && episode.box_score && <SlidingDoors episodeId={episode.id} />}

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
              You picked {ENDING_LABELS[episode.my_pick]}
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

      <EpisodeActions
        episodeId={episode.id}
        sharePath={episode.share_path}
        isCreator={episode.is_creator}
        isHost={episode.is_host}
        revealed={episode.revealed}
        names={names}
        dramaQuestion={episode.drama_question}
        myPick={episode.my_pick}
        myDramaPick={episode.my_drama_pick}
      />

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

      <SafetyActions episodeId={episode.id} canBlock={canBlock} blocked={episode.blocked} />

      <p className="muted">
        Your points: {points}. <Link href="/feed">More episodes</Link>
      </p>
    </article>
  );
}
