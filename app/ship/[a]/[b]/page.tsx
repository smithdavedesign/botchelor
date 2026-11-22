import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import ShareLink from "@/app/ShareLink";
import { nameFromSegment, SHIP_ERRORS, shipMerge, shipPair, shipPath, type ShipBlend, type ShipMerge, type ShipPair } from "@/lib/ship-names";
import ShipForm from "../../ShipForm";
import MoreTools from "@/app/tools/MoreTools";
import { SHIP_TOOL_PATH } from "@/lib/tools";
import { getDb } from "@/lib/db";
import { STAGE_LABELS } from "@/lib/relationship-stages";
import { shipCouple, type ShipCouple } from "@/lib/ship-couple";

type Props = { params: Promise<{ a: string; b: string }> };

/** The longest run a name can't wrap inside: its longest word (a name wraps only between words, never mid-word). */
const longestWord = (name: string) => Math.max(...name.split(/[\s-]+/).map((w) => [...w].length));
const longestOf = (names: readonly { name: string }[]) => Math.max(0, ...names.map((n) => longestWord(n.name)));

/**
 * The best name, built in front of you (pass 2 of the 2026-11-20 visual pop audit, app/ux/motion.css): the two names
 * side by side, the letters each gives up falling away, what's left meeting in the middle. The given-up letters are
 * generated content (globals.css .ship-keep-a::after), so the text in the page, for search and screen readers, is the
 * ship name alone, and at rest or under reduced motion that's all there is.
 */
function MergedName({ blend, merge }: { blend: ShipBlend; merge: ShipMerge | null }) {
  if (!merge) return <strong>{blend.name}</strong>;
  return (
    <strong>
      <span className="ship-keep-a" data-drop={merge.dropA} style={{ "--drop-len": [...merge.dropA].length } as CSSProperties}>
        {merge.keepA}
      </span>
      <span className="ship-keep-b" data-drop={merge.dropB} style={{ "--drop-len": [...merge.dropB].length } as CSSProperties}>
        {merge.keepB}
      </span>
    </strong>
  );
}

async function load(params: Props["params"]): Promise<ShipPair> {
  const { a, b } = await params;
  return shipPair(nameFromSegment(a), nameFromSegment(b));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const pair = await load(params);
  // Refused or unreadable: the generator's title, nothing of what was typed, and kept out of search.
  if (!pair.ok) return { title: "OC ship name generator · Botchelor", robots: { index: false, follow: false } };
  const { a, b, names } = pair;
  const pairName = `${a.display} × ${b.display}`;
  const top = names.slice(0, 2).map((n) => n.name);
  const title = top.length ? `${pairName} ship names: ${top.join(", ")}${names.length > top.length ? " and more" : ""}` : `${pairName} ship names`;
  const description = `Ship names for ${a.display} and ${b.display}${names.length ? `: ${names.slice(0, 4).map((n) => n.name).join(", ")}` : ""}. From Botchelor's free OC ship name generator.`;
  const path = shipPath(a, b);
  return {
    title: `${title} · Botchelor`,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: "Botchelor", title, description, url: path },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * A pair's ship names (lib/ship-names.ts), at an address anyone can share: the same names for everyone, every time.
 * It ends on the show's own offer, a blind date for the first of the two, one click into /create.
 */
export default async function ShipPage({ params }: Props) {
  const pair = await load(params);
  if (!pair.ok) {
    return (
      <section className="card ship-tool">
        <p className="kicker">
          <Link href="/tools/ship-name-generator">OC ship name generator</Link>
        </p>
        <h1>No ship names for that pair</h1>
        <p className="error" role="alert">
          {SHIP_ERRORS[pair.error]}
        </p>
        <ShipForm />
      </section>
    );
  }

  const { a, b, names } = pair;
  const longest = longestOf(names);
  // Two of the show's own who've dated on air (lib/ship-couple.ts): the page leads with them, not with a new character.
  // Only a nicety: a database that's slow or down leaves the names page as it always was.
  const couple: ShipCouple | null = await getDb()
    .then((db) => shipCouple(db, a.display, b.display))
    .catch(() => null);
  return (
    <>
      <section className="card ship-tool">
        <p className="kicker">
          <Link href="/tools/ship-name-generator">OC ship name generator</Link>
        </p>
        <h1>{`${a.display} × ${b.display} ship names`}</h1>
        {couple && (
          <p className="ship-couple">
            <span className="kicker">On the show</span>{" "}
            <Link href={couple.path} data-track="ship-couple">
              <strong>{`${couple.a.name} × ${couple.b.name}`}</strong>
            </Link>
            {`${couple.stage ? `: ${STAGE_LABELS[couple.stage]}` : ""}, ${couple.dates} ${couple.dates === 1 ? "date" : "dates"} aired.`}
          </p>
        )}
        {names.length > 0 ? (
          <>
            <p className="muted">Best first. Each one keeps a piece of both names.</p>
            {/* Each name sizes down to fit its tile by its longest word (--len); a list with a long one takes fewer
                columns (data-long), so "Barnabuniper" never breaks as "Barnabunipe / r" (visual audit 2026-11-20). */}
            <ol className="ship-names" data-long={longest > 14 ? "2" : longest > 10 ? "1" : undefined}>
              {names.map((n, i) => (
                <li key={n.name} data-ship-name={n.name} style={{ "--len": longestWord(n.name) } as CSSProperties}>
                  {i === 0 ? <MergedName blend={n} merge={shipMerge(a, b, n)} /> : <strong>{n.name}</strong>}
                  <span className="ship-how">{`${n.head} + ${n.tail}`}</span>
                  {i === 0 && (
                    <span className="ship-stamp" aria-hidden="true">
                      Top pick
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p>No blend of these two reads like a name. Try another spelling, or another name.</p>
        )}
        <ShareLink path={shipPath(a, b)} label="Link to these ship names" />
      </section>

      <section className="card">
        <h2>Try another pair</h2>
        <ShipForm a={a.display} b={b.display} secondary />
      </section>

      {couple ? (
        // A real couple: their dates first, the blind date for a character of your own second.
        <section className="card ship-cta">
          <h2>{`Watch ${couple.a.name.split(/\s+/)[0]} and ${couple.b.name.split(/\s+/)[0]}`}</h2>
          <p>{`Every date they've had on the show, how each one ended, and where they stand now. Nobody wrote it in advance.`}</p>
          <p className="cta-row">
            <Link className="button" href={couple.path} data-track="ship-couple-cta">
              See their dates
            </Link>
            <Link className="button-ghost" href={`/create?name=${encodeURIComponent(a.display)}`}>
              {`Make your own ${a.display}`}
            </Link>
          </p>
          <MoreTools current={SHIP_TOOL_PATH} />
        </section>
      ) : (
        <section className="card ship-cta">
          <h2>Send them on a blind date</h2>
          <p>
            {`Give ${a.display} a blind date to go with the ship name: AI writes it, nobody can steer it (not even you), and friends guess how it ends. Free, no sign-up.`}
          </p>
          <Link className="button" href={`/create?name=${encodeURIComponent(a.display)}`}>
            {`Send ${a.display} on a blind date`}
          </Link>
          <MoreTools current={SHIP_TOOL_PATH} />
        </section>
      )}
    </>
  );
}
