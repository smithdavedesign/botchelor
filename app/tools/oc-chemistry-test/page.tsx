import type { Metadata } from "next";
import Link from "next/link";
import { CHEMISTRY_PATH, FRIENDS_SCORE, resultPath, SECOND_DATE_SCORE, type ChemistrySheet } from "@/lib/chemistry";
import ChemistryForm from "./ChemistryForm";

const TITLE = "OC Chemistry Test";
const DESCRIPTION =
  "A free chemistry test for original characters: give two OCs three traits, a want and a dealbreaker each, and get a score out of 100 and how their first date would end. No sign-up.";

export const metadata: Metadata = {
  title: `${TITLE}: will these two characters make it? · Botchelor`,
  description: DESCRIPTION,
  alternates: { canonical: CHEMISTRY_PATH },
  openGraph: { type: "website", siteName: "Botchelor", title: `${TITLE}: will these two make it?`, description: DESCRIPTION, url: CHEMISTRY_PATH },
  twitter: { card: "summary_large_image", title: `${TITLE}: will these two make it?`, description: DESCRIPTION },
};

/** The example pair the page links to (the form's placeholders), so a crawler and a curious visitor both find a result. */
const EXAMPLE: [ChemistrySheet, ChemistrySheet] = [
  { name: "Mira Quell", age: 29, traits: ["curious", "stubborn", "witty"], want: "Someone who gets lost on purpose", dealbreaker: "People glued to their phone" },
  { name: "Otto Brand", age: 34, traits: ["bold", "warm", "funny"], want: "A curious mind", dealbreaker: "Arrogance" },
];

/**
 * The OC chemistry test (lib/chemistry.ts): a page for writers searching "character chemistry test". Two sheets go to
 * their own shareable result, which ends one click from /create.
 */
export default function ChemistryTestPage() {
  return (
    <>
      <section className="card chem-tool">
        <p className="kicker">A free tool for original characters</p>
        <h1>{TITLE}</h1>
        <p className="lede">
          Will your two characters make it? Give each one three traits, a want and a dealbreaker. The test scores their
          chemistry out of 100 and predicts how a first date ends: a second date, just friends or a disaster.
        </p>
        <ChemistryForm />
        <p className="muted small">
          Free, no sign-up, nothing saved. The same two characters always get the same result, so the page you land on
          is a link you can share. See an example: <Link href={resultPath(...EXAMPLE)}>Mira Quell × Otto Brand</Link>.
        </p>
      </section>

      <section className="card">
        <h2>How the test works</h2>
        <ul className="ship-how-list">
          <li>
            <strong>It&apos;s the show&apos;s own engine.</strong> Botchelor is a blind-date show for original characters,
            and a set of rules decides how every date ends before it starts. The test runs those rules on your two sheets.
          </li>
          <li>
            <strong>Wants and dealbreakers come first.</strong> When one character has what the other wants (a word of it
            in their traits or their want), the attraction rises. When one trips the other&apos;s dealbreaker, it&apos;s a
            disaster, every time.
          </li>
          <li>
            <strong>Traits set the temperament.</strong> Warm, guarded, quick to joke or game for anything: the words in
            their traits move chemistry, trust, attraction and awkwardness, and a trait they share warms things up.
          </li>
          <li>
            <strong>No AI writes the result.</strong> It&apos;s arithmetic: instant and free. As on the show, each side
            is dealt a secret agenda and the night gets a roll of the dice, but here both come from the two sheets, so
            the same two characters always get the same result.
          </li>
          <li>
            <strong>The score.</strong> Under {FRIENDS_SCORE} is a disaster, {FRIENDS_SCORE} to {SECOND_DATE_SCORE - 1}{" "}
            just friends, and {SECOND_DATE_SCORE} or more a second date.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>Original characters only</h2>
        <p>
          It&apos;s made for OCs, and every one is a fictional adult. Real people, anyone under 18 and sexual content are
          refused, by the same rules as the show.
        </p>
      </section>

      <section className="card ship-cta">
        <h2>Want to see the date itself?</h2>
        <p>
          On Botchelor the date really happens: an AI plays each character in a three-act blind date nobody can steer,
          not even you, while friends guess how it ends. Free to start, no sign-up.
        </p>
        <Link className="button" href="/create">
          Make your character
        </Link>
      </section>
    </>
  );
}
