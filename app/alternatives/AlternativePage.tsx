import Link from "next/link";
import JsonLd from "@/app/JsonLd";
import { alternativeFaq, alternativePath, type Alternative } from "@/lib/alternatives";
import { IMPORT_PATH } from "@/lib/import-character";
import { breadcrumbJsonLd } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

/**
 * A landing page for people moving their characters out of a chat app (searches like "<app> alternative"): what
 * Botchelor is, plainly, and the way in (/import). Nominative only: it names the app to say what you can bring from it,
 * claims nothing about it, and uses none of its marks. One template for every app in lib/alternatives.ts.
 */
export default function AlternativePage({ alt }: { alt: Alternative }) {
  const base = siteUrl();
  const path = alternativePath(alt.slug);
  const faq = alternativeFaq(alt);
  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Botchelor", path: "/" },
            { name: "Bring your character", path: IMPORT_PATH },
            { name: `Moving from ${alt.name}`, path },
          ], base),
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            url: `${base}${path}`,
            mainEntity: faq.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
          },
        ]}
      />
      <section className="card import-tool">
        <p className="kicker">Moving your characters?</p>
        <h1>A new home for the characters you made</h1>
        <p className="lede">{alt.lede} Paste them in, and they get a life here: dates on a show, and one-to-one talks.</p>
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
          {faq.map(({ q, a }) => (
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
