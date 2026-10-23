import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import ShareLink from "@/app/ShareLink";
import {
  CHEMISTRY_TEST_PATH,
  chemistryQuery,
  chemistryResultHref,
  chemistryTest,
  createPairHref,
  errorPlace,
  pairFormValues,
  readChemistry,
} from "@/lib/chemistry-test";
import { shortName } from "@/lib/names";
import { ENDING_LABELS } from "@/lib/rules";
import ChemistryForm from "../ChemistryForm";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const read = readChemistry(await searchParams);
  // Refused or incomplete: the tool's title, nothing of what was typed, and kept out of search.
  if (!read.ok) return { title: "OC Chemistry Test · Botchelor", robots: { index: false, follow: false } };
  const { a, b } = read;
  const { score, ending, reasons } = chemistryTest(a, b);
  const title = `${a.name} × ${b.name}: ${score}/100 chemistry, ${ENDING_LABELS[ending].toLowerCase()}`;
  const description = `${reasons.join(" ")} From Botchelor's free OC Chemistry Test.`;
  const href = chemistryResultHref(a, b);
  const card = { url: `/api/og/chemistry?${chemistryQuery(a, b)}`, width: 1200, height: 630, alt: `${a.name} × ${b.name}: ${score}/100 on Botchelor's OC Chemistry Test` };
  return {
    title: `${title} · OC Chemistry Test · Botchelor`,
    description,
    alternates: { canonical: href },
    // A result is a link to share; what people typed stays out of search (the tool is the page to find).
    robots: { index: false, follow: true },
    openGraph: { type: "website", siteName: "Botchelor", title, description, url: href, images: [card] },
    twitter: { card: "summary_large_image", title, description, images: [card.url] },
  };
}

/**
 * A pair's chemistry (lib/chemistry-test.ts), at an address anyone can share: the same answer for everyone, every
 * time, with no model and nothing stored. It ends on the show itself: "Watch the real date" opens /create with both
 * characters in.
 */
export default async function ChemistryResultPage({ searchParams }: Props) {
  const read = readChemistry(await searchParams);
  if (!read.ok && read.empty) redirect(CHEMISTRY_TEST_PATH);
  if (!read.ok) {
    const place = errorPlace(read.error, read.form);
    return (
      <section className="card chem-tool">
        <p className="kicker">
          <Link href={CHEMISTRY_TEST_PATH}>OC Chemistry Test</Link>
        </p>
        <h1>Check those two characters</h1>
        <p className="error" role="alert">
          {read.error.kind === "rejected" ? `${read.error.message} Check ${place}.` : `${place[0].toUpperCase()}${place.slice(1)}: ${read.error.message}`}
        </p>
        <ChemistryForm values={read.form} />
      </section>
    );
  }

  const { a, b } = read;
  const { score, ending, reasons } = chemistryTest(a, b);
  const first = shortName(a.name);
  const second = shortName(b.name);
  return (
    <>
      <section className="card chem-tool chem-result">
        <p className="kicker">
          <Link href={CHEMISTRY_TEST_PATH}>OC Chemistry Test</Link>
        </p>
        <h1>{`${a.name} × ${b.name}`}</h1>
        <div className={`chem-score chem-${ending}`} data-score={score} data-ending={ending}>
          <p className="chem-score-num">
            <strong>{score}</strong>
            <span>/100 chemistry</span>
          </p>
          <meter min={0} max={100} low={40} high={65} optimum={100} value={score} aria-label="Chemistry score" />
          <p className="chem-ending">
            Predicted ending: <strong>{ENDING_LABELS[ending]}</strong>
          </p>
        </div>
        <h2 className="chem-why">Why</h2>
        <ol className="chem-reasons">
          {reasons.map((reason) => (
            <li key={reason} data-reason>
              {reason}
            </li>
          ))}
        </ol>
        <ShareLink path={chemistryResultHref(a, b)} label="Link to this result" />
      </section>

      <section className="card chem-cta">
        <h2>That was the test. The date is the show.</h2>
        <p>
          {`The test reads five fields. On Botchelor, ${first} goes on a real blind date, written by AI and steered by nobody, not even you, while friends guess how it ends. The builder opens with ${first}'s fields in and ${second}'s one click away. Free to start, no sign-up.`}
        </p>
        <Link className="button" href={createPairHref(a, b)}>
          Watch the real date
        </Link>
        <p className="muted small">
          {`Two characters made by the same person don't date each other, so ${first} meets this season's house cast, a match from the swipe deck, or a blind date.`}
        </p>
      </section>

      <section className="card">
        <h2>Try another pair</h2>
        <ChemistryForm values={pairFormValues(a, b)} submit="Test again" />
      </section>
    </>
  );
}
