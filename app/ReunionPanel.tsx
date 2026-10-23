import Link from "next/link";
import Avatar from "@/app/Avatar";
import type { Reunion, ReunionChar } from "@/lib/reunion";
import { endingLabel } from "@/lib/rules";
import CharacterName from "@/app/CharacterName";
import Pager from "@/app/Pager";
import { pageOf } from "@/lib/paging";

/** "Where they stand": this many couples a page. */
const COUPLES_PAGE = 10;
/** Shown before "Show all" (UX audit 2026-10-23: all 13 pairings were ~2,200px on a phone): couples, then confessionals. */
const COUPLES_SHOWN = 5;
const CONFESSIONALS_SHOWN = 3;

function Face({ c, size = 34 }: { c: ReunionChar; size?: number }) {
  return (
    <Link href={`/characters/${c.id}`} className="reunion-face">
      <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={size} />
    </Link>
  );
}

/**
 * The reunion special, on /reunion (Watch links it from one card): the season's awards, the couples board and
 * the shared confessional reel. Renders nothing until there's aired history to assemble, so an empty season
 * stays quiet. Data comes from lib/reunion.ts (getReunion).
 */
export default function ReunionPanel({
  reunion,
  heading = "h2",
  couplesPage = 1,
  couplesHref,
  hidden,
}: {
  reunion: Reunion;
  heading?: "h1" | "h2";
  /** The couples board's page, and where each page is (?couples=N on /reunion); without an href, it isn't paged. */
  couplesPage?: number;
  couplesHref?: (page: number) => string;
  /** The private characters among them (lib/directory.ts privateAmong): their names only, never linked. */
  hidden?: Set<string>;
}) {
  const named = (c: ReunionChar) => ({ ...c, private: hidden?.has(c.id) ?? false });
  const Title = heading;
  const hasContent = reunion.couples.length > 0 || reunion.confessionals.length > 0 || reunion.awards.length > 0;
  if (!hasContent) return null;
  const couples = couplesHref ? pageOf(reunion.couples, couplesPage, COUPLES_PAGE) : { items: reunion.couples, page: 1, pages: 1 };
  const coupleRow = (couple: Reunion["couples"][number]) => (
    <li key={`${couple.a.id}-${couple.b.id}`} className="card reunion-couple">
      <span className="pair-faces">
        <Face c={couple.a} />
        <Face c={couple.b} />
      </span>
      <div className="meta">
        <strong>
          <CharacterName character={named(couple.a)} avatar={false} /> × <CharacterName character={named(couple.b)} avatar={false} />
        </strong>{" "}
        <span className="badge">{couple.stage}</span>
        <p className="muted">
          {couple.dates} {couple.dates === 1 ? "date" : "dates"}
          {couple.second_dates > 0 && `, ${couple.second_dates} second`}
          {couple.last_ending && ` · last: ${endingLabel(couple.last_ending, couple.dates)}`}
        </p>
      </div>
    </li>
  );
  const confessionalRow = (c: Reunion["confessionals"][number], i: number) => (
    <li key={`${c.episode_id}-${i}`} className="card reunion-confessional">
      <Face c={c.character} />
      <div>
        <p className="confessional">“{c.line}”</p>
        <p className="muted">
          <CharacterName character={named(c.character)} avatar={false} strong /> · <Link href={`/episodes/${c.episode_id}`}>see the date</Link>
        </p>
      </div>
    </li>
  );

  return (
    <section className="reunion-panel">
      <p className="kicker">Season special</p>
      <Title>The Reunion</Title>
      <p className="muted reunion-stats">
        The cast back under the lights. <strong>{reunion.stats.aired}</strong> dates aired ·{" "}
        <strong>{reunion.stats.couples}</strong> {reunion.stats.couples === 1 ? "pairing" : "pairings"} ·{" "}
        <strong>{reunion.stats.second_dates}</strong> second dates
      </p>

      {reunion.awards.length > 0 && (
        <div className="boards">
          {reunion.awards.map((award) => (
            <div key={award.title} className="card award">
              <h3>{award.title}</h3>
              <div className="award-body">
                <div className="reunion-faces">
                  {award.chars.map((c) => (
                    <Face key={c.id} c={c} size={40} />
                  ))}
                </div>
                <div>
                  <p className="award-name">{award.name}</p>
                  <p className="muted">{award.detail}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {reunion.couples.length > 0 && (
        <>
          <h3 className="section" id="couples">
            Where they stand
          </h3>
          <ul className="list">{couples.items.slice(0, COUPLES_SHOWN).map(coupleRow)}</ul>
          {couples.items.length > COUPLES_SHOWN && (
            // Later pages (?couples=N) open it: someone paging through wants them all.
            <details className="show-more" open={couples.page > 1}>
              <summary>Show more ({reunion.couples.length} in all)</summary>
              <ul className="list">{couples.items.slice(COUPLES_SHOWN).map(coupleRow)}</ul>
              {couplesHref && <Pager page={couples.page} pages={couples.pages} label="Couples pages" href={couplesHref} scroll={false} />}
            </details>
          )}
          {couples.items.length <= COUPLES_SHOWN && couplesHref && <Pager page={couples.page} pages={couples.pages} label="Couples pages" href={couplesHref} scroll={false} />}
        </>
      )}

      {reunion.confessionals.length > 0 && (
        <>
          <h3 className="section">The confessional reel</h3>
          <p className="muted">The private reflections their creators chose to share.</p>
          <ul className="list">{reunion.confessionals.slice(0, CONFESSIONALS_SHOWN).map(confessionalRow)}</ul>
          {reunion.confessionals.length > CONFESSIONALS_SHOWN && (
            <details className="show-more">
              <summary>{reunion.confessionals.length - CONFESSIONALS_SHOWN} more</summary>
              <ul className="list">{reunion.confessionals.slice(CONFESSIONALS_SHOWN).map((c, i) => confessionalRow(c, i + CONFESSIONALS_SHOWN))}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
