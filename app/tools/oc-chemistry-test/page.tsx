import type { Metadata } from "next";
import Link from "next/link";
import { CHEMISTRY_TEST_PATH, chemistryResultHref, SCORE_BANDS, type OcSheet } from "@/lib/chemistry-test";
import ChemistryForm from "./ChemistryForm";

const TITLE = "OC Chemistry Test";
const DESCRIPTION =
  "A free chemistry test for two original characters: give each three traits, a want and a dealbreaker, and get a score out of 100, how their first date ends and why, on a link you can share. No sign-up.";
const CARD = { url: "/api/og/chemistry", width: 1200, height: 630, alt: "Botchelor's free OC Chemistry Test: will these two make it?" };

export const metadata: Metadata = {
  title: `${TITLE}: will these two characters make it? · Botchelor`,
  description: DESCRIPTION,
  alternates: { canonical: CHEMISTRY_TEST_PATH },
  openGraph: { type: "website", siteName: "Botchelor", title: `${TITLE}: will these two make it?`, description: DESCRIPTION, url: CHEMISTRY_TEST_PATH, images: [CARD] },
  twitter: { card: "summary_large_image", title: `${TITLE}: will these two make it?`, description: DESCRIPTION, images: [CARD.url] },
};

/** The example the page links to: a result anyone can open. Sample characters. */
const EXAMPLE: [OcSheet, OcSheet] = [
  { name: "Juniper", traits: ["curious", "warm", "dry-witted"], want: "Someone who gets lost on purpose", dealbreaker: "People who are always on their phone" },
  { name: "Dex", traits: ["restless", "funny", "loyal"], want: "Someone curious enough to keep up", dealbreaker: "Cynics" },
];

/**
 * The OC chemistry test (lib/chemistry-test.ts): a page for people searching for character chemistry and OC
 * relationship tests. Two characters go to their own shareable result, which ends one click from /create.
 */
export default function ChemistryTestPage() {
  const band = (lo: number, hi: number) => `${lo} to ${hi}`;
  return (
    <>
      <section className="card chem-tool">
        <p className="kicker">A free tool for original characters</p>
        <h1>{TITLE}</h1>
        <p className="lede">
          Will these two make it? Three traits, a want and a dealbreaker each, and you get their chemistry out of 100 and how
          their first date ends.
        </p>
        <ChemistryForm />
        <p className="muted small">
          Free, no sign-up. The same two characters always get the same answer, so the result is a link you can share.
          Try <Link href={chemistryResultHref(...EXAMPLE)}>Juniper × Dex</Link>.
        </p>
      </section>

      <section className="card">
        <h2>How the test reads them</h2>
        <ul className="chem-how-list">
          <li>
            <strong>A dealbreaker the other one is ends it.</strong> If one character&apos;s dealbreaker names one of the
            other&apos;s traits (&ldquo;brash people&rdquo; and &ldquo;brash&rdquo;), it&apos;s a disaster, whatever else
            they share.
          </li>
          <li>
            <strong>A want the other one meets.</strong> What one wants, turning up in the other&apos;s traits or want,
            lifts the attraction.
          </li>
          <li>
            <strong>Traits in common.</strong> Every word their traits share adds to the chemistry.
          </li>
          <li>
            <strong>The words that set a temperament.</strong> Warm, kind, witty or curious traits warm a date up;
            guarded, shy, cold or serious ones cool it down.
          </li>
          <li>
            <strong>No dice and no AI.</strong> These are the rules Botchelor&apos;s date engine decides every date with,
            minus the luck and the secret agendas a real date adds. Nothing goes into a database: the two characters live
            in the result&apos;s link.
          </li>
        </ul>
        <p className="muted">
          {`${band(...SCORE_BANDS.disaster)} is a disaster, ${band(...SCORE_BANDS.friends)} just friends, and ${band(...SCORE_BANDS.second_date)} a second date.`}
        </p>
      </section>

      <section className="card">
        <h2>Original characters only</h2>
        <p>
          Fictional adults only. The names of well-known real people, anything that suggests someone is under 18, and
          sexual content are refused, by the same filter as Botchelor&apos;s character builder.
        </p>
      </section>

      <section className="card chem-cta">
        <h2>Want to see the date itself?</h2>
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
