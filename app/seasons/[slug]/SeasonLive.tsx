import Link from "next/link";
import Avatar from "@/app/Avatar";
import Icon from "@/app/Icon";
import VenuePhoto from "@/app/VenuePhoto";
import When from "@/app/When";
import { countWord } from "@/lib/season-format";
import { SEASON_PREMISE, type ScheduleLine, type SeasonLiveData, type Starter, type SuitorCard } from "@/lib/season-page";

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** "Sunday, December 6": a ceremony's day as the show holds it (UTC). */
const sundayWords = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/** One starter, Watch's latest-list card (app/EpisodeItem.tsx): the place's photo with both faces, the names, the title, the setting. It plays. */
function StarterCard({ starter, first }: { starter: Starter; first: boolean }) {
  const { a, b } = starter;
  return (
    <li className="card episode-item tap-card season-live-starter">
      <VenuePhoto venue={starter.venue} className="episode-item-photo" eager={first}>
        <span className="pair-faces">
          <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={44} decorative eager={first} />
          <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={44} decorative eager={first} />
        </span>
        <span className="photo-chip">
          <Icon name="play" /> Play
        </span>
      </VenuePhoto>
      <div className="episode-item-body">
        {/* Straight into the theater (?play=1): the date from its first line. */}
        <Link className="stretch episode-item-names" href={`/episodes/${starter.id}?play=1`} data-track="season-starter">
          <strong>
            <span className="nowrap">{a.name} ×</span> <span className="nowrap">{b.name}</span>
          </strong>
        </Link>
        {starter.title && <span className="episode-item-title">“{starter.title}”</span>}
        <p className="muted episode-item-setting">{starter.line}</p>
      </div>
    </li>
  );
}

function suitorLine(s: SuitorCard, lead: string): string {
  if (s.state === "final_rose") return "The final rose";
  if (s.state === "runner_up") return "Runner-up";
  if (s.state === "left") return "Left the show";
  if (s.state === "out") {
    const by = s.by === "vote" ? ", by your vote" : s.by === "lead" ? `, by ${lead}'s dates` : "";
    return s.went_home_on ? `Went home ${sundayWords(s.went_home_on)}${by}` : "Went home";
  }
  return "Still in";
}

/** "Five still in", or, with nobody left in the running (after the final rose), the cast as a whole. */
function suitorsHeading(suitors: SuitorCard[] | null): string {
  if (!suitors?.length) return "Picked as the season starts";
  const still = suitors.filter((s) => s.state === "in").length;
  if (!still) return "This season's suitors";
  const n = countWord(still);
  return `${n.charAt(0).toUpperCase()}${n.slice(1)} still in`;
}

function ScheduleWhen({ line }: { line: ScheduleLine }) {
  return "words" in line.when ? <>{line.when.words}</> : <When iso={line.when.iso} style={line.when.style} />;
}

/**
 * The watch-first page of a lead season (lib/season-page.ts, docs/season-page.md), before it starts and while it runs:
 * what the month is, three of the lead's dates that play at once, the lead, the suitors, when things happen, and one
 * line on how the month differs from the others. Phone first: the hero is short, so the first date is on the first
 * screen at 390 px. Every part with nothing to show is left out, never an empty box.
 */
export default function SeasonLive({ data }: { data: SeasonLiveData }) {
  const { season, month, def, phase, arc, lead, starters, casting, suitors, schedule, contrast, premiere } = data;
  const leadShort = lead?.short ?? "the lead";
  return (
    <article className="season-live page-wide">
      <header className="card season-now season-live-hero">
        <p className="kicker">
          Season {season.number} · {month} · {def.title}
        </p>
        <h1>{SEASON_PREMISE}</h1>
        <p className="season-now-note">{def.pitch}</p>
        <p className="season-now-clock">
          {arc ? (
            <>
              Night {arc.night} of {arc.nights} ·{" "}
              {arc.to === "end" ? `${days(arc.left)} left in the season` : arc.left === 0 ? "the finale is tonight" : `${days(arc.left)} to the finale`}
            </>
          ) : (
            <>
              Starts <When iso={data.starts_at} style="day-time" />
            </>
          )}
        </p>
        {premiere && <PremiereLine premiere={premiere} />}
      </header>

      {starters.length > 0 && (
        <section className="season-live-starters" aria-labelledby="season-starters-head" data-track-area="season-starters">
          <h2 id="season-starters-head">
            Start here: {countWord(starters.length)} {starters.length === 1 ? "date" : "dates"}
          </h2>
          <p className="muted small">
            {lead ? `${lead.short}'s dates` : "The lead's dates"}
            {phase === "preseason" ? " before the season" : ""}, from the first line to how it ends. Press one and it plays.
          </p>
          <ul className="watch-latest-list season-live-starter-list">
            {starters.map((s, i) => (
              <StarterCard key={s.id} starter={s} first={i === 0} />
            ))}
          </ul>
        </section>
      )}

      <div className="season-live-cast">
        <section className="card season-live-lead" aria-labelledby="season-lead-head">
          <p className="kicker">The lead</p>
          {lead ? (
            <div className="season-live-lead-row">
              <Avatar seed={lead.id} name={lead.name} hue={lead.hue} house={lead.house} portraitSrc={lead.portrait} size={96} decorative />
              <div className="season-live-lead-text">
                <h2 id="season-lead-head">
                  <Link href={`/characters/${lead.id}`}>{lead.name}</Link>
                </h2>
                <p>{lead.bio}</p>
                {lead.wants && (
                  <p className="small">
                    <strong>Wants:</strong> {lead.wants}
                  </p>
                )}
                <p className="small">
                  <Link href={`/characters/${lead.id}`}>{lead.short}&apos;s page →</Link>
                </p>
              </div>
            </div>
          ) : (
            <>
              <h2 id="season-lead-head">Named when {month} starts</h2>
              <p className="muted small">The lead is one of the house cast: the most reviewed of last season&apos;s, unless the show picks one first.</p>
            </>
          )}
        </section>

        <section className="card season-live-suitors" aria-labelledby="season-suitors-head">
          <p className="kicker">The suitors</p>
          {casting ? (
            <>
              <h2 id="season-suitors-head">Casting is open: {countWord(casting.places)} places, the audience votes</h2>
              {casting.auditions && casting.auditions.length > 0 ? (
                <ol className="casting-slots season-live-faces" aria-label="Most votes first">
                  {casting.auditions.map((a) => (
                    <li key={a.character_id} className="casting-slot is-taken tap-card">
                      <Avatar seed={a.character_id} name={a.name} hue={a.hue} portraitSrc={a.portrait} size={56} decorative />
                      <span className="casting-slot-text">
                        <Link className="stretch" href={`/characters/${a.character_id}`}>
                          <strong>{a.name}</strong>
                        </Link>
                        <span className="muted small">
                          {a.votes} vote{a.votes === 1 ? "" : "s"}
                        </span>
                        {a.status === "approved" && <span className="chip">Shortlisted</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                casting.auditions && <p className="muted small">Nobody has applied yet: the first character in could take a place.</p>
              )}
              <p className="small">
                <Link href="/casting" data-track="season-casting">
                  Apply or vote →
                </Link>
              </p>
            </>
          ) : (
            <>
              <h2 id="season-suitors-head">{suitorsHeading(suitors)}</h2>
              {suitors && suitors.length > 0 ? (
                <ul className="casting-slots season-live-faces">
                  {suitors.map((s) => (
                    <li key={s.id} className={`casting-slot is-taken tap-card${s.state === "in" || s.state === "final_rose" ? "" : " is-out"}`}>
                      <Avatar seed={s.id} name={s.name} hue={s.hue} house={s.house} portraitSrc={s.portrait} size={56} decorative />
                      <span className="casting-slot-text">
                        <Link className="stretch" href={`/characters/${s.id}`}>
                          <strong>{s.name}</strong>
                        </Link>
                        <span className="muted small">{suitorLine(s, leadShort)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">The shortlisted applicants with the most votes take the places on the 1st.</p>
              )}
            </>
          )}
        </section>
      </div>

      {schedule.length > 0 && (
        <section className="card season-live-when" aria-labelledby="season-when-head">
          <h2 id="season-when-head">When things happen</h2>
          <ul className="season-live-schedule">
            {schedule.map((line) => (
              <li key={line.key}>
                <span className="season-live-time">
                  <ScheduleWhen line={line} />
                </span>
                <span>{line.what}</span>
              </li>
            ))}
            {/* Brief F's Sunday premiere (nextPremiere, lib/sunday-premiere.ts) gets one line here once it ships. */}
          </ul>
          {contrast && <p className="muted small season-live-contrast">{contrast}</p>}
        </section>
      )}

      <p className="muted small season-live-more">
        <Link href="/watch">Watch what&apos;s on →</Link> · <Link href="/reunion">The Reunion →</Link> · <Link href="/seasons">Every season →</Link>
      </p>
    </article>
  );
}

/** The next Sunday premiere (lib/sunday-premiere.ts nextPremiere): when, and its room once the job has built it. */
function PremiereLine({ premiere }: { premiere: NonNullable<SeasonLiveData["premiere"]> }) {
  const name = premiere.kind === "pilot" ? "The pilot, Meet the lead" : premiere.finale ? "The finale's premiere" : "Sunday's premiere";
  return (
    <p className="season-live-premiere" data-track-area="season-premiere">
      <span className="chip">{premiere.state === "live" ? "Live now" : "Next"}</span> {name}
      {premiere.suitor ? `: ${premiere.lead.name.split(" ")[0]} and ${premiere.suitor.name.split(" ")[0]}` : ""} ·{" "}
      <When iso={premiere.at} style="day-time" />
      {premiere.room_path && (
        <>
          {" "}
          · <Link href={premiere.room_path}>{premiere.state === "live" ? "Watch now →" : "Take your seat →"}</Link>
        </>
      )}
    </p>
  );
}
