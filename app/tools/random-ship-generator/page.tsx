import type { Metadata } from "next";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import JsonLd from "@/app/JsonLd";
import { getDb } from "@/lib/db";
import { RANDOM_OC_GENRE_INFO, roleLine } from "@/lib/random-oc";
import { nextShip, RANDOM_SHIP_PATH, randomShip, randomShipHref, readShipNumber, shipCast, type ShipSide } from "@/lib/random-ship";
import { ENDING_LABELS } from "@/lib/rules";
import { pageMetadata, toolJsonLd } from "@/lib/seo";
import { CHEMISTRY_TOOL_PATH, RANDOM_OC_TOOL_PATH, SHIP_TOOL_PATH, TOOLS_PATH } from "@/lib/tools";
import MoreTools from "../MoreTools";

const TITLE = "Random ship generator";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  // Another pair, or any other query, is the same tool: one page in search, the rest followed but not indexed.
  const variant = Object.keys(sp).length > 0;
  return {
    ...pageMetadata({
      title: "Random ship generator: two characters, one click · Botchelor",
      description:
        "A free random ship generator: one click pairs two characters, from the show's cast or random OCs, with their ship name and how well they'd get on. No sign-up.",
      path: RANDOM_SHIP_PATH,
      // Its own card beside it (opengraph-image.tsx).
      image: null,
    }),
    ...(variant ? { robots: { index: false, follow: true } } : {}),
  };
}

const cap = (s: string) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

/** One side of the pair: a show character's public face (their page a click away), or a random OC's role. */
function Side({ side }: { side: ShipSide }) {
  if (side.kind === "cast") {
    const c = side.cast;
    return (
      <div className="rship-side" data-side="cast">
        <Avatar seed={c.id} name={c.name} portraitSrc={c.portrait} house={c.house} size={96} eager />
        <p className="muted small rship-from">On the show</p>
        <h2 className="rship-who">
          <Link href={`/characters/${c.id}`}>{c.name}</Link>
        </h2>
        <ul className="random-oc-traits" aria-label="Traits">
          {c.traits.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        {c.want && <p className="small rship-line">{`Wants: ${c.want}`}</p>}
      </div>
    );
  }
  const oc = side.oc;
  return (
    <div className="rship-side" data-side="oc">
      <Avatar seed={`random-oc-${oc.name}`} name={oc.name} size={96} eager />
      <p className="muted small rship-from">{`Random OC · ${RANDOM_OC_GENRE_INFO[oc.genre].label}`}</p>
      <h2 className="rship-who">{oc.name}</h2>
      <ul className="random-oc-traits" aria-label="Traits">
        {oc.traits.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <p className="small rship-line">{`${cap(roleLine(oc))}.`}</p>
    </div>
  );
}

/**
 * The random ship generator (lib/random-ship.ts): two characters, their ship name and their chemistry, one pair a page.
 * "Another pair" is the next address (no form, so it works without JavaScript and every pair is a link), and the way
 * into the show is the pair's ship page, or /create with the OC in it.
 */
export default async function RandomShipGeneratorPage({ searchParams }: Props) {
  const sp = await searchParams;
  const n = readShipNumber(sp.pair);
  const ship = randomShip(n, await shipCast(getDb));
  const { score, ending, reasons } = ship.chemistry;
  const fromShow = ship.a.kind === "cast" || ship.b.kind === "cast";
  return (
    <>
      <section className="card ship-tool rship-tool">
        <p className="kicker">
          <Link href={TOOLS_PATH}>Free OC tools</Link>
        </p>
        <h1>{TITLE}</h1>
        <p className="lede">
          One click, two characters, one ship: their ship name and how well they&apos;d get on. Some pairs come from the
          show&apos;s cast, the rest from the random OC generator.
        </p>

        <div className="rship" data-pair={n} data-mode={ship.mode}>
          <div className="rship-pair">
            <Side side={ship.a} />
            <span className="rship-x" aria-hidden="true">
              ×
            </span>
            <Side side={ship.b} />
          </div>

          {ship.ships.length > 0 ? (
            <p className="rship-name">
              <span className="kicker">Their ship name</span>
              <strong data-ship-name={ship.ships[0].name}>{ship.ships[0].name}</strong>
              {ship.ships.length > 1 && <span className="muted small">{`or ${ship.ships.slice(1, 4).map((s) => s.name).join(", ")}`}</span>}
            </p>
          ) : (
            <p className="muted rship-name">No blend of these two names reads like a ship name.</p>
          )}

          <div className={`chem-score chem-${ending}`} data-score={score} data-ending={ending}>
            <p className="chem-score-num">
              <strong>{score}</strong>
              <span>/100 chemistry</span>
            </p>
            <meter min={0} max={100} low={40} high={65} optimum={100} value={score} aria-label="Chemistry score" />
            <p className="chem-ending">
              On paper: <strong>{ENDING_LABELS[ending]}</strong>
            </p>
          </div>
          {reasons.length > 0 && (
            <ul className="rship-why">
              {reasons.slice(0, 2).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <p className="muted small">
            {fromShow
              ? "For fun: read from their traits and what they want (a show character's dealbreaker stays private). On the show, the date engine decides every ending."
              : "For fun: read from their traits, wants and dealbreakers. On the show, the date engine decides every ending."}
          </p>

          <p className="cta-row rship-actions">
            {/* nofollow: a crawler has no reason to walk a thousand pairs, or into the builder (robots.txt keeps it off
                /create's addresses anyway). */}
            <Link className="button" href={randomShipHref(nextShip(n))} rel="nofollow" data-track="random-ship-more">
              Another pair
            </Link>
            <Link className="button secondary" href={ship.wayIn.href} rel="nofollow" data-track="random-ship-in" data-track-kind={ship.wayIn.kind}>
              {ship.wayIn.label}
            </Link>
          </p>
          {ship.fullHref && (
            <p className="small">
              <Link href={ship.fullHref} rel="nofollow" data-track="random-ship-full">
                Why they&apos;d click, or wouldn&apos;t: the full reading →
              </Link>
            </p>
          )}
        </div>
      </section>

      <section className="card">
        <h2>How it picks a ship</h2>
        <ul className="ship-how-list">
          <li>
            <strong>Two characters, one click.</strong> Some come from the show&apos;s cast: characters whose dates have
            aired, as their own pages show them. The rest come from the <Link href={RANDOM_OC_TOOL_PATH}>random OC
            generator</Link>.
          </li>
          <li>
            <strong>Their ship name</strong> is the best blend of their first names, from the{" "}
            <Link href={SHIP_TOOL_PATH}>ship name generator</Link>.
          </li>
          <li>
            <strong>Their chemistry</strong> comes from the <Link href={CHEMISTRY_TOOL_PATH}>ship compatibility
            test</Link>: shared traits, a want the other one meets, the words that warm a date up or cool it down. A show
            character&apos;s dealbreaker stays private, so it&apos;s left out.
          </li>
          <li>
            <strong>No AI and no sign-up.</strong> Each pair has its own link, so you can send one to a friend.
          </li>
        </ul>
      </section>

      <section className="card ship-cta">
        <h2>Got a ship of your own?</h2>
        <p>
          Botchelor is a blind-date show for original characters. Make yours, and they go on a date written by AI that
          nobody can steer, not even you, while friends guess how it ends. Free to start, no sign-up.
        </p>
        <Link className="button" href="/create">
          Make your character
        </Link>
        <MoreTools current={RANDOM_SHIP_PATH} />
      </section>

      {/* The tool as a free web app under the tools hub, for search (lib/seo.ts toolJsonLd). */}
      <JsonLd data={toolJsonLd(RANDOM_SHIP_PATH)} />
    </>
  );
}
