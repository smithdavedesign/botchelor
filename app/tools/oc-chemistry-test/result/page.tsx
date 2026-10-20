import type { Metadata } from "next";
import Link from "next/link";
import ShareLink from "@/app/ShareLink";
import {
  cardHref,
  CHEMISTRY_TEST_PATH,
  chemistryTest,
  createHref,
  formValues,
  param,
  readChemistryTest,
  resultHref,
  type ChemistryRead,
  type SheetField,
} from "@/lib/chemistry-test";
import { shortName } from "@/lib/names";
import { ENDING_LABELS } from "@/lib/rules";
import { CHEMISTRY_CARD_ALT, CHEMISTRY_CARD_SIZE } from "../card";
import ChemistryForm from "../ChemistryForm";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// A result is typed text, so it stays out of search (the tool page is the one to rank); its links are still followed.
const ROBOTS = { index: false, follow: true };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const read = readChemistryTest(await searchParams);
  // Refused or incomplete: the tool's title, and nothing of what was typed.
  if (!read.ok) return { title: "OC Chemistry Test · Botchelor", robots: ROBOTS };
  const r = chemistryTest(read.a, read.b);
  const pair = `${read.a.name} × ${read.b.name}`;
  const title = `${pair}: ${ENDING_LABELS[r.ending]} (${r.score}/100)`;
  const description = `${r.reasons[0]} The OC chemistry test's call on their first date, from Botchelor's own date rules.`;
  const card = cardHref(read.a, read.b);
  return {
    title: `${title} · OC Chemistry Test`,
    description,
    robots: ROBOTS,
    openGraph: { type: "website", siteName: "Botchelor", title, description, url: resultHref(read.a, read.b), images: [{ url: card, ...CHEMISTRY_CARD_SIZE, alt: CHEMISTRY_CARD_ALT }] },
    twitter: { card: "summary_large_image", title, description, images: [card] },
  };
}

const FIELD_WORDS: Record<SheetField, string> = {
  name: "name",
  trait1: "first trait",
  trait2: "second trait",
  trait3: "third trait",
  want: "want",
  dealbreaker: "dealbreaker",
};

/** Which box to fix, by the character's name when that's fine to show ("Fitz's want"), else by its place. */
function where(read: Extract<ChemistryRead, { ok: false }>): string | null {
  if (!read.side || !read.field) return null;
  const name = read.keep[param(read.side, "name")];
  const who = name ? `${shortName(name)}'s` : read.side === "a" ? "the first character's" : "the second character's";
  return `${who} ${FIELD_WORDS[read.field]}`;
}

/** What the form needs fixing: /create's own message for it, and the form back with every field that was fine. */
function Fix({ read }: { read: Extract<ChemistryRead, { ok: false }> }) {
  const box = where(read);
  return (
    <section className="card chem-tool">
      <p className="kicker">
        <Link href={CHEMISTRY_TEST_PATH}>OC Chemistry Test</Link>
      </p>
      <h1>{read.error === "empty" ? "Two characters, please" : "One thing to fix first"}</h1>
      <p className="error" role="alert">
        {read.message}
      </p>
      {box && <p className="muted">{`It's in ${box}.`}</p>}
      <ChemistryForm values={read.keep} />
    </section>
  );
}

/**
 * A chemistry test result (lib/chemistry-test.ts) at an address anyone can share: the same answer for everyone, every
 * time, rendered here without a model. It ends on the show's own offer, the real thing, one click into /create with
 * both sheets filled in.
 */
export default async function ChemistryResultPage({ searchParams }: Props) {
  const read = readChemistryTest(await searchParams);
  if (!read.ok) return <Fix read={read} />;

  const r = chemistryTest(read.a, read.b);
  const [a, b] = [shortName(read.a.name), shortName(read.b.name)];
  return (
    <>
      <section className="card chem-tool chem-result">
        <p className="kicker">
          <Link href={CHEMISTRY_TEST_PATH}>OC Chemistry Test</Link>
        </p>
        <h1>{`${read.a.name} × ${read.b.name}`}</h1>
        <div className={`chem-verdict chem-verdict-${r.ending}`} data-score={r.score} data-ending={r.ending}>
          <strong className="chem-score">{`${r.score}/100`}</strong>
          <span className="chem-ending">{ENDING_LABELS[r.ending]}</span>
        </div>
        <h2>Why</h2>
        <ol className="chem-reasons">
          {r.reasons.map((line, i) => (
            <li key={line} data-reason={i + 1}>
              {line}
            </li>
          ))}
        </ol>
        <p className="muted small">
          A prediction from the show&apos;s own rules, read off six lines each. A real date also reads their bios, their
          private side and the night itself, so it can still go another way.
        </p>
        <ShareLink path={resultHref(read.a, read.b)} label="Link to this result" />
      </section>

      <section className="card chem-cta">
        <h2>Now the real thing</h2>
        <p>
          {`The test reads six lines each. On Botchelor the date really happens: an AI writes it in three acts from each character's whole sheet, the same rules decide how it ends, and nobody can steer it, not even you. The builder opens with ${a}'s sheet filled in, then ${b}'s. Two characters of yours don't date each other on the show, so each goes out with this season's cast or a match. Is ${b} a friend's OC? Send them this link: once both are on the show, the two can match in the swipe deck. Free to start, no sign-up.`}
        </p>
        <Link className="button" href={createHref(read.a, read.b)}>
          Watch the real date
        </Link>
      </section>

      <section className="card">
        <h2>Change something and test again</h2>
        <ChemistryForm values={formValues(read.a, read.b)} submit="Test again" />
      </section>
    </>
  );
}
