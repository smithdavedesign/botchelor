import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import CharacterName from "@/app/CharacterName";
import JsonLd from "@/app/JsonLd";
import Pager from "@/app/Pager";
import { pageHref, pageOf, parsePage } from "@/lib/paging";
import { firstSky, groupSky, type KindPair } from "@/lib/graph";
import { parseSkyGroup } from "@/lib/origin-group";
import { getDb } from "@/lib/db";
import { ownCharacterIds } from "@/lib/directory";
import { authFromCookieStore } from "@/lib/http";
import { cachedConstellation } from "@/lib/graph-cache";
import { kindLabel } from "@/lib/kinds";
import { breadcrumbJsonLd, itemListJsonLd, pageMetadata } from "@/lib/seo";
import ConstellationApp from "./ConstellationApp";
import TenseTriangles from "./TenseTriangles";
import { parseStill, parseWhen, parseWorld, whenParam } from "./filter";
import { parseStages, stagesParam } from "./stages";
import ViewSwitch from "@/app/characters/ViewSwitch";
import { lensParam, parseLens } from "@/lib/social/lenses";
import { cachedLensSky, socialLensesOn } from "@/lib/social/lens-sky";

// Rendered per request (the site chrome reads the session), but the graph itself comes from a 60-second cache that a
// visibility change, a report or moderation drops at once (lib/graph-cache.ts): crawlers no longer rebuild it each hit.
export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Every character on Botchelor and who they've dated, drawn as one living constellation: the couples, the sparks, the exes and the hopefuls still waiting for a first date.";

// Its own share card (./opengraph-image), so no site card here.
export const metadata: Metadata = pageMetadata({ title: "The Constellation: Botchelor's social graph", description: DESCRIPTION, path: "/graph", image: null });

/** How the kind table names a kind ("🧛 Vampire"), or a character that hasn't said. */
const kindText = (k: KindPair["a"]): string => (k === "unsaid" ? "Hasn't said" : (kindLabel({ kind: k }) ?? k));

/** A private character's name (the directory's rule): never linked, no details. */
function PrivateName({ name }: { name: string }) {
  return (
    <span className="directory-private">
      <strong>{name}</strong> <span aria-label="private">🔒</span>
    </span>
  );
}

/**
 * The Constellation (/graph): the show's whole public social graph on one immersive canvas, with a
 * server-rendered ledger underneath so the same facts read without JavaScript (and index). Data comes from
 * lib/graph.ts, which only ever reads the relationship graph's public layer.
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The ledger under the sky: this many pairs a page (?ledger=N), whose pages link every pair. */
const LEDGER_PAGE = 10;
/**
 * The JSON-LD lists the first this many pairs, not all of them: the whole list went into the page twice (the script and
 * the RSC payload), ~140 KB of a 470 KB page at 2026-11-03's ~600 pairs. The ledger pages still link every pair.
 */
const JSONLD_PAIRS = 100;

/** The viewer's own characters, for the "Yours" filter: none for someone signed out (no query), or if they can't be read. */
async function viewerCharacterIds(): Promise<string[]> {
  const auth = authFromCookieStore(await cookies());
  return auth ? ownCharacterIds(await getDb(), auth.userId).catch(() => []) : [];
}

export default async function GraphPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const focusParam = sp.focus;
  // ?lens= (the social network's views, SOCIAL_LENSES): the view the sky opens on. Love, the Constellation, needs none.
  const lensesOn = socialLensesOn();
  const lens = lensesOn ? parseLens(sp.lens) : "love";
  // The same cached build for every ?focus=: the focus is applied in the browser (ConstellationApp initialFocus).
  // The viewer's own ids ride along, for "Yours" (signed in only; the sky itself is everyone's). A shared view's sky
  // comes too, so its link draws at once; Love's page carries none (the other views load when they're picked).
  // This week's story map is the house's now (/house, 2026-11-21), so it no longer rides here.
  const [{ nodes, edges, stats, kinds }, mine, lensSky] = await Promise.all([
    cachedConstellation(),
    viewerCharacterIds(),
    lens === "love" ? null : cachedLensSky(lens).catch(() => null),
  ]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const open = edges.filter((e) => !e.masked);
  const singles = nodes.filter((n) => n.degree === 0);
  const ledger = pageOf(edges, parsePage(sp.ledger), LEDGER_PAGE);
  // ?origin= (the Characters page's preview of a tab): the sky opens on that group and whoever they dated, its strongest
  // pairs first, with the filter set to match. "yours" only for someone with characters. The ledger and the numbers stay
  // everyone's.
  const asked = parseSkyGroup(sp.origin);
  const origin = asked === "yours" && mine.length === 0 ? null : asked;
  const first = firstSky(origin ? groupSky({ nodes, edges, stats, kinds }, origin, new Set(mine)) : { nodes, edges, stats, kinds });
  // A shared, filtered sky: ?stage= (the kinds of pair, app/graph/stages.ts), ?when= and ?still=1 (when they last dated,
  // app/graph/filter.ts), ?world=<id> (just their corner of the sky, the same file). The ledger stays every pair.
  const stages = parseStages(sp.stage);
  const when = parseWhen(sp.when);
  const still = parseStill(sp.still);
  const world = parseWorld(sp.world);
  // What a ledger page's link keeps of the address, so paging the ledger doesn't reset the sky above it.
  const kept = {
    focus: sp.focus,
    origin: origin ?? undefined,
    stage: stagesParam(stages) ?? undefined,
    when: whenParam(when) ?? undefined,
    still: still ? "1" : undefined,
    world: world ?? undefined,
    lens: lensParam(lens) ?? undefined,
  };
  // The clock "this season" and "the last 30 days" count from, handed to the browser so both renders draw the same sky.
  const now = Date.now();

  const jsonLd = (
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Characters", path: "/characters" },
            { name: "The Constellation", path: "/graph" },
          ]),
          itemListJsonLd(
            "The Botchelor constellation: couples with public dates",
            open.slice(0, JSONLD_PAIRS).map((e) => ({ name: `${byId.get(e.a_id)?.name ?? "?"} × ${byId.get(e.b_id)?.name ?? "?"}`, path: `/couples/${e.a_id}/${e.b_id}` })),
          ),
        ]}
      />
  );
  // Keyed: with the views on it's handed to ConstellationApp and drawn among that component's children, where React
  // warned that a child from this page had no key.
  const numbers = (
        <ul key="numbers" className="constellation-stats" aria-label="The network right now">
          <li>
            <strong>{stats.characters}</strong> characters
          </li>
          <li>
            <strong>{stats.couples}</strong> {stats.couples === 1 ? "pair" : "pairs"} who've dated
          </li>
          <li>
            <strong>{stats.dates}</strong> public {stats.dates === 1 ? "date" : "dates"}
          </li>
          {stats.most_connected && (
            <li>
              most connected: <strong>{stats.most_connected.name}</strong> ({stats.most_connected.degree})
            </li>
          )}
          {stats.deepest && stats.deepest.dates > 1 && (
            <li>
              deepest: <strong>
                {stats.deepest.a} × {stats.deepest.b}
              </strong>{" "}
              ({stats.deepest.dates} dates)
            </li>
          )}
          {stats.cross_kind > 0 && (
            <li>
              <strong>{stats.cross_kind}</strong> cross-kind {stats.cross_kind === 1 ? "pair" : "pairs"}
            </li>
          )}
          {stats.triangles > 0 && (
            <li>
              <strong>{stats.triangles}</strong> {stats.triangles === 1 ? "triangle" : "triangles"}
            </li>
          )}
          <li>
            <strong>{stats.singles}</strong> waiting for a first date
          </li>
        </ul>
  );
  const sky = (
    <>
      {/* The sky (2026-10-25: the page opened on it; since the story map, 2026-11-15, it is the "All time" section). */}
      {/* The strongest pairs first; the rest of the sky loads when asked for (or when ?focus= names someone outside it). */}
      <ConstellationApp
        data={first}
        total={first.nodes.length === nodes.length && first.edges.length === edges.length ? null : { characters: nodes.length, pairs: edges.length }}
        initialFocus={typeof focusParam === "string" ? focusParam : null}
        initialOrigin={origin ?? "all"}
        initialStages={stages}
        initialWhen={when}
        initialStill={still}
        initialWorld={world}
        now={now}
        mine={mine}
        lensesOn={lensesOn}
        initialLens={lens}
        initialLensSky={lensSky}
        loveNumbers={lensesOn ? numbers : null}
      />
    </>
  );
  const tables = (
    <>
      <section className="constellation-ledger" id="ledger">
        <h2>The ledger</h2>
        <p className="muted small">Every pair on the canvas, in plain text — the same public facts, no JavaScript needed.</p>
        {edges.length ? (
          <ul className="list">
            {ledger.items.map((e) => {
              const a = byId.get(e.a_id);
              const b = byId.get(e.b_id);
              if (!a || !b) return null;
              return e.masked ? (
                <li key={`${e.a_id}~${e.b_id}`} className="card is-private graph-row">
                  {a.private ? <PrivateName name={a.name} /> : <CharacterName character={a} strong />} ×{" "}
                  {b.private ? <PrivateName name={b.name} /> : <CharacterName character={b} strong />}
                </li>
              ) : (
                <li key={`${e.a_id}~${e.b_id}`} className="card graph-row tap-card">
                  {/* One link to the couple, over the whole row: only the names underline, and each name keeps its face
                      when the row wraps. */}
                  <Link className="pair-link stretch" href={`/couples/${e.a_id}/${e.b_id}`}>
                    <CharacterName character={a} link={false} strong />
                    <span className="pair-x">×</span>
                    <CharacterName character={b} link={false} strong />
                  </Link>
                  {e.stage && <span className="badge">{e.stage}</span>}{" "}
                  {/* No endings here: like the episode page, the canvas keeps them behind "Show what happened". */}
                  <span className="muted">
                    {e.dates} {e.dates === 1 ? "date" : "dates"}
                    {e.second_dates > 0 && `, ${e.second_dates} second`}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No public dates yet: the sky is all orbit. Send two characters on a date and the first line appears.</p>
        )}
        <Pager page={ledger.page} pages={ledger.pages} label="Ledger pages" href={(n) => pageHref("/graph", kept, "ledger", n, "ledger")} scroll={false} />
        {singles.length > 0 && (
          <>
            <h3>In orbit (no public dates yet)</h3>
            <ul className="chips constellation-singles">
              {singles.map((n) => (
                <li key={n.id} className="chip">
                  {n.private ? <PrivateName name={n.name} /> : <CharacterName character={n} size={20} />}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="constellation-kinds">
        <h2>Who dates whom, by kind</h2>
        <p className="muted small">
          Every pair with public dates, by what each one says they are. Pairs with a private character aren&apos;t counted.
        </p>
        {kinds.length ? (
          <table className="constellation-kind-table">
            <thead>
              <tr>
                <th scope="col">Pairing</th>
                <th scope="col">Pairs</th>
                <th scope="col">Public dates</th>
              </tr>
            </thead>
            <tbody>
              {kinds.map((k) => (
                <tr key={`${k.a}~${k.b}`} className={k.a !== k.b && k.a !== "unsaid" && k.b !== "unsaid" ? "is-cross" : undefined}>
                  <th scope="row">
                    {kindText(k.a)} × {kindText(k.b)}
                  </th>
                  <td>{k.pairs}</td>
                  <td>{k.dates}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No public pairs to count yet.</p>
        )}
      </section>

      <section className="constellation-missing card">
        <h2>What the network doesn&apos;t know yet</h2>
        <p className="muted small">The constellation draws everything the show records publicly. These are the edges it can&apos;t draw — yet.</p>
        {/* Folded (UX audit 2026-10-23): six long bullets, ~650px on a phone, for the few who want the caveats. */}
        <details className="constellation-missing-details ux-fold">
          <summary>Why some edges are missing</summary>
        <ul>
          <li>
            <strong>What they are is self-reported, and optional.</strong> A character&apos;s kind (vampire, robot, ghost…) is whatever its creator
            says,{" "}
            {stats.kind_coverage
              ? `and ${Math.round(stats.kind_coverage * 100)}% of people's and agents' characters have said so far`
              : "and people's and agents' characters have only just started saying it"}
            , so the kind colours and the table above undercount the cross-kind sky.
          </li>
          <li>
            <strong>Mutual matches stay hidden until a date airs.</strong> A match is its owners&apos; secret, so the spark before the first date casts no
            light here. A public &quot;mutual spark&quot; opt-in would add pre-date edges.
          </li>
          <li>
            <strong>Group nights and the house&apos;s scenes aren&apos;t drawn yet.</strong> Double dates and mixers air, and the house runs scenes of its
            own, but every line here is still one pair&apos;s public dates: each couple at a group night&apos;s table is its own line, and the night they
            shared isn&apos;t. So a triangle you see comes from three pairs&apos; separate histories, not a night the three spent together. Views of who
            are friends, who are rivals and who talks about whom are coming.
          </li>
          <li>
            <strong>Texting between dates is private.</strong> Couples text after dates, but the volume is owner-only — a derived &quot;still texting&quot;
            badge could make living edges glow.
          </li>
          <li>
            <strong>Who wanted another date is private.</strong> Each side&apos;s wish stays with its owner, so the arrows show only what aired: who got
            turned down and who left first, folded with the endings behind &quot;Show what happened&quot; so nobody is told how a date ends before
            they watch it. Chemistry and trust are on each couple&apos;s page, but the lines here weigh second dates, not the engine&apos;s own
            numbers.
          </li>
          <li>
            <strong>How a first public date came about is recorded from 22 October 2026.</strong> A pair&apos;s panel says whether the show set it
            up or one of them asked, about that date only; dates booked before then don&apos;t say.
          </li>
        </ul>
        </details>
        <p className="muted small">
          Want to light up a corner of the sky? <Link href="/create">Make a character</Link> or <Link href="/characters">browse the cast</Link> and send
          someone on a date.
        </p>
      </section>
    </>
  );

  // The sky first (2026-11-21, David: "not sure we should have content above the giant graph"): three visitors in thirty
  // days opened the page and none scrolled to the sky, which sat a screen or more down under the week's story map. That
  // map is the house's now (/house); here, one line of title with the Cards | Map switch (it's Characters as a map),
  // then the sky, then what it is, the numbers, the tense triangles and the folded tables for whoever scrolls.
  return (
    <article className="constellation-page page-wide">
      {jsonLd}
      <header className="constellation-top">
        <div className="constellation-top-title">
          <h1>The Constellation</h1>
          <p className="muted small">
            Who&apos;s dated whom: {stats.characters} characters, {stats.couples} {stats.couples === 1 ? "pair" : "pairs"}.{" "}
            <Link href="/house#story-map" data-track="graph-this-week">
              This week in the house →
            </Link>
          </p>
        </div>
        <ViewSwitch current="map" group={origin} />
      </header>
      {/* #all-time: the old links into the sky's section (the Characters previews', the story map's) still land on it. */}
      <section className="constellation-all-time" id="all-time" aria-label="The constellation">
        {sky}
        <p className="muted small constellation-about">{DESCRIPTION}</p>
        {/* With the views on, the numbers are the sky's own line (each view has its own), drawn by ConstellationApp. */}
        {!lensesOn && numbers}
      </section>
      {/* The network's tense triangles as story hooks (./TenseTriangles.tsx): fetched as the section nears the screen. */}
      {lensesOn && <TenseTriangles />}
      {/* Open when a ledger page is asked for (its pager links here), folded otherwise. */}
      <details className="constellation-fold ux-fold" id="tables" open={sp.ledger !== undefined}>
        <summary>The ledger, who dates whom by kind, and what the network doesn&apos;t know yet</summary>
        {tables}
      </details>
    </article>
  );
}
