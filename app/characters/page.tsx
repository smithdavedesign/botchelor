import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import CharacterName from "@/app/CharacterName";
import Pager from "@/app/Pager";
import JsonLd from "@/app/JsonLd";
import OriginBadge from "@/app/OriginBadge";
import { getDb } from "@/lib/db";
import { directoryEntries, listTab, offSeasonHouse, privateAmong, tabCounts, type DirectoryEntry } from "@/lib/directory";
import { userIdFromCookieStore } from "@/lib/http";
import { listCast, listMyProposals, listRelationshipEdges } from "@/lib/mechanics";
import { parseTab, TAB_LABEL, tabHref, TABS, type Tab } from "@/lib/origin";
import { topRatedCharacters } from "@/lib/ratings";
import { endingLabel, RATING_CATEGORIES } from "@/lib/rules";
import { seasonCastIds } from "@/lib/season-cast";
import { listCandidates } from "@/lib/season-gen";
import { nextSeasonStart, seasonIdOf, seasonLabel } from "@/lib/season-window";
import { itemListJsonLd } from "@/lib/seo";
import { pageHref, pageOf as pageSlice, parsePage } from "@/lib/paging";
import MatchmakerForm from "./MatchmakerForm";

export const dynamic = "force-dynamic";

type Search = { tab?: string | string[]; page?: string | string[]; pairs?: string | string[] };

/** The relationship graph on the cast tab: this many couples a page (?pairs=N). */
const PAIRS_PAGE = 10;
type Props = { searchParams: Promise<Search> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pageOf = (v: string | string[] | undefined) => Math.max(1, Math.floor(Number(one(v) ?? 1)) || 1);

const DESCRIPTIONS: Record<Tab, string> = {
  cast: "Botchelor's cast: this month's house characters, next month's newcomers, the audience leaderboard and the relationship graph.",
  people: "Original characters made by people on Botchelor, looking for love on the show.",
  agents: "Original characters made by AI agents over MCP, dating on Botchelor.",
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const tab = parseTab(one(sp.tab));
  const page = pageOf(sp.page);
  return {
    title: tab === "cast" ? "Characters on Botchelor: the cast" : `Characters on Botchelor: ${TAB_LABEL[tab].toLowerCase()}`,
    description: DESCRIPTIONS[tab],
    alternates: { canonical: tabHref(tab, tab === "cast" ? 1 : page) },
  };
}

/** A private character's name (David, #309/#509): never linked, no portrait, no details. */
function PrivateName({ name }: { name: string }) {
  return (
    <span className="directory-private">
      <strong>{name}</strong> <span aria-label="private">🔒</span>
    </span>
  );
}

/** `origin={false}` on the cast tab, where every card is the show's own and a "Cast" chip on each says nothing. */
function Entry({ e, badge, origin = true }: { e: DirectoryEntry; badge?: string; origin?: boolean }) {
  if (e.private) {
    return (
      <li className="card is-private">
        <div className="char">
          <Avatar seed={e.id} name={e.name} hue={null} house={false} size={48} />
          <div className="meta">
            <PrivateName name={e.name} />
          </div>
        </div>
        <p className="muted small">Private: their creator keeps them to themselves.</p>
      </li>
    );
  }
  return (
    <li className="card tap-card">
      <div className="char">
        <Avatar seed={e.id} name={e.name} hue={e.hue} house={e.house} portraitSrc={e.portrait} size={48} />
        <div className="meta">
          <CharacterName character={e} avatar={false} strong className="stretch" />
          {origin && <OriginBadge origin={e.origin} />}
          {badge && <span className="badge">{badge}</span>}
          {e.reviews > 0 && (
            <span className="muted small">
              {" "}
              {e.stars?.toFixed(1)} ★ · {e.reviews}
            </span>
          )}
        </div>
      </div>
      {/* The basics: age and pronouns, then what they do and where they're from (only what's filled in). */}
      {(e.age || e.pronouns) && <p className="muted small dir-basics">{[e.age, e.pronouns].filter(Boolean).join(" · ")}</p>}
      {(e.occupation || e.hometown) && <p className="small dir-job">{[e.occupation ? `💼 ${e.occupation}` : null, e.hometown ? `📍 ${e.hometown}` : null].filter(Boolean).join(" · ")}</p>}
      <ul className="chips">
        {e.traits.slice(0, 3).map((trait) => (
          <li className="chip" key={trait}>
            {trait}
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * The Characters hub (David, 2026-10-21): one page, three tabs, each a plain link so it's crawlable and needs no
 * script. The cast: this month's house characters, next month's candidates, and what /cast had (the leaderboard,
 * matchmaking, the relationship graph). People's characters and agent-made ones: everyone public, newest first, 24
 * a page. A private character is on no tab.
 */
export default async function CharactersPage({ searchParams }: Props) {
  const sp = await searchParams;
  const tab = parseTab(one(sp.tab));
  const db = await getDb();
  const now = new Date();
  const thisId = seasonIdOf(now);
  const castIds = seasonCastIds(now);
  const [season, counts] = await Promise.all([directoryEntries(db, castIds), tabCounts(db)]);
  const count: Record<Tab, number> = { cast: season.length, people: counts.people, agents: counts.agents };

  return (
    <article className="characters-hub">
      {/* 2026-10-31 UX audit: on a phone the first screen was all words (a paragraph restating the tabs, a helper line,
          the season's rules) and no faces. One line each now, and the cards are two to a row. */}
      <div className="section-head characters-head">
        <h1>Characters</h1>
        {/* The way in for anyone browsing (David, 2026-10-25: "we don't have one, we should have one here"). Outlined: the
            nav's "Make your character" is the filled one, and it's the same words. */}
        <Link className="button secondary" href="/create">
          Make your character
        </Link>
      </div>
      <p className="muted">Everyone on the show: the cast, and the characters people and AI agents made.</p>
      <nav className="segmented" aria-label="Characters">
        {TABS.map((t) => (
          <Link key={t} href={tabHref(t)} className="segmented-tab" aria-current={t === tab ? "page" : undefined}>
            {TAB_LABEL[t]} <span className="segmented-count">{count[t]}</span>
          </Link>
        ))}
      </nav>
      {/* Awaited here, not rendered as async components, so the whole page is one server render (and testable). */}
      {tab === "cast" ? await castTab({ season, thisId, castIds, now, pairsPage: parsePage(sp.pairs) }) : await madeByTab({ tab, page: pageOf(sp.page), privateCount: counts.private })}
    </article>
  );
}

async function castTab({ season, thisId, castIds, now, pairsPage }: { season: DirectoryEntry[]; thisId: string; castIds: string[]; now: Date; pairsPage: number }) {
  const viewerId = userIdFromCookieStore(await cookies());
  const db = await getDb();
  const nextId = seasonIdOf(nextSeasonStart(now));
  const candidates = (await listCandidates(db, nextId)).filter((c) => c.status !== "rejected");
  const candidateIds = candidates.map((c) => c.character_id);
  const [upcoming, earlier, cast, edges, proposals, boards] = await Promise.all([
    directoryEntries(db, candidateIds),
    offSeasonHouse(db, [...castIds, ...candidateIds]),
    listCast(db),
    listRelationshipEdges(db),
    viewerId ? listMyProposals(db, viewerId) : Promise.resolve([]),
    Promise.all(RATING_CATEGORIES.map((c) => topRatedCharacters(db, c.id))),
  ]);
  const statusOf = new Map(candidates.map((c) => [c.character_id, c.status]));
  // The matchmaker picks from public characters only: a private one stays its creator's.
  // The leaderboard and the relationship graph show a private one by name only (#509's rule).
  const hidden = await privateAmong(db, [...cast.map((c) => c.id), ...boards.flat().map((t) => t.id), ...edges.flatMap((e) => [e.a_id, e.b_id])]);
  const matchable = cast.filter((c) => !hidden.has(c.id));
  const pairs = pageSlice(edges, pairsPage, PAIRS_PAGE);
  // Faces for the graph's names: the cast already carries each one's colour and portrait; anyone not in it (an
  // off-season house character) still gets a face from its id.
  const castById = new Map(cast.map((c) => [c.id, c]));
  const named = (id: string, name: string) => castById.get(id) ?? { id, name };
  const leaderboards = RATING_CATEGORIES.map((c, i) => ({ category: c, top: boards[i] })).filter((b) => b.top.length > 0);

  return (
    <>
      <JsonLd data={itemListJsonLd("The Botchelor cast", season.map((e) => ({ name: e.name, path: `/characters/${e.id}` })))} />
      <section>
        <h2>This season: {seasonLabel(thisId)}</h2>
        <p className="muted">The show&apos;s own. Each month the two best-reviewed stay and two newcomers join.</p>
        <ul className="gallery">
          {season.map((e) => (
            <Entry key={e.id} e={e} origin={false} />
          ))}
        </ul>
      </section>

      {/* Shown once there are candidates (2026-10-31 UX audit, A4: for most of the month it only said "check back"). */}
      {upcoming.length > 0 && (
        <section id="next-season">
          <h2>Next season&apos;s candidates: {seasonLabel(nextId)}</h2>
          <ul className="gallery">
            {upcoming.map((e) => (
              <Entry key={e.id} e={e} origin={false} badge={statusOf.get(e.id) === "approved" ? "Joining next season" : "Candidate"} />
            ))}
          </ul>
        </section>
      )}

      {leaderboards.length > 0 && (
        // One row of each board's leader, the full boards folded (A4: the boards were ~520px of the cast tab).
        <section className="top-rated">
          <h2>Top rated</h2>
          <ul className="top-rated-strip">
            {leaderboards.map(({ category, top }) => (
              <li key={category.id} className="top-rated-item">
                <span className="muted small">
                  {category.emoji} {category.board}
                </span>
                {hidden.has(top[0].id) ? <PrivateName name={top[0].name} /> : <CharacterName character={top[0]} size={28} />}
              </li>
            ))}
          </ul>
          <details className="ux-fold top-rated-more">
            <summary>The full audience leaderboard</summary>
            <p className="muted small">Just for fun: ratings never change a date, the odds or prediction points.</p>
          <div className="boards">
            {leaderboards.map(({ category, top }) => (
              <div key={category.id} className="card board">
                <h3>
                  {category.emoji} {category.board}
                </h3>
                <ol className="board-list">
                  {top.map((t) => (
                    <li key={t.id}>
                      {hidden.has(t.id) ? (
                        <>
                          <Avatar seed={t.id} name={t.name} hue={null} house={false} size={28} />
                          <PrivateName name={t.name} />
                        </>
                      ) : (
                        <CharacterName character={t} size={28} />
                      )}
                      <span className="board-count">{t.count}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          </details>
        </section>
      )}

      <MatchmakerForm cast={matchable} />

      {proposals.length > 0 && (
        <section>
          <h2>Your matchmaking</h2>
          <ul className="list">
            {proposals.map((p) => (
              <li key={p.id} className="card">
                <strong>
                  <CharacterName character={p.character_a} /> + <CharacterName character={p.character_b} />
                </strong>{" "}
                <span className="badge">{p.paid_off ? "Second date! Points earned" : "Waiting"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section id="graph">
        <h2>The relationship graph</h2>
        <p className="muted small">
          <Link href="/graph">See it as a constellation →</Link>
        </p>
        {edges.length ? (
          // Folded (2026-10-31 UX audit: every pairing was a card in the page, a screen or two on a phone); paging opens it.
          <details className="ux-fold graph-pairs" open={pairs.page > 1}>
          <summary>
            Who&apos;s dated whom ({edges.length} {edges.length === 1 ? "pair" : "pairs"})
          </summary>
          <ul className="list">
            {pairs.items.map((e) =>
              hidden.has(e.a_id) || hidden.has(e.b_id) ? (
                // A couple with a private character: the names only, never linked, nothing about their dates.
                <li key={`${e.a}-${e.b}`} className="card is-private">
                  {hidden.has(e.a_id) ? <PrivateName name={e.a} /> : <strong>{e.a}</strong>} ×{" "}
                  {hidden.has(e.b_id) ? <PrivateName name={e.b} /> : <strong>{e.b}</strong>}
                </li>
              ) : (
              <li key={`${e.a}-${e.b}`} className="card graph-row">
                {/* One link to the couple; the faces sit inside it unlinked (no nested anchors). */}
                <Link className="pair-link" href={`/couples/${e.a_id}/${e.b_id}`}>
                  <CharacterName character={named(e.a_id, e.a)} link={false} strong />
                  <span className="pair-x">×</span>
                  <CharacterName character={named(e.b_id, e.b)} link={false} strong />
                </Link>
                <span className="badge">{e.stage}</span>{" "}
                <span className="muted">
                  {e.dates} {e.dates === 1 ? "date" : "dates"}
                  {e.second_dates > 0 && `, ${e.second_dates} second`}
                  {e.last_ending && ` · last: ${endingLabel(e.last_ending, e.dates)}`}
                </span>
              </li>
              ),
            )}
          </ul>
          <Pager page={pairs.page} pages={pairs.pages} label="Relationship graph pages" href={(n) => pageHref("/characters", {}, "pairs", n, "graph")} scroll={false} />
          </details>
        ) : (
          <p className="muted">No dates yet. Once characters start meeting, their history shows up here.</p>
        )}
      </section>

      {earlier.length > 0 && (
        <details className="earlier-cast ux-fold">
          <summary>Off this season ({earlier.length})</summary>
          <p className="muted small">House characters from earlier seasons, and the premium ones. Their cards and dates stay up.</p>
          <ul className="gallery">
            {earlier.map((e) => (
              <Entry key={e.id} e={e} origin={false} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

async function madeByTab({ tab, page, privateCount }: { tab: "people" | "agents"; page: number; privateCount: number }) {
  const db = await getDb();
  const list = await listTab(db, tab, page);
  const what = tab === "people" ? "characters made by people" : "characters made by AI agents";
  return (
    <section>
      <JsonLd data={itemListJsonLd(`Botchelor: ${what}`, list.entries.filter((e) => !e.private).map((e) => ({ name: e.name, path: `/characters/${e.id}` })))} />
      <p className="muted">
        {tab === "people" ? (
          <>
            Original characters people built on the site. <Link href="/create">Make your own</Link>.
          </>
        ) : (
          <>
            Original characters AI agents built over MCP. A few are run by the show&apos;s own scripts: those say
            &ldquo;House-run bot&rdquo;. <Link href="/agents">Send your agent</Link>.
          </>
        )}
        {privateCount > 0 && <> A private character (🔒) shows only its name.</>}
      </p>
      {list.entries.length ? (
        <ul className="gallery">
          {list.entries.map((e) => (
            <Entry key={e.id} e={e} />
          ))}
        </ul>
      ) : (
        <p className="muted">None yet.</p>
      )}
      <Pager page={list.page} pages={list.pages} label={`${TAB_LABEL[tab]} pages`} href={(n) => tabHref(tab, n)} prev="Newer" next="Older" />
    </section>
  );
}
