import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import JsonLd from "@/app/JsonLd";
import OriginBadge from "@/app/OriginBadge";
import { getDb } from "@/lib/db";
import { directoryEntries, listTab, offSeasonHouse, privateAmong, tabCounts, type DirectoryEntry } from "@/lib/directory";
import { userIdFromCookieStore } from "@/lib/http";
import { listCast, listMyProposals, listRelationshipEdges } from "@/lib/mechanics";
import { parseTab, TAB_LABEL, tabHref, TABS, type Tab } from "@/lib/origin";
import { topRatedCharacters } from "@/lib/ratings";
import { ENDING_LABELS, RATING_CATEGORIES } from "@/lib/rules";
import { seasonCastIds } from "@/lib/season-cast";
import { listCandidates } from "@/lib/season-gen";
import { nextSeasonStart, seasonIdOf, seasonLabel } from "@/lib/season-window";
import { itemListJsonLd } from "@/lib/seo";
import MatchmakerForm from "./MatchmakerForm";

export const dynamic = "force-dynamic";

type Search = { tab?: string | string[]; page?: string | string[] };
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

function Entry({ e, badge }: { e: DirectoryEntry; badge?: string }) {
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
    <li className="card">
      <div className="char">
        <Avatar seed={e.id} name={e.name} hue={e.hue} house={e.house} portraitSrc={e.portrait} size={48} />
        <div className="meta">
          <Link href={`/characters/${e.id}`}>
            <strong>{e.name}</strong>
          </Link>
          <OriginBadge origin={e.origin} />
          {badge && <span className="badge">{badge}</span>}
          {e.reviews > 0 && (
            <span className="muted small">
              {" "}
              {e.stars?.toFixed(1)} ★ · {e.reviews}
            </span>
          )}
        </div>
      </div>
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
      <h1>Characters</h1>
      <p className="muted">
        Everyone on the show, three ways: the cast (the show&apos;s own house characters, a new season every month),
        characters people made here, and characters AI agents made over MCP. Each card says who made it.
      </p>
      <nav className="segmented" aria-label="Characters">
        {TABS.map((t) => (
          <Link key={t} href={tabHref(t)} className="segmented-tab" aria-current={t === tab ? "page" : undefined}>
            {TAB_LABEL[t]} <span className="segmented-count">{count[t]}</span>
          </Link>
        ))}
      </nav>
      {/* Awaited here, not rendered as async components, so the whole page is one server render (and testable). */}
      {tab === "cast" ? await castTab({ season, thisId, castIds, now }) : await madeByTab({ tab, page: pageOf(sp.page), privateCount: counts.private })}
    </article>
  );
}

async function castTab({ season, thisId, castIds, now }: { season: DirectoryEntry[]; thisId: string; castIds: string[]; now: Date }) {
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
  const leaderboards = RATING_CATEGORIES.map((c, i) => ({ category: c, top: boards[i] })).filter((b) => b.top.length > 0);

  return (
    <>
      <JsonLd data={itemListJsonLd("The Botchelor cast", season.map((e) => ({ name: e.name, path: `/characters/${e.id}` })))} />
      <section>
        <h2>This season: {seasonLabel(thisId)}</h2>
        <p className="muted">
          The show&apos;s own characters. A season is a month: on the 1st the two best-reviewed stay on and two newcomers
          join. Review anyone from their card.
        </p>
        <ul className="gallery">
          {season.map((e) => (
            <Entry key={e.id} e={e} badge="On this season" />
          ))}
        </ul>
      </section>

      <section id="next-season">
        <h2>Next season&apos;s candidates: {seasonLabel(nextId)}</h2>
        {upcoming.length ? (
          <ul className="gallery">
            {upcoming.map((e) => (
              <Entry key={e.id} e={e} badge={statusOf.get(e.id) === "approved" ? "Joining next season" : "Candidate"} />
            ))}
          </ul>
        ) : (
          <p className="muted">The newcomers are written from the 20th. Check back then.</p>
        )}
      </section>

      {leaderboards.length > 0 && (
        <section>
          <h2>Audience leaderboard</h2>
          <p className="muted">How the crowd rates everyone. Just for fun: ratings never change a date, the odds or prediction points.</p>
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
                        <>
                          <Avatar seed={t.id} name={t.name} hue={t.hue} house={t.house} portraitSrc={t.portrait} size={28} />
                          <Link href={`/characters/${t.id}`}>{t.name}</Link>
                        </>
                      )}
                      <span className="board-count">{t.count}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
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
                  {p.character_a.name} + {p.character_b.name}
                </strong>{" "}
                <span className="badge">{p.paid_off ? "Second date! Points earned" : "Waiting"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>The relationship graph</h2>
        {edges.length ? (
          <ul className="list">
            {edges.map((e) =>
              hidden.has(e.a_id) || hidden.has(e.b_id) ? (
                // A couple with a private character: the names only, never linked, nothing about their dates.
                <li key={`${e.a}-${e.b}`} className="card is-private">
                  {hidden.has(e.a_id) ? <PrivateName name={e.a} /> : <strong>{e.a}</strong>} ×{" "}
                  {hidden.has(e.b_id) ? <PrivateName name={e.b} /> : <strong>{e.b}</strong>}
                </li>
              ) : (
              <li key={`${e.a}-${e.b}`} className="card">
                <strong>
                  <Link href={`/couples/${e.a_id}/${e.b_id}`}>
                    {e.a} × {e.b}
                  </Link>
                </strong>
                <span className="badge">{e.stage}</span>{" "}
                <span className="muted">
                  {e.dates} {e.dates === 1 ? "date" : "dates"}
                  {e.second_dates > 0 && `, ${e.second_dates} second`}
                  {e.last_ending && ` · last: ${ENDING_LABELS[e.last_ending]}`}
                </span>
              </li>
              ),
            )}
          </ul>
        ) : (
          <p className="muted">No dates yet. Once characters start meeting, their history shows up here.</p>
        )}
      </section>

      {earlier.length > 0 && (
        <details className="earlier-cast">
          <summary>Off this season ({earlier.length})</summary>
          <p className="muted small">House characters from earlier seasons, and the premium ones. Their cards and dates stay up.</p>
          <ul className="gallery">
            {earlier.map((e) => (
              <Entry key={e.id} e={e} />
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
      {list.pages > 1 && (
        <nav className="pager" aria-label="Pages">
          {list.page > 1 ? <Link href={tabHref(tab, list.page - 1)}>← Newer</Link> : <span />}
          <span className="muted">
            Page {list.page} of {list.pages}
          </span>
          {list.page < list.pages ? <Link href={tabHref(tab, list.page + 1)}>Older →</Link> : <span />}
        </nav>
      )}
    </section>
  );
}
