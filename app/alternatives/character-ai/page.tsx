import type { Metadata } from "next";
import Link from "next/link";
import JsonLd from "@/app/JsonLd";
import { COMPANION_FREE_PER_DAY } from "@/lib/companion-shared";
import { CHARACTER_AI_ALTERNATIVE_PATH, IMPORT_PATH } from "@/lib/import-character";
import { FREE_EPISODES_PER_SEASON } from "@/lib/rules";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

const ALTERNATIVE_PATH = CHARACTER_AI_ALTERNATIVE_PATH;

export const metadata: Metadata = pageMetadata({
  title: "Moving your characters from Character.AI? · Botchelor",
  description:
    "If you're moving characters you made on Character.AI or another chat app, Botchelor is one place they can go: paste them in, and they go on AI-written blind dates on a show, or talk with you one to one as a Companion. Free to start.",
  path: ALTERNATIVE_PATH,
});

/** The questions on the page, and in its FAQPage structured data: the same words in both. */
const FAQ: { q: string; a: string }[] = [
  {
    q: "Can I bring a character I made on Character.AI?",
    a: "Yes, if you made it. Copy its creator fields (Name, Tagline, Description, Greeting, Definition) and paste them on the import page; the builder opens with them filled in. Botchelor isn't connected to Character.AI: you copy what you wrote, and nothing is fetched from your account there.",
  },
  {
    q: "What about SillyTavern or TavernAI cards?",
    a: "Paste the card's JSON (V1, V2 or V3), or open the card's PNG: name, description, personality, greeting and example dialogue are read in your browser. The picture itself isn't uploaded.",
  },
  {
    q: "Is it the same kind of app?",
    a: "No. Botchelor is a dating show for characters: yours goes on blind dates with other characters, written by AI, that nobody steers, not even you, and people predict how they end. You can also talk with a character one to one as a Companion.",
  },
  {
    q: "What does it cost?",
    a: `Building characters is free. Each person gets ${FREE_EPISODES_PER_SEASON} free dates a week, and Companions have ${COMPANION_FREE_PER_DAY} free replies a day; paid extras are optional and priced before you buy.`,
  },
  {
    q: "What isn't allowed?",
    a: "Every character is a fictional adult. Anything suggesting someone is under 18, or a real person, stops an import. The show is PG, so lines that aren't are left out.",
  },
];

/**
 * A landing page for people moving their characters out of a chat app (searches like "Character.AI alternative"): what
 * Botchelor is, plainly, and the way in (/import). Nominative only: it names the app to say what you can bring from it,
 * claims nothing about it, and uses none of its marks.
 */
export default function CharacterAiAlternativePage() {
  const base = siteUrl();
  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Botchelor", path: "/" },
            { name: "Bring your character", path: IMPORT_PATH },
            { name: "Moving from Character.AI", path: ALTERNATIVE_PATH },
          ], base),
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            url: `${base}${ALTERNATIVE_PATH}`,
            mainEntity: FAQ.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
          },
        ]}
      />
      <section className="card import-tool">
        <p className="kicker">Moving your characters?</p>
        <h1>A new home for the characters you made</h1>
        <p className="lede">
          If you&apos;re moving your characters from Character.AI, SillyTavern or another chat app, Botchelor is one place
          they can go. Paste them in, and they get a life here: dates on a show, and one-to-one talks.
        </p>
        <p>
          <Link className="button" href={IMPORT_PATH}>
            Bring your character
          </Link>
        </p>
        <p className="muted small">Free to start. Nothing is saved until you press Create.</p>
      </section>

      <section className="card">
        <h2>What your character does here</h2>
        <ul className="import-how-list">
          <li>
            <strong>Goes on blind dates, on a show.</strong> Your character meets other people&apos;s characters and this
            month&apos;s cast. AI writes the date in their voice, and nobody steers it, not even you: their traits, wants
            and dealbreakers decide how it ends. Friends predict the ending, for free points. <Link href="/watch">Watch a date</Link>.
          </li>
          <li>
            <strong>Talks with you one to one.</strong> As a <Link href="/companion">Companion</Link>, your character (or
            anyone open to it) chats with you and remembers what you tell them.
          </li>
          <li>
            <strong>Builds a history.</strong> Matches, second dates, texts the morning after, and a season that ends in a
            finale. Dates they&apos;ve been on shape the ones to come.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>How bringing them over works</h2>
        <ol className="import-how-list">
          <li>Copy what you wrote: the creator fields with their labels, a character card&apos;s JSON, or its PNG.</li>
          <li>
            Paste it on <Link href={IMPORT_PATH}>Bring your character</Link>. Labelled fields and cards are read in your
            browser; plain text without labels is read once by the show&apos;s free model.
          </li>
          <li>
            The builder opens with their name, bio, traits, voice and hello filled in. Add what a date needs (what they
            want, a dealbreaker, a short dating profile) and create them.
          </li>
        </ol>
        <p className="muted small">
          Chat histories, scenarios and long roleplay setups stay behind: a date needs who they are, not a scene.
        </p>
      </section>

      <section className="card">
        <h2>Questions</h2>
        <dl className="import-faq">
          {FAQ.map(({ q, a }) => (
            <div key={q}>
              <dt>{q}</dt>
              <dd>{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card chem-cta">
        <h2>Bring one character, see what happens</h2>
        <p>Paste them in, fill in the gaps, and send them on their first date.</p>
        <Link className="button" href={IMPORT_PATH}>
          Bring your character
        </Link>
      </section>
    </>
  );
}
