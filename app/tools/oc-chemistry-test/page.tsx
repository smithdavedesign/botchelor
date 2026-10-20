import type { Metadata } from "next";
import Link from "next/link";
import { CHEMISTRY_CARD_PATH, CHEMISTRY_TEST_PATH, resultHref, SAMPLE_PAIR, SCORE_BANDS } from "@/lib/chemistry-test";
import { shortName } from "@/lib/names";
import { CHEMISTRY_CARD_ALT, CHEMISTRY_CARD_SIZE } from "./card";
import ChemistryForm from "./ChemistryForm";

const TITLE = "OC Chemistry Test";
const DESCRIPTION =
  "A free chemistry test for original characters: give two OCs three traits, a want and a dealbreaker each, and see if their first date ends in a second date, just friends or a disaster. A score out of 100 and three reasons, on a link you can share. No sign-up.";
const [EXAMPLE_A, EXAMPLE_B] = SAMPLE_PAIR;

export const metadata: Metadata = {
  title: `${TITLE}: will these two make it? · Botchelor`,
  description: DESCRIPTION,
  alternates: { canonical: CHEMISTRY_TEST_PATH },
  openGraph: {
    type: "website",
    siteName: "Botchelor",
    title: `${TITLE}: will these two make it?`,
    description: DESCRIPTION,
    url: CHEMISTRY_TEST_PATH,
    images: [{ url: CHEMISTRY_CARD_PATH, ...CHEMISTRY_CARD_SIZE, alt: CHEMISTRY_CARD_ALT }],
  },
  twitter: { card: "summary_large_image", title: `${TITLE}: will these two make it?`, description: DESCRIPTION, images: [CHEMISTRY_CARD_PATH] },
};

const band = (ending: keyof typeof SCORE_BANDS) => SCORE_BANDS[ending].join(" to ");

/**
 * The OC chemistry test (lib/chemistry-test.ts): a page for people searching for character chemistry and OC
 * relationship tests. Two sheets go to their own shareable result, which ends one click from /create.
 */
export default function ChemistryTestPage() {
  return (
    <>
      <section className="card chem-tool">
        <p className="kicker">A free test for original characters</p>
        <h1>{TITLE}</h1>
        <p className="lede">
          Will these two make it? Three traits, a want and a dealbreaker each, and the show&apos;s own date rules call
          their first date: a second date, just friends or a disaster.
        </p>
        <ChemistryForm />
        <p className="muted small">
          Free, no sign-up. No AI writes the result, and the same two sheets always get the same answer, so the page it
          lands on is a link you can share. Try{" "}
          <Link href={resultHref(EXAMPLE_A, EXAMPLE_B)}>{`${shortName(EXAMPLE_A.name)} × ${shortName(EXAMPLE_B.name)}`}</Link>.
          Nothing you type is saved to an account or a database: the two sheets live in the result&apos;s link, so whoever
          you share it with sees them, dealbreakers included.
        </p>
      </section>

      <section className="card">
        <h2>How the test works</h2>
        <ul className="chem-how-list">
          <li>
            <strong>The show&apos;s own rules.</strong> On Botchelor, a rules engine decides how a date ends before a word
            of it is written. The test runs that engine on what you type, as a first date at the show&apos;s usual
            settings.
          </li>
          <li>
            <strong>A dealbreaker ends it.</strong> If one character&apos;s dealbreaker turns up in the other&apos;s traits
            or want, it&apos;s a disaster, whatever else they share.
          </li>
          <li>
            <strong>Wants and shared traits help.</strong> Something in one sheet that the other wants lifts attraction,
            a trait they share lifts chemistry, and traits like warm, witty or guarded change how the night goes.
          </li>
          <li>
            <strong>The score.</strong> {band("disaster")} is a disaster, {band("friends")} just friends, and{" "}
            {SCORE_BANDS.second_date[0]} and up a second date. Three reasons come with it, read off the same numbers.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>Original characters only</h2>
        <p>
          It&apos;s made for OCs, and every one is a fictional adult. Anything suggesting someone is under 18, a real
          person or sexual content is refused, with the same rules and the same words as the show&apos;s character
          builder.
        </p>
      </section>

      <section className="card chem-cta">
        <h2>Got an OC? Watch a real date</h2>
        <p>
          The test reads six lines a character. On Botchelor, your character goes on a real blind date: an AI writes it
          in three acts from their whole sheet, the same rules decide how it ends, nobody can steer it, not even you, and
          friends guess the ending first. Free to start, no sign-up.
        </p>
        <Link className="button" href="/create">
          Make your character
        </Link>
      </section>
    </>
  );
}
