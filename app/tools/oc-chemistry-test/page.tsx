import type { Metadata } from "next";
import Link from "next/link";
import { CHEMISTRY_EXAMPLE, CHEMISTRY_TEST_PATH, chemistryResultHref, SCORE_BANDS } from "@/lib/chemistry-test";
import ChemistryForm from "./ChemistryForm";
import NamesForm from "./NamesForm";
import MoreTools from "../MoreTools";
import JsonLd from "@/app/JsonLd";
import { toolJsonLd } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import { RANDOM_SHIP_TOOL_PATH } from "@/lib/tools";

const TITLE = "Ship compatibility test";
const DESCRIPTION =
  "A free ship compatibility test and love calculator: two names get a quick score, and two characters with three traits, a want and a dealbreaker each get their chemistry out of 100 and why, on a link you can share. For fun, no sign-up.";
/** What a search result shows, in full (lib/seo.ts DESCRIPTION_MAX); the share cards keep DESCRIPTION. */
const SEARCH_DESCRIPTION = "Free ship compatibility test and love calculator: two names, two OCs or a fandom ship, and a score out of 100 and why. For fun, no sign-up.";
const CARD = { url: "/api/og/chemistry", width: 1200, height: 630, alt: "Botchelor's free ship compatibility test: will these two make it?" };

// Re-aimed 2026-11-23 at what people search ("ship compatibility test", "love calculator"), at the address the OC
// chemistry test always had, which Search Console already knows.
export const metadata: Metadata = {
  title: `${TITLE}: a love calculator for OCs and ships · Botchelor`,
  description: SEARCH_DESCRIPTION,
  alternates: { canonical: CHEMISTRY_TEST_PATH },
  openGraph: { type: "website", siteName: "Botchelor", title: `${TITLE}: will these two make it?`, description: DESCRIPTION, url: CHEMISTRY_TEST_PATH, images: [CARD] },
  twitter: { card: "summary_large_image", title: `${TITLE}: will these two make it?`, description: DESCRIPTION, images: [CARD.url] },
};

/** The example the page links to: a result anyone can open (lib/chemistry-test.ts, also the Tools page's preview). */
const EXAMPLE = CHEMISTRY_EXAMPLE;

const band = (lo: number, hi: number) => `${lo} to ${hi}`;

/** What people ask a love calculator, answered once: the page shows these words and its FAQPage data says the same. */
const CHEMISTRY_FAQ: readonly { q: string; a: string }[] = [
  {
    q: "How is it worked out?",
    a:
      "For fun, and in the open. With just two names it's the playground count: write TRUE LOVE under them, count how many times each of its letters turns up in the two names, then add each number to the one beside it, row after row, until two digits are left. " +
      "With three traits, a want and a dealbreaker each, it borrows the rules Botchelor's date engine plays by: traits they share, a want the other one meets, the words that warm a date up or cool it down, and a dealbreaker that's right there in the other one's traits. " +
      "No AI and no dice, so the same two always get the same answer.",
  },
  {
    q: "What does the score mean?",
    a:
      `From two names, nothing but letters. From two characters, how they look on paper: ${band(...SCORE_BANDS.disaster)} reads as a disaster, ${band(...SCORE_BANDS.friends)} as just friends, and ${band(...SCORE_BANDS.second_date)} as a second date. ` +
      "It isn't a forecast: a real date on Botchelor adds luck and secret agendas, and the show's engine decides how every one ends.",
  },
  {
    q: "Does it work for OCs, a fandom ship or just two names?",
    a:
      "All three. Two names is the quick way in. For your own characters, or a ship from a book, a game or a show, add what you know about each one, and the reading is about who they are. " +
      "The names of well-known real people, anything that suggests someone is under 18, and sexual words are refused, by the same filter as Botchelor's character builder.",
  },
  {
    q: "Is anything I type saved?",
    a: "No. Nothing goes into a database or an account: the names live only in the result's link, so it's yours to share or not.",
  },
];

/**
 * The ship compatibility test (lib/chemistry-test.ts), once the OC chemistry test: a page for people searching for a
 * ship compatibility test or a love calculator. Two names go to the quick reading (lib/true-love.ts); two whole
 * characters to the full one. Either result is a link to share, and ends one click from /create.
 */
export default function ChemistryTestPage() {
  const base = siteUrl();
  return (
    <>
      <section className="card chem-tool">
        <p className="kicker">A love calculator for OCs and ships</p>
        <h1>{TITLE}</h1>
        <p className="lede">
          Will these two make it? Type two names for a quick score, or tell the test who they are for their chemistry out of
          100 and why. OCs, a fandom ship or any two names.
        </p>
        <NamesForm />
        <p className="muted small">
          Free, no sign-up, and just for fun. The same two always get the same answer, so the result is a link you can
          share. No pair in mind? The <Link href={RANDOM_SHIP_TOOL_PATH}>random ship generator</Link> picks one.
        </p>
      </section>

      <section className="card" id="full-test">
        <h2>The full chemistry test</h2>
        <p>
          Three traits, a want and a dealbreaker each, and the test reads who they are, not just their names: their chemistry
          out of 100, how a first date goes on paper, and why. Try <Link href={chemistryResultHref(...EXAMPLE)}>Juniper × Dex</Link>.
        </p>
        <ChemistryForm />
      </section>

      <section className="card">
        <h2>How the full test reads them</h2>
        <ul className="chem-how-list">
          <li>
            <strong>Being the other one&apos;s dealbreaker ends it.</strong> If one character&apos;s dealbreaker names
            one of the other&apos;s traits (&ldquo;brash people&rdquo; and &ldquo;brash&rdquo;), it&apos;s a disaster,
            whatever else they share.
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
            <strong>No dice and no AI.</strong> It borrows the rules Botchelor&apos;s date engine plays by, minus the luck
            and the secret agendas a real date adds, so it can&apos;t tell how a date on the show will end. Nothing goes
            into a database: the two characters live in the result&apos;s link.
          </li>
        </ul>
        <p className="muted">
          {`${band(...SCORE_BANDS.disaster)} is a disaster, ${band(...SCORE_BANDS.friends)} just friends, and ${band(...SCORE_BANDS.second_date)} a second date.`}
        </p>
      </section>

      <section className="card chem-faq">
        <h2>Questions</h2>
        {CHEMISTRY_FAQ.map(({ q, a }) => (
          <div key={q} className="chem-faq-item">
            <h3>{q}</h3>
            <p>{a}</p>
          </div>
        ))}
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "FAQPage",
            url: `${base}${CHEMISTRY_TEST_PATH}`,
            mainEntity: CHEMISTRY_FAQ.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
          }}
        />
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
        <MoreTools current={CHEMISTRY_TEST_PATH} />
        {/* The tool as a free web app under the tools hub, for search (lib/seo.ts toolJsonLd). */}
        <JsonLd data={toolJsonLd(CHEMISTRY_TEST_PATH)} />
      </section>
    </>
  );
}
