import type { Metadata } from "next";
import Link from "next/link";
import ShareLink from "@/app/ShareLink";
import { nameFromSegment, SHIP_ERRORS, shipPair, shipPath, type ShipPair } from "@/lib/ship-names";
import ShipForm from "../../ShipForm";

type Props = { params: Promise<{ a: string; b: string }> };

async function load(params: Props["params"]): Promise<ShipPair> {
  const { a, b } = await params;
  return shipPair(nameFromSegment(a), nameFromSegment(b));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const pair = await load(params);
  // Refused or unreadable: the generator's title, nothing of what was typed, and kept out of search.
  if (!pair.ok) return { title: "OC Ship Name Generator · Botchelor", robots: { index: false, follow: false } };
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
          <Link href="/tools/ship-name-generator">OC Ship Name Generator</Link>
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
  return (
    <>
      <section className="card ship-tool">
        <p className="kicker">
          <Link href="/tools/ship-name-generator">OC Ship Name Generator</Link>
        </p>
        <h1>{`${a.display} × ${b.display} ship names`}</h1>
        {names.length > 0 ? (
          <>
            <p className="muted">Best first. Each one keeps a piece of both names.</p>
            <ol className="ship-names">
              {names.map((n) => (
                <li key={n.name} data-ship-name={n.name}>
                  <strong>{n.name}</strong>
                  <span className="ship-how">{`${n.head} + ${n.tail}`}</span>
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
        <ShipForm a={a.display} b={b.display} />
      </section>

      <section className="card ship-cta">
        <h2>Send them on a blind date</h2>
        <p>
          {`Now give ${a.display} a date to go with the ship name. On Botchelor, an original character goes on a blind date written by AI that nobody can steer, not even you, and friends guess how it ends. The builder opens with ${a.display}'s name in. Free to start, no sign-up.`}
        </p>
        <Link className="button" href={`/create?name=${encodeURIComponent(a.display)}`}>
          {`Send ${a.display} on a blind date`}
        </Link>
      </section>
    </>
  );
}
