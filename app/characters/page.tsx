import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import Avatar from "@/app/Avatar";
import Icon from "@/app/Icon";
import { balancedColumns } from "@/lib/grid-balance";
import CharacterName from "@/app/CharacterName";
import Pager from "@/app/Pager";
import JsonLd from "@/app/JsonLd";
import OriginBadge from "@/app/OriginBadge";
import { forViewer, shared } from "@/lib/shared-cache";
import { crowdLine, isInsider } from "@/lib/crowd-threshold";
import { getDb } from "@/lib/db";
import TalkButton from "@/app/companion/TalkButton";
import CharactersTabs from "./CharactersTabs";
import { companionOpen } from "@/lib/companion-shared";
import { DIRECTORY_QUERY_MAX, DIRECTORY_SEARCH_LIMIT, directoryEntries, listTab, offSeasonHouse, ownCharacterIds, parseDirectoryQuery, privateAmong, searchDirectory, tabCounts, type DirectoryEntry } from "@/lib/directory";
import { authFromCookieStore } from "@/lib/http";
import { stepInAccessFromCookies } from "@/lib/step-in-access";
import { actionsFor, type CardActions, cardVerbLabel, type TextAccess, textVerb, type VerbViewer, viewerCharacter } from "@/lib/character-verb";
import { rememberedCharacter } from "@/lib/current-character";
import { shortName } from "@/lib/names";
import { listCast, listMyProposals, listRelationshipEdges } from "@/lib/mechanics";
import { isAgentMade, parseTab, TAB_LABEL, tabHref, TABS, type Tab } from "@/lib/origin";
import { topRatedCharacters } from "@/lib/ratings";
import { endingLabel, RATING_CATEGORIES } from "@/lib/rules";
import { seasonCastIds } from "@/lib/season-cast";
import { castDatePrize } from "@/lib/cast-date";
import CastDatePrize from "@/app/CastDatePrize";
import { listCandidates } from "@/lib/season-gen";
import { nextSeasonStart, seasonIdOf, seasonLabel } from "@/lib/season-window";
import { itemListJsonLd, pageMetadata } from "@/lib/seo";
import { pageHref, pageOf as pageSlice, parsePage } from "@/lib/paging";
import MatchmakerForm from "./MatchmakerForm";
import GraphTeaser from "@/app/graph/GraphTeaser";
import { graphTeaser, type GraphTeaser as Teaser } from "@/app/graph/teaser";
import { cachedConstellation } from "@/lib/graph-cache";
import type { OriginGroup, SkyGroup } from "@/lib/origin-group";
import { isCharacterTag } from "@/lib/character-tags-shared";
import { ART_STYLE_LABEL, ART_STYLES, isArtStyle, type ArtStyle } from "@/lib/art-style";
import { pickerDemand } from "@/lib/tag-demand";
import { byDemand, isStatus, STATUSES, tagById, tagsIn, type Status, type TagId } from "@/lib/tags";
import FilterSeen from "./FilterSeen";

export const dynamic = "force-dynamic";

type Search = { tab?: string | string[]; page?: string | string[]; pairs?: string | string[]; q?: string | string[]; type?: string | string[]; status?: string | string[]; style?: string | string[] };

/** The relationship graph on the cast tab: this many couples a page (?pairs=N). */
const PAIRS_PAGE = 10;
type Props = { searchParams: Promise<Search> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pageOf = (v: string | string[] | undefined) => Math.max(1, Math.floor(Number(one(v) ?? 1)) || 1);

const DESCRIPTIONS: Record<Tab, string> = {
  cast: "Botchelor's cast: this month's house characters, next month's newcomers, the audience leaderboard and the relationship graph.",
  people: "Original characters made by people on Botchelor, looking for love on the show.",
  originals: "Botchelor originals: characters the show writes and draws itself, a few new ones every day.",
  agents: "Original characters made by AI agents over MCP, dating on Botchelor.",
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const tab = parseTab(one(sp.tab));
  const page = pageOf(sp.page);
  const meta = pageMetadata({
    title: tab === "cast" ? "Characters on Botchelor: the cast" : `Characters on Botchelor: ${TAB_LABEL[tab].toLowerCase()}`,
    description: DESCRIPTIONS[tab],
    path: tabHref(tab, tab === "cast" ? 1 : page),
  });
  // A search's results are for the person searching, not for a search engine (the tabs are the crawlable list).
  const find = findFilters(sp);
  return parseDirectoryQuery(sp.q) || find.type || find.status || find.style ? { ...meta, title: "Find a character on Botchelor", robots: { index: false, follow: true } } : meta;
}

/** A private character's name (David, #309/#509): never linked, no portrait, no details. */
function PrivateName({ name }: { name: string }) {
  return (
    <span className="directory-private">
      <strong>{name}</strong> <Icon name="lock" label="private" />
    </span>
  );
}

/** A card's square portrait: drawn this size (its width/height and the picture's resolution); the stylesheet fills the card. */
const CARD_PORTRAIT = 320;
/** The first row's portraits load at once; the rest lazily, as they scroll in. */
const EAGER_CARDS = 4;

/**
 * A character's card, photo-forward (design audit 2026-11-14: "a show built on faces renders ~40px portraits in
 * text-first cards"): the portrait is the card's top, a square edge to edge, the name under it, then age, rating and
 * traits, smaller. The name's link (.stretch) covers the whole card; the card's actions (its verb, and Talk) sit above
 * it, each its own target.
 * `origin={false}` on the cast tab, where every card is the show's own and a "Cast" chip on each says nothing.
 */
function Entry({ e, badge, origin = true, talk = false, eager = false, actions, own = false }: { e: DirectoryEntry; badge?: string; origin?: boolean; talk?: boolean; eager?: boolean; actions?: CardActions; /** The viewer's own, on the Yours tab: its doors, not a date verb. */ own?: boolean }) {
  if (e.private && !own) {
    return (
      <li className="card dir-card is-private">
        <div className="dir-portrait">
          <Avatar seed={e.id} name={e.name} hue={null} house={false} size={CARD_PORTRAIT} fill decorative />
        </div>
        <div className="dir-card-body">
          <PrivateName name={e.name} />
          <p className="muted small">Private: their creator keeps them to themselves.</p>
        </div>
      </li>
    );
  }
  const basics = [e.age, e.pronouns].filter(Boolean).join(" · ");
  const verb = actions?.verb;
  // Text (lib/character-verb.ts): read with the verb where the card has its facts (your own character included); a
  // card without them (off-season house, next season's candidates) goes by what anyone may text.
  const text = actions ? actions.text : textVerb(talk ? "open" : "closed", { id: e.id, name: e.name, textable: e.companion });
  return (
    <li className="card tap-card dir-card">
      {/* The name below says who it is: the face is decorative, and the card's link covers it. */}
      <div className="dir-portrait">
        <Avatar seed={e.id} name={e.name} hue={e.hue} house={false} portraitSrc={e.portrait} size={CARD_PORTRAIT} fill eager={eager} decorative />
      </div>
      <div className="dir-card-body">
        <CharacterName character={e} avatar={false} strong className="stretch dir-name" />
        {(origin || badge) && (
          <p className="dir-badges">
            {origin && <OriginBadge origin={e.origin} />}
            {badge && <span className="badge">{badge}</span>}
          </p>
        )}
        {/* The basics: age and pronouns, the audience's stars, then what they do and where they're from (only what's filled in). */}
        {(basics || e.reviews > 0) && (
          <p className="muted small dir-basics">
            {basics}
            {e.reviews > 0 && (
              <>
                {basics && " · "}
                <span className="dir-stars">
                  {e.stars?.toFixed(1)} ★ · {e.reviews}
                </span>
              </>
            )}
          </p>
        )}
        {(e.occupation || e.hometown) && (
          <p className="small dir-job">
            {e.occupation && (
              <span className="dir-fact">
                <Icon name="briefcase" /> {e.occupation}
              </span>
            )}
            {e.hometown && (
              <span className="dir-fact">
                <Icon name="pin" /> {e.hometown}
              </span>
            )}
          </p>
        )}
        {/* What kind of person (lib/character-tags.ts): one quiet line, the type tags with their glyphs. */}
        {e.tags.length > 0 && (
          <p className="muted small dir-tags">
            {e.tags
              .map((t) => tagById(t))
              .filter(Boolean)
              .map((t) => `${t!.icon} ${t!.label}`)
              .join(" · ")}
          </p>
        )}
        {e.traits.length > 0 && (
          <ul className="chips" aria-label="Traits">
            {e.traits.slice(0, 3).map((trait) => (
              <li className="chip" key={trait}>
                {trait}
              </li>
            ))}
          </ul>
        )}
        {/* What to do with them (lib/character-verb.ts): one primary action chosen by who's looking (send yours on a
            date, step into one yourself, or make a character to date them), and Text as the quieter second for anyone
            they can text (app/companion/TalkButton.tsx opens the thread). Each its own target above the card's link;
            your own character's card has no date verb, only Text. Both outlined (design review 2026-11-16, D-05): a grid
            of cards each with a filled button read as fifteen equally urgent asks; the page's one loud button is its own. */}
        {/* Your own (the Yours tab): the two doors that are about one character, opened on this one (lib/current-character.ts). */}
        {own && (
          <div className="dir-actions">
            <Link className="button secondary dir-verb" href={`/chat?character=${encodeURIComponent(e.id)}`} prefetch={false} data-track="yours-chat">
              Chats
            </Link>
            <Link className="button secondary" href={`/studio?character=${encodeURIComponent(e.id)}`} prefetch={false} data-track="yours-studio">
              Studio
            </Link>
          </div>
        )}
        {!own && (verb || text) && (
          <div className="dir-actions">
            {verb && (
              <Link className="button secondary dir-verb" href={verb.href} prefetch={false} aria-label={verb.label} title={verb.label} data-track={verb.track} data-track-from="card" data-track-verb={verb.kind}>
                {cardVerbLabel(verb)}
              </Link>
            )}
            {text && <TalkButton characterId={text.characterId} name={e.name} label={text.label} className="button secondary" track={text.track} />}
          </div>
        )}
      </div>
    </li>
  );
}

/** The filters the search reads: ?type=, ?status= and ?style= (lib/art-style.ts), each only when it's a known one. */
type Find = { type: TagId | null; status: Status | null; style: ArtStyle | null };
function findFilters(sp: Search): Find {
  const type = one(sp.type);
  const status = one(sp.status);
  const style = one(sp.style);
  return { type: isCharacterTag(type) ? type : null, status: isStatus(status) ? status : null, style: isArtStyle(style) ? style : null };
}


/**
 * Find a character by name, trait or a word from their bio, and narrow it by type, love life (docs/tags.md) and how
 * they're drawn (lib/art-style.ts): a plain GET form (?q=&type=&status=&style=), so it works without a script.
 */
function SearchForm({ q, find: { type, status, style }, demand }: { q: string; find: Find; demand?: Record<string, number> }) {
  // The type menu, most wanted first: who people talk to here (lib/tag-demand.ts), else the census (lib/tags.ts).
  const typeMenu = byDemand(tagsIn("type"), "sfw", demand);
  return (
    <form className="characters-search" action="/characters" method="get" role="search">
      <label className="sr-only" htmlFor="characters-q">
        Find a character
      </label>
      <input
        id="characters-q"
        type="search"
        name="q"
        defaultValue={q}
        maxLength={DIRECTORY_QUERY_MAX}
        placeholder="A name or a trait"
        autoComplete="off"
        enterKeyHint="search"
      />
      <label className="sr-only" htmlFor="characters-type">
        Type
      </label>
      <select id="characters-type" name="type" defaultValue={type ?? ""}>
        <option value="">Any type</option>
        {typeMenu.map((t) => (
          <option key={t.id} value={t.id}>
            {t.icon} {t.label}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="characters-status">
        Love life
      </label>
      <select id="characters-status" name="status" defaultValue={status ?? ""}>
        <option value="">Any love life</option>
        {STATUSES.map((st) => (
          <option key={st.id} value={st.id}>
            {st.icon} {st.label}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="characters-style">
        Style
      </label>
      <select id="characters-style" name="style" defaultValue={style ?? ""}>
        <option value="">Any style</option>
        {ART_STYLES.map((id) => (
          <option key={id} value={id}>
            {ART_STYLE_LABEL[id]}
          </option>
        ))}
      </select>
      <button type="submit" className="button secondary">
        Find
      </button>
      {style && <FilterSeen event="style_filter" props={{ style, page: "characters" }} />}
    </form>
  );
}

/**
 * The Characters hub (David, 2026-10-21): one page, three tabs, each a plain link so it's crawlable and needs no
 * script. The cast: this month's house characters, next month's candidates, and what /cast had (the leaderboard,
 * matchmaking, the relationship graph). People's characters and agent-made ones: everyone public, newest first, 24
 * a page. A private character is on no tab. The tabs run people's characters, the cast, agent-made (David, 2026-11-03:
 * real people's characters over bots whenever the show picks who to feature); the agent-made list is folded for a
 * stranger, open for someone with a character of their own (lib/crowd-threshold.ts isInsider). Above the tabs, a
 * search (?q=) across all of them (design audit 2026-11-14).
 *
 * What a stranger meets is a show with a cast and a community, not a database (2026-11-15: an outside reviewer read
 * the strip's "34 against 250" as bots talking to bots). So: the hub opens on the cast, the season's faces, who the
 * show is about and who a newcomer's first date is with; the strip carries no numbers (CharactersTabs); each made-by
 * tab says how many in a quiet line of its own (people's by the empty-room rule, the agents' on their fold); and
 * someone with a character gets a line to it under the heading, so "mine" is never a hunt through a tab.
 */
export default async function CharactersPage({ searchParams }: Props) {
  const sp = await searchParams;
  const tab = parseTab(one(sp.tab));
  const db = await getDb();
  const now = new Date();
  const thisId = seasonIdOf(now);
  const castIds = seasonCastIds(now);
  const store = await cookies();
  const auth = authFromCookieStore(store);
  const viewerId = auth?.userId ?? null;
  const q = parseDirectoryQuery(sp.q);
  const find = findFilters(sp);
  const finding = Boolean(q || find.type || find.status || find.style);
  // Someone signed out sees what everyone does: from a few seconds' shared copy (lib/shared-cache.ts).
  const [season, counts, insider, mine, stepIn, demand] = await Promise.all([
    shared(`characters:season:${castIds.join(",")}`, () => directoryEntries(db, castIds)),
    forViewer(viewerId, "characters:counts", () => tabCounts(db)),
    isInsider(db, viewerId),
    // Who's looking, for each card's verb (lib/character-verb.ts): the character of theirs that would go, and whether
    // they can step into a date themselves (lib/step-in-access.ts: a member or a guest; "sign in first" isn't open).
    viewerCharacter(db, viewerId, rememberedCharacter(store)).catch(() => null),
    stepInAccessFromCookies(db, auth, store).catch(() => null),
    // Cached an hour (lib/tag-demand.ts); a failure only leaves the census's order.
    pickerDemand(db).catch(() => null),
  ]);
  // ?tab=yours, for someone who has a character (anyone else gets the cast, as an unknown tab always did).
  const yours = one(sp.tab) === "yours" && mine !== null;
  const viewer: Viewer = { userId: viewerId, mine, stepIn: stepIn?.kind === "member" || stepIn?.kind === "guest", stepInEntry: stepIn !== null && (mine !== null || stepIn.kind === "sign_in") };

  return (
    <article className="characters-hub page-wide">
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
      <SearchForm q={q} find={find} demand={demand?.types} />
      {/* A search is across every tab, so no tab is the current one while it shows. An owner's own lead the strip
          (2026-11-16: it was a line of text above the search; someone without a character never sees the tab). */}
      <CharactersTabs current={finding ? null : yours ? "yours" : tab} companions={companionOpen()} yours={mine !== null} />
      {/* Awaited here, not rendered as async components, so the whole page is one server render (and testable). */}
      {finding ? await searchResults(q, find, viewer) : yours && viewerId ? await yoursTab(viewerId) : tab === "cast" ? await castTab({ season, thisId, castIds, now, pairsPage: parsePage(sp.pairs), viewer }) : await madeByTab({ tab, page: pageOf(sp.page), privateCount: counts.private, viewer, insider })}
    </article>
  );
}

/**
 * Who's looking at the cards. `stepInEntry`: the cast tab's "Step into the date" strip shows for someone whose cards
 * say something else (they have a character, so each card sends it; or guests are off, so each says "make a character").
 */
type Viewer = VerbViewer & { userId: string | null; stepInEntry: boolean };

/** Each card's verb and Text for this viewer. Signed out with no character, it's the same for everyone: the shared copy. Never fails a page. */
const cardVerbs = async (viewer: Viewer, ids: string[]): Promise<Map<string, CardActions>> => {
  const db = await getDb();
  // Text on every card once texting is open (lib/companion-shared.ts): the button itself says when an account comes first.
  const text: TextAccess = companionOpen() ? "open" : "closed";
  const load = async () => [...(await actionsFor(db, { ...viewer, text }, ids))];
  const rows = await (viewer.userId ? load() : shared(`characters:verbs:${viewer.stepIn ? 1 : 0}:${text}:${ids.join(",")}`, load)).catch(() => null);
  // A failed read: no verbs, and Text by what anyone may text (Entry's own fallback), so an empty map isn't "nothing".
  return rows ? new Map(rows) : new Map();
};

/**
 * The tab's group as a small sky (app/graph/teaser.ts), from the Constellation's own cached build: the same for everyone,
 * so one shared copy. Null when nobody in the group has a public date yet, or the graph can't be read (never fails a page).
 */
const teaserFor = (group: OriginGroup) =>
  shared(`characters:graph-teaser:${group}`, async () => graphTeaser(await cachedConstellation(), group)).catch(() => null);

/**
 * "The relationship graph" on a tab: the group's preview (app/graph/GraphTeaser.tsx), or `children` while there's nothing
 * to draw (and no section at all without them).
 */
function GraphSection({ group, teaser, children }: { group: SkyGroup; teaser: Teaser | null; children?: ReactNode }) {
  if (!teaser && !children) return null;
  return (
    <section id="graph" aria-labelledby="graph-title">
      <h2 id="graph-title">The relationship graph</h2>
      {teaser ? <GraphTeaser teaser={teaser} group={group} /> : children}
    </section>
  );
}

async function castTab({ season, thisId, castIds, now, pairsPage, viewer }: { season: DirectoryEntry[]; thisId: string; castIds: string[]; now: Date; pairsPage: number; viewer: Viewer }) {
  const viewerId = viewer.userId;
  // Talk on every card once companions are open (lib/companion-shared.ts).
  const talk = companionOpen();
  const db = await getDb();
  const nextId = seasonIdOf(nextSeasonStart(now));
  // The cast's boards are the same for everyone: one shared copy a few seconds old (lib/shared-cache.ts).
  const everyones = shared(`characters:cast:${nextId}:${castIds.join(",")}`, async () => {
    const candidates = (await listCandidates(db, nextId)).filter((c) => c.status !== "rejected");
    const candidateIds = candidates.map((c) => c.character_id);
    const [upcoming, earlier, cast, edges, boards] = await Promise.all([
      directoryEntries(db, candidateIds),
      offSeasonHouse(db, [...castIds, ...candidateIds]),
      listCast(db),
      listRelationshipEdges(db),
      Promise.all(RATING_CATEGORIES.map((c) => topRatedCharacters(db, c.id))),
    ]);
    // The matchmaker picks from public characters only: a private one stays its creator's.
    // The leaderboard and the relationship graph show a private one by name only (#509's rule).
    const hidden = await privateAmong(db, [...cast.map((c) => c.id), ...boards.flat().map((t) => t.id), ...edges.flatMap((e) => [e.a_id, e.b_id])]);
    return { candidates, upcoming, earlier, cast, edges, boards, hidden };
  });
  // The verbs are the season cast's (their ids are known already, so this waits on nothing): next season's candidates
  // and the off-season house aren't taking dates, so their cards have none, only Talk where they're companions.
  const [{ candidates, upcoming, earlier, cast, edges, boards, hidden }, proposals, castDateWin, verbs, teaser] = await Promise.all([
    everyones,
    viewerId ? listMyProposals(db, viewerId) : Promise.resolve([]),
    castDatePrize(db, viewerId).catch(() => null),
    cardVerbs(viewer, season.map((e) => e.id)),
    teaserFor("cast"),
  ]);
  const statusOf = new Map(candidates.map((c) => [c.character_id, c.status]));
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
      {/* The weekly earned slot's winner (lib/cast-date.ts): their prize, a date with the cast to book here. */}
      {castDateWin && <CastDatePrize prize={castDateWin} />}
      <section>
        <h2>This season: {seasonLabel(thisId)}</h2>
        <p className="muted">The show&apos;s own. Each month the two best-reviewed stay and two newcomers join.</p>
        <ul className="gallery grid-balanced" style={{ "--cols": balancedColumns(season.length, 4) } as CSSProperties}>
          {season.map((e, i) => (
            <Entry key={e.id} e={e} origin={false} talk={talk} eager={i < EAGER_CARDS} actions={verbs.get(e.id)} />
          ))}
        </ul>
      </section>
      {viewer.stepInEntry && season.length > 0 && (
        <section className="card stepin-entry-card" aria-labelledby="stepin-cast-title">
          <h2 id="stepin-cast-title">🎬 Step into the date</h2>
          <p className="muted small">Go on a date with one of them yourself, live, line by line. They&apos;re AI characters on a show.</p>
          <ul className="stepin-entry-faces">
            {season.map((e) => (
              <li key={e.id}>
                <Link href={`/step-in?with=${e.id}`} data-track="step-in" data-track-from="cast-tab">
                  <Avatar seed={e.id} name={e.name} hue={e.hue} house portraitSrc={e.portrait} size={36} />
                  {shortName(e.name)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Shown once there are candidates (2026-10-31 UX audit, A4: for most of the month it only said "check back"). */}
      {upcoming.length > 0 && (
        <section id="next-season">
          <h2>Next season&apos;s candidates: {seasonLabel(nextId)}</h2>
          <ul className="gallery grid-balanced" style={{ "--cols": balancedColumns(upcoming.length, 4) } as CSSProperties}>
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
              // The whole tile is the link (2026-11-07 audit, item 18: the name alone was a ~36px target on a phone).
              <li key={category.id} className="top-rated-item tap-card">
                <span className="muted small">
                  {category.emoji} {category.board}
                </span>
                {hidden.has(top[0].id) ? <PrivateName name={top[0].name} /> : <CharacterName character={top[0]} size={28} className="stretch" />}
                {/* An agent-made leader wears its badge (lib/origin.ts), as everywhere a character is featured. */}
                {!hidden.has(top[0].id) && isAgentMade(top[0].origin) && <OriginBadge origin={top[0].origin} />}
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
                    <li key={t.id} className="tap-card">
                      {hidden.has(t.id) ? (
                        <>
                          <Avatar seed={t.id} name={t.name} hue={null} house={false} size={28} />
                          <PrivateName name={t.name} />
                        </>
                      ) : (
                        <>
                          <CharacterName character={t} size={28} className="stretch" />
                          {isAgentMade(t.origin) && <OriginBadge origin={t.origin} />}
                        </>
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
        {/* The way into /graph: the cast's corner of it, drawn (the plain link it replaced while there's nothing to draw). */}
        {teaser ? (
          <GraphTeaser teaser={teaser} group="cast" />
        ) : (
          <p className="muted small">
            <Link href="/graph">See it as a constellation →</Link>
          </p>
        )}
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
              <li key={`${e.a}-${e.b}`} className="card graph-row tap-card">
                {/* One link to the couple over the whole row; the faces sit inside it unlinked (no nested anchors). */}
                <Link className="pair-link stretch" href={`/couples/${e.a_id}/${e.b_id}`}>
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
              <Entry key={e.id} e={e} origin={false} talk={talk} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

async function madeByTab({ tab, page, privateCount, viewer, insider }: { tab: "people" | "originals" | "agents"; page: number; privateCount: number; viewer: Viewer; insider: boolean }) {
  // Talk on every card once companions are open (lib/companion-shared.ts).
  const talk = companionOpen();
  const db = await getDb();
  const group: OriginGroup = tab === "people" ? "person" : tab === "originals" ? "cast" : "agent";
  const [list, teaser] = await Promise.all([forViewer(viewer.userId, `characters:${tab}:${page}`, () => listTab(db, tab, page)), teaserFor(group)]);
  const verbs = await cardVerbs(viewer, list.entries.filter((e) => !e.private).map((e) => e.id));
  const what = tab === "people" ? "characters made by people" : tab === "originals" ? "the show's original characters" : "characters made by AI agents";
  // How many people's characters, said here and not on the tab; to a stranger only from CROWD_MIN up (the empty-room
  // rule, lib/crowd-threshold.ts: "2 characters" is a sign saying nobody's here).
  const peopleCount = tab === "people" ? crowdLine(list.total, { one: "character", many: "characters" }, { insider }) : "";
  return (
    <section>
      <JsonLd data={itemListJsonLd(`Botchelor: ${what}`, list.entries.filter((e) => !e.private).map((e) => ({ name: e.name, path: `/characters/${e.id}` })))} />
      <p className="muted">
        {tab === "people" ? (
          <>
            {peopleCount ? `${peopleCount} people built on the site.` : "Original characters people built on the site."} <Link href="/create">Make your own</Link>.
          </>
        ) : tab === "originals" ? (
          <>The show&apos;s own characters: written and drawn by Botchelor, a few new ones every day.</>
        ) : (
          <>
            Original characters AI agents built over MCP. A few are run by the show&apos;s own scripts: those say
            &ldquo;House-run bot&rdquo;. <Link href="/agents">Send your agent</Link>.
          </>
        )}
        {privateCount > 0 && (
          <>
            {" "}
            A private character (<Icon name="lock" label="locked" />) shows only its name.
          </>
        )}
      </p>
      {list.entries.length ? (
        tab === "agents" ? (
          // Folded for a stranger (the count is here, on the fold, never in the tab strip), open for someone with a
          // character: people's characters lead; the bots are there for whoever wants them. A later page is wanted, so it opens.
          <details className="ux-fold agents-fold" open={insider || page > 1}>
            <summary>
              {list.total} {list.total === 1 ? "character" : "characters"} made by AI agents
            </summary>
            <ul className="gallery">
              {list.entries.map((e, i) => (
                <Entry key={e.id} e={e} talk={talk} eager={i < EAGER_CARDS} actions={verbs.get(e.id)} />
              ))}
            </ul>
            <Pager page={list.page} pages={list.pages} label={`${TAB_LABEL[tab]} pages`} href={(n) => tabHref(tab, n)} prev="Newer" next="Older" />
          </details>
        ) : (
          <>
            <ul className="gallery">
              {list.entries.map((e, i) => (
                <Entry key={e.id} e={e} talk={talk} eager={i < EAGER_CARDS} actions={verbs.get(e.id)} />
              ))}
            </ul>
            <Pager page={list.page} pages={list.pages} label={`${TAB_LABEL[tab]} pages`} href={(n) => tabHref(tab, n)} prev="Newer" next="Older" />
          </>
        )
      ) : (
        <p className="muted">None yet.</p>
      )}
      {/* Who this tab's characters have dated, as on the cast tab: drawn once any of them has a public date. */}
      <GraphSection group={group} teaser={teaser} />
    </section>
  );
}

/** A search's results (?q=), with the same cards: every tab at once, at most DIRECTORY_SEARCH_LIMIT. */
/** Yours: every character the viewer owns, newest first, each with its own doors (its chats, its Studio). Private ones in full: they're theirs. */
async function yoursTab(viewerId: string) {
  const db = await getDb();
  const ids = await ownCharacterIds(db, viewerId);
  // Their characters' corner of the Constellation, from its cached public build: theirs alone, so never a shared copy.
  const [entries, teaser] = await Promise.all([
    directoryEntries(db, ids, { own: true }),
    cachedConstellation()
      .then((sky) => graphTeaser(sky, "yours", { mine: new Set(ids) }))
      .catch(() => null),
  ]);
  return (
    <section>
      <p className="muted">
        {entries.length === 1 ? "Your character." : `Your ${entries.length} characters.`} Open one&apos;s chats or its Studio from here, or <Link href="/create">make another</Link>.
      </p>
      <ul className="gallery">
        {entries.map((e, i) => (
          <Entry key={e.id} e={e} own eager={i < EAGER_CARDS} badge={e.private ? "Private" : undefined} origin={false} />
        ))}
      </ul>
      <GraphSection group="yours" teaser={teaser}>
        {/* Nothing to draw yet: the public sky only has aired, public dates. */}
        <p className="muted small">
          Once one of yours has a public date, who they&apos;ve dated shows up here. <Link href="/graph">See the whole constellation →</Link>
        </p>
      </GraphSection>
    </section>
  );
}

async function searchResults(q: string, find: Find, viewer: Viewer) {
  const talk = companionOpen();
  const { entries, more } = await searchDirectory(await getDb(), q, DIRECTORY_SEARCH_LIMIT, find);
  const verbs = await cardVerbs(viewer, entries.map((e) => e.id));
  const n = entries.length;
  // What was asked, in words: “dry” · Grump · Single.
  const asked = [q && `“${q}”`, find.type && tagById(find.type)?.label, find.status && STATUSES.find((s) => s.id === find.status)?.label, find.style && ART_STYLE_LABEL[find.style]]
    .filter(Boolean)
    .join(" · ");
  return (
    <section className="characters-results" aria-labelledby="characters-results-title">
      <h2 id="characters-results-title">
        {n ? `${more ? `More than ${n}` : n} ${n === 1 && !more ? "character matches" : "characters match"} ${asked}` : `Nobody matches ${asked}`}
      </h2>
      <p className="muted">
        {q
          ? n
            ? "Their name, traits or bio has every word you searched for."
            : "No name, trait or bio on the show has every one of those words."
          : n
            ? "Love life is what their aired dates say; a private date never counts."
            : "Nobody on the show fits all of that yet."}{" "}
        <Link href="/characters">Clear the search</Link>
      </p>
      {n ? (
        <ul className="gallery">
          {entries.map((e, i) => (
            <Entry key={e.id} e={e} talk={talk} eager={i < EAGER_CARDS} actions={verbs.get(e.id)} />
          ))}
        </ul>
      ) : (
        <p className="characters-results-empty">
          Try a shorter word, or <Link href="/create">make the character you were looking for</Link>.
        </p>
      )}
      {more && <p className="muted">These are the first {DIRECTORY_SEARCH_LIMIT}. Add a word to narrow it down.</p>}
    </section>
  );
}
