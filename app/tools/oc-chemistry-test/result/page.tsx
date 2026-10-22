import type { Metadata } from "next";
import Link from "next/link";
import ShareLink from "@/app/ShareLink";
import {
  cardPath,
  CHEMISTRY_PATH,
  chemistryTest,
  createHref,
  FIELD_LABELS,
  readPair,
  resultPath,
  SIDE_LABELS,
  sheetValues,
} from "@/lib/chemistry";
import { pairNames } from "@/lib/names";
import { ENDING_LABELS } from "@/lib/rules";
import ChemistryForm from "../ChemistryForm";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TOOL_TITLE = "OC Chemistry Test";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const pair = readPair(await searchParams);
  // Refused, unreadable or empty: the test's title, nothing of what was typed, and kept out of search.
  if (!pair.ok) return { title: `${TOOL_TITLE} · Botchelor`, robots: { index: false, follow: false } };
  const { a, b } = pair;
  const r = chemistryTest(a, b);
  const ending = ENDING_LABELS[r.ending].toLowerCase();
  const title = `${a.name} × ${b.name}: ${r.score}/100, ${ending}`;
  const description = `Botchelor's free OC chemistry test predicts ${ending} for ${a.name} and ${b.name}. ${r.reasons[0]}`;
  const image = { url: cardPath(a, b), width: 1200, height: 630, alt: `${a.name} × ${b.name}: ${r.score}/100, ${ending}` };
  return {
    title: `${a.name} × ${b.name} chemistry test: ${r.score}/100 · Botchelor`,
    description,
    // Every result is its own address, full of free text: made to share, not to index (the test's page is).
    robots: { index: false, follow: true },
    openGraph: { type: "website", siteName: "Botchelor", title, description, url: resultPath(a, b), images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

/**
 * One OC chemistry test result (lib/chemistry.ts), at an address anyone can share: the two sheets are the address, so
 * everyone sees the same score, ending and reasons. It ends on the show's own offer, "Watch the real date", one click
 * into /create with both sheets carried along.
 */
export default async function ChemistryResultPage({ searchParams }: Props) {
  const pair = readPair(await searchParams);
  if (!pair.ok) {
    return (
      <section className="card chem-tool">
        <p className="kicker">
          <Link href={CHEMISTRY_PATH}>{TOOL_TITLE}</Link>
        </p>
        <h1>{pair.empty ? "Test two characters" : "Those sheets can't be tested"}</h1>
        {pair.empty ? (
          <p className="muted">Fill in both characters to see their chemistry.</p>
        ) : (
          <ul className="error chem-problems" role="alert">
            {pair.problems.map((p) => (
              <li key={`${p.side}-${p.field}-${p.message}`}>
                <strong>{`${SIDE_LABELS[p.side]}, ${FIELD_LABELS[p.field]}:`}</strong> {p.message}
              </li>
            ))}
          </ul>
        )}
        <ChemistryForm values={pair.values} />
      </section>
    );
  }

  const { a, b } = pair;
  const r = chemistryTest(a, b);
  const [na, nb] = pairNames(a.name, b.name);
  return (
    <>
      <section className="card chem-tool chem-result">
        <p className="kicker">
          <Link href={CHEMISTRY_PATH}>{TOOL_TITLE}</Link>
        </p>
        <h1>{`${a.name} × ${b.name}`}</h1>
        <div className={`chem-verdict chem-${r.ending}`} data-chemistry-ending={r.ending}>
          <p className="chem-score" data-chemistry-score={r.score}>
            <strong>{r.score}</strong>
            <span>/100</span>
          </p>
          <p className="chem-ending">
            <span className="muted">Predicted ending</span>
            <strong>{ENDING_LABELS[r.ending]}</strong>
          </p>
        </div>
        <h2>Why</h2>
        <ol className="chem-reasons">
          {r.reasons.map((reason) => (
            <li key={reason} data-reason="">
              {reason}
            </li>
          ))}
        </ol>
        <ShareLink path={resultPath(a, b)} label="Link to this result" />
      </section>

      <section className="card ship-cta chem-cta">
        <h2>Watch the real date</h2>
        <p>
          {`This test reads a few lines of each sheet. On Botchelor the date really happens: an AI plays each character through a three-act blind date nobody can steer, not even you, and friends guess how it ends. The show reads more than the test does (a bio, a private soul, the settings you pick), so a real date can end differently.`}
        </p>
        <p>
          {`Your characters date the show's house cast and other creators' characters, not each other, so start with ${na}: the builder opens with ${na}'s sheet filled in, and ${nb}'s is a click away. Free to start, no sign-up.`}
        </p>
        <Link className="button" href={createHref(a, b)}>
          Watch the real date
        </Link>
      </section>

      <section className="card">
        <details className="chem-again">
          <summary>Change a sheet and test again</summary>
          <ChemistryForm values={{ a: sheetValues(a), b: sheetValues(b) }} submit="Test again" />
        </details>
        <p className="muted small">
          <Link href={CHEMISTRY_PATH}>Test another pair</Link> · <Link href="/tools/ship-name-generator">Make their ship name</Link>
        </p>
      </section>
    </>
  );
}
