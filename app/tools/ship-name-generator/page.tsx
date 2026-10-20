import type { Metadata } from "next";
import Link from "next/link";
import ShipForm from "../../ship/ShipForm";

const PATH = "/tools/ship-name-generator";
const TITLE = "OC Ship Name Generator";
const DESCRIPTION =
  "A free ship name generator for original characters: type two names and get the ship names that blend them, best first, on a link you can share. No sign-up.";

export const metadata: Metadata = {
  title: `${TITLE}: blend two names into a ship name · Botchelor`,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { type: "website", siteName: "Botchelor", title: TITLE, description: DESCRIPTION, url: PATH },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

/**
 * The OC ship name generator (lib/ship-names.ts): a page for people searching "ship name generator". Two names go
 * to their own shareable /ship/<a>/<b> page, which ends one click from /create.
 */
export default function ShipNameGeneratorPage() {
  return (
    <>
      <section className="card ship-tool">
        <p className="kicker">A free tool for original characters</p>
        <h1>{TITLE}</h1>
        <p className="lede">
          Type two names and get their ship names: the start of one blended into the end of the other, both ways round,
          best first.
        </p>
        <ShipForm />
        <p className="muted small">
          Free, no sign-up. The same two names always make the same ship names, so the page they land on is a link you
          can share. Try <Link href="/ship/juniper/dex">Juniper × Dex</Link>.
        </p>
      </section>

      <section className="card">
        <h2>How a ship name is made</h2>
        <ul className="ship-how-list">
          <li>
            <strong>The start of one name, the end of the other.</strong> Junip + ex makes Junipex. Each name keeps at
            least two letters, so both are still in there.
          </li>
          <li>
            <strong>Both ways round.</strong> Dex goes first too: Dex + iper makes Dexiper.
          </li>
          <li>
            <strong>The easy ones to say come first.</strong> A blend that joins on a shared letter, or where a consonant
            meets a vowel, ranks above one that piles up consonants.
          </li>
          <li>
            <strong>First names do the blending.</strong> With a two-word name, the first word is the one that blends.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>Original characters only</h2>
        <p>
          It&apos;s made for OCs and fictional pairings. The names of well-known real people, and sexual words, don&apos;t
          make a ship.
        </p>
      </section>

      <section className="card ship-cta">
        <h2>Got an OC? Send them on a blind date</h2>
        <p>
          Botchelor is a blind-date show for original characters. Build yours, and they go on a date written by AI that
          nobody can steer, not even you, while friends guess how it ends. Free to start, no sign-up.
        </p>
        <Link className="button" href="/create">
          Make your character
        </Link>
      </section>
    </>
  );
}
