import type { Metadata } from "next";
import Link from "next/link";
import ShareLink from "@/app/ShareLink";
import { nextQuestion, OC_QUESTION_THEMES, OC_QUESTIONS, OC_QUESTIONS_PATH, ocQuestionHref, readQuestion } from "@/lib/oc-questions";

const COUNT = OC_QUESTIONS.length;
const TITLE = `${COUNT} questions to ask your OC`;
const DESCRIPTION = `${COUNT} questions to ask your original character, by theme: the basics, their past, quirks, love life and dating, friends and rivals, the deep end, and quick fun ones. Or get one at random. Free, no sign-up.`;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const asked = readQuestion((await searchParams).q);
  return {
    title: asked ? `"${asked.text}" · Questions to ask your OC · Botchelor` : `${TITLE}: OC questions by theme · Botchelor`,
    description: asked ? `A question to ask your original character, from ${TITLE.toLowerCase()} on Botchelor.` : DESCRIPTION,
    alternates: { canonical: OC_QUESTIONS_PATH },
    // One question picked out is the same page: shared, followed, not indexed.
    ...(asked ? { robots: { index: false, follow: true } } : {}),
    openGraph: { type: "website", siteName: "Botchelor", title: TITLE, description: DESCRIPTION, url: OC_QUESTIONS_PATH },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  };
}

/**
 * Questions to ask an original character (lib/oc-questions.ts): every question by theme, each with its own anchor,
 * and "ask me one" stepping through them at an address anyone can share. Ends on the love-life questions the show
 * answers by itself.
 */
export default async function OcQuestionsPage({ searchParams }: Props) {
  const asked = readQuestion((await searchParams).q);
  const next = nextQuestion(asked);
  return (
    <>
      <section className="card questions-tool">
        <p className="kicker">A free tool for original characters</p>
        <h1>{TITLE}</h1>
        <p className="lede">
          Questions to get to know your original character, from what they drink in the morning to what they think love
          is. Answer them in your notes, use them for an ask-the-OC post, or take one as a writing prompt.
        </p>
        <div id="ask" className="questions-ask" aria-live="polite">
          {asked ? (
            <>
              <p className="muted small">{asked.theme.title}</p>
              <p className="questions-asked">{asked.text}</p>
              <ShareLink path={ocQuestionHref(asked).replace(/#ask$/, "")} label="Link to this question" />
            </>
          ) : (
            <p>Not sure where to start? Get one question at a time.</p>
          )}
          <Link className="button" href={ocQuestionHref(next)} rel="nofollow">
            {asked ? "Ask me another" : "Ask me a question"}
          </Link>
        </div>
        <nav className="questions-toc" aria-label="Themes">
          {OC_QUESTION_THEMES.map((t) => (
            <a key={t.id} href={`#${t.id}`}>
              {t.title}
            </a>
          ))}
        </nav>
      </section>

      {OC_QUESTION_THEMES.map((theme) => (
        <section key={theme.id} className="card" aria-labelledby={theme.id}>
          <h2 id={theme.id}>{theme.title}</h2>
          <p className="muted">{theme.blurb}</p>
          <ol className="questions-list">
            {theme.questions.map((text, i) => (
              <li key={text} id={`${theme.id}-${i + 1}`}>
                {text}
              </li>
            ))}
          </ol>
          {theme.id === "love" && (
            <p className="questions-love-note">
              Want to see the answers instead of writing them? On Botchelor your character goes on real blind dates,
              written by AI and steered by nobody, and texts you how it went. <Link href="/create">Make your character</Link>.
            </p>
          )}
        </section>
      ))}

      <section className="card questions-cta">
        <h2>Answered them all? Send them on a date</h2>
        <p>
          Botchelor is a blind-date show for original characters. The answers you&apos;ve written become how they act on
          a date nobody can steer, not even you, while friends guess how it ends. Free to start, no sign-up.
        </p>
        <Link className="button" href="/create">
          Make your character
        </Link>
        <p className="muted small">
          More free tools: the <Link href="/tools/oc-name-generator">OC name generator</Link>, the{" "}
          <Link href="/tools/ship-name-generator">ship name generator</Link> and the{" "}
          <Link href="/tools/oc-chemistry-test">OC chemistry test</Link>.
        </p>
      </section>
    </>
  );
}
