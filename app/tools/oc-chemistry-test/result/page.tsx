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
  namesQuery,
  namesResultHref,
  pairFormValues,
  readChemistry,
  readNamePair,
  type ChemistryError,
  type ChemistryForm as FormValues,
} from "@/lib/chemistry-test";
import { shortName } from "@/lib/names";
import { ENDING_LABELS } from "@/lib/rules";
import { shipPair, shipPath } from "@/lib/ship-names";
import { RANDOM_SHIP_TOOL_PATH } from "@/lib/tools";
import { TRUE_LOVE, trueLove } from "@/lib/true-love";
import ChemistryForm from "../ChemistryForm";
import NamesForm from "../NamesForm";
import MoreTools from "../../MoreTools";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The tool's name since 2026-11-23 (lib/tools.ts), at the address the OC chemistry test always had. */
const TOOL_NAME = "Ship compatibility test";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const names = readNamePair(sp);
  if (names?.ok) {
    const { a, b } = names;
    const { score } = trueLove(a, b);
    const title = `${a} × ${b}: ${score}% on the love calculator`;
    const description = `The playground TRUE LOVE count for ${a} and ${b} comes to ${score}%. Just for fun, from Botchelor's free ship compatibility test.`;
    const href = namesResultHref(a, b);
    const card = { url: `/api/og/chemistry?${namesQuery(a, b)}`, width: 1200, height: 630, alt: `${a} × ${b}: ${score}% on Botchelor's love calculator` };
    return {
      title: `${title} · Botchelor`,
      description,
      alternates: { canonical: href },
      // A result is a link to share; the names people type stay out of search (the tool is the page to find).
      robots: { index: false, follow: true },
      openGraph: { type: "website", siteName: "Botchelor", title, description, url: href, images: [card] },
      twitter: { card: "summary_large_image", title, description, images: [card.url] },
    };
  }
  // Refused or incomplete: the tool's title, nothing of what was typed, and kept out of search.
  if (names) return { title: `${TOOL_NAME} · Botchelor`, robots: { index: false, follow: false } };
  const read = readChemistry(sp);
  if (!read.ok) return { title: `${TOOL_NAME} · Botchelor`, robots: { index: false, follow: false } };
  const { a, b } = read;
  const { score, ending, reasons } = chemistryTest(a, b);
  const title = `${a.name} × ${b.name}: ${score}/100 chemistry, ${ENDING_LABELS[ending].toLowerCase()} on paper`;
  const description = `${reasons.join(" ")} From Botchelor's free ship compatibility test.`;
  const href = chemistryResultHref(a, b);
  const card = { url: `/api/og/chemistry?${chemistryQuery(a, b)}`, width: 1200, height: 630, alt: `${a.name} × ${b.name}: ${score}/100 on Botchelor's ship compatibility test` };
  return {
    title: `${title} · ${TOOL_NAME} · Botchelor`,
    description,
    alternates: { canonical: href },
    // A result is a link to share; what people typed stays out of search (the tool is the page to find).
    robots: { index: false, follow: true },
    openGraph: { type: "website", siteName: "Botchelor", title, description, url: href, images: [card] },
    twitter: { card: "summary_large_image", title, description, images: [card.url] },
  };
}

/** What's wrong with the two, in words: the filter's own message and where, or a field's shape. */
function errorText(error: ChemistryError, form: FormValues): string {
  const place = errorPlace(error, form);
  return error.kind === "rejected" ? `${error.message} Check ${place}.` : `${place[0].toUpperCase()}${place.slice(1)}: ${error.message}`;
}

/**
 * The pair's ship name, from the ship name generator (a link to their ship page, not for crawlers: what someone typed
 * isn't a page to find), and the random ship generator: the result's links to the ship tools.
 */
function ShipLinks({ a, b }: { a: string; b: string }) {
  const pair = shipPair(shortName(a), shortName(b));
  const top = pair.ok ? pair.names[0] : undefined;
  return (
    <p className="small chem-more">
      {pair.ok && top && (
        <>
          Their ship name:{" "}
          <Link href={shipPath(pair.a, pair.b)} rel="nofollow" data-track="chem-ship-names">
            {top.name}
          </Link>
          {" · "}
        </>
      )}
      <Link href={RANDOM_SHIP_TOOL_PATH} data-track="chem-random-ship">
        Get a random ship
      </Link>
    </p>
  );
}

/** Two names, read the playground way (lib/true-love.ts), with every row of the working. */
function NamesResult({ a, b }: { a: string; b: string }) {
  const { rows, score } = trueLove(a, b);
  const first = shortName(a);
  const second = shortName(b);
  return (
    <>
      <section className="card chem-tool chem-result">
        <p className="kicker">
          <Link href={CHEMISTRY_TEST_PATH}>{TOOL_NAME}</Link>
        </p>
        <h1>{`${a} × ${b}`}</h1>
        <div className="chem-score chem-letters" data-score={score} data-mode="names">
          <p className="chem-score-num">
            <strong>{`${score}%`}</strong>
            <span>by the letters</span>
          </p>
          <meter min={0} max={100} value={score} aria-label="Love calculator score" />
          <p className="chem-ending">The playground TRUE LOVE count, just for fun.</p>
        </div>
        <h2 className="chem-why">How the letters add up</h2>
        <p>
          Write TRUE LOVE under the two names and count how many times each of its letters turns up in them. Then add each
          number to the one beside it, row after row, until two digits are left (13 counts as 1 + 3).
        </p>
        <div className="true-love" role="img" aria-label={`The working: ${rows.map((r) => r.join(" ")).join(", then ")}. That makes ${score}.`}>
          <p className="true-love-row true-love-head">
            {[...TRUE_LOVE].map((letter, i) => (
              <span key={i}>{letter}</span>
            ))}
          </p>
          {rows.map((row, i) => (
            <p key={i} className="true-love-row" data-row={i}>
              {row.map((n, j) => (
                <span key={j}>{n}</span>
              ))}
            </p>
          ))}
        </div>
        <p className="muted small">Letters are only letters: they can&apos;t know anything about two people, or two characters.</p>
        <ShareLink path={namesResultHref(a, b)} label="Link to this result" />
        <ShipLinks a={a} b={b} />
      </section>

      <section className="card">
        <h2>Now tell the test who they are</h2>
        <p>
          {`Give ${first} and ${second} three traits, a want and a dealbreaker each, and the test reads who they are instead of their letters: their chemistry out of 100, and why.`}
        </p>
        <ChemistryForm values={{ a_name: a, b_name: b }} />
      </section>

      <section className="card chem-cta">
        <h2>Want to see a real date?</h2>
        <p>
          Botchelor is a blind-date show for original characters. Make one, and they go on a date written by AI that nobody
          can steer, not even you, while friends guess how it ends. Free to start, no sign-up.
        </p>
        <Link className="button" href="/create">
          Make your character
        </Link>
        <MoreTools current={CHEMISTRY_TEST_PATH} />
      </section>
    </>
  );
}

/**
 * A pair's chemistry (lib/chemistry-test.ts), at an address anyone can share: the same answer for everyone, every
 * time, with no model and nothing stored. Two names and nothing else get the quick reading, the playground TRUE LOVE
 * count (lib/true-love.ts). Either ends on the show itself: the full one's "Send {first} on a real date" opens /create
 * with both characters in.
 */
export default async function ChemistryResultPage({ searchParams }: Props) {
  const sp = await searchParams;
  const names = readNamePair(sp);
  if (names?.ok) return <NamesResult a={names.a} b={names.b} />;
  if (names) {
    return (
      <section className="card chem-tool">
        <p className="kicker">
          <Link href={CHEMISTRY_TEST_PATH}>{TOOL_NAME}</Link>
        </p>
        <h1>Check those two names</h1>
        <p className="error" role="alert">
          {errorText(names.error, names.form)}
        </p>
        <NamesForm a={names.form.a_name ?? ""} b={names.form.b_name ?? ""} />
      </section>
    );
  }

  const read = readChemistry(sp);
  if (!read.ok && read.empty) redirect(CHEMISTRY_TEST_PATH);
  if (!read.ok) {
    return (
      <section className="card chem-tool">
        <p className="kicker">
          <Link href={CHEMISTRY_TEST_PATH}>{TOOL_NAME}</Link>
        </p>
        <h1>Check those two characters</h1>
        <p className="error" role="alert">
          {errorText(read.error, read.form)}
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
          <Link href={CHEMISTRY_TEST_PATH}>{TOOL_NAME}</Link>
        </p>
        <h1>{`${a.name} × ${b.name}`}</h1>
        <div className={`chem-score chem-${ending}`} data-score={score} data-ending={ending}>
          <p className="chem-score-num">
            <strong>{score}</strong>
            <span>/100 chemistry</span>
          </p>
          <meter min={0} max={100} low={40} high={65} optimum={100} value={score} aria-label="Chemistry score" />
          {/* "On paper" (2026-11-23, was "Predicted ending"): the test reads five fields; the engine decides a real date. */}
          <p className="chem-ending">
            On paper: <strong>{ENDING_LABELS[ending]}</strong>
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
        <p className="muted small">For fun: a real date adds luck and secret agendas, and on Botchelor the engine decides how it ends.</p>
        <ShareLink path={chemistryResultHref(a, b)} label="Link to this result" />
        <ShipLinks a={a.name} b={b.name} />
      </section>

      <section className="card chem-cta">
        <h2>That was the test. The date is the show.</h2>
        <p>
          {`The test reads five fields. On Botchelor, ${first} goes on a real blind date, written by AI and steered by nobody, not even you, while friends guess how it ends. The builder opens with ${first}'s fields in and ${second}'s one click away. Free to start, no sign-up.`}
        </p>
        {/* The small print before the button, and the button promising only what it does (2026-11-22 audit: "Watch the real
            date" promised the one date the line under it ruled out). */}
        <p className="muted small">
          {`Two characters made by the same person don't date each other, so ${first} meets this season's house cast, a match from the swipe deck, or a blind date.`}
        </p>
        <Link className="button" href={createPairHref(a, b)}>
          {`Send ${first} on a real date`}
        </Link>
        <MoreTools current={CHEMISTRY_TEST_PATH} />
      </section>

      <section className="card">
        <h2>Try another pair</h2>
        <ChemistryForm values={pairFormValues(a, b)} submit="Test again" />
      </section>
    </>
  );
}
