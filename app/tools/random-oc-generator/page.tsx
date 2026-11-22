import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import JsonLd from "@/app/JsonLd";
import { chemistryResultHref } from "@/lib/chemistry-test";
import { OC_NAME_KIND_LABELS, OC_NAME_KINDS, readKind } from "@/lib/oc-names";
import { OC_QUESTIONS_PATH } from "@/lib/oc-questions";
import {
  createFromOc,
  RANDOM_OC_GENRE_INFO,
  RANDOM_OC_GENRES,
  RANDOM_OC_MAX_BATCH,
  RANDOM_OC_PATH,
  randomOcHref,
  randomOcs,
  readGenre,
  readOcBatch,
  roleLine,
} from "@/lib/random-oc";
import { pageMetadata, toolJsonLd } from "@/lib/seo";
import { TOOLS_PATH } from "@/lib/tools";
import MoreTools from "../MoreTools";

const TITLE = "Random OC generator";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  // Another genre, kind or batch is the same tool: one page in search, the rest followed but not indexed.
  const variant = sp.genre !== undefined || sp.kind !== undefined || sp.batch !== undefined;
  return {
    ...pageMetadata({
      title: "Random OC generator: a whole original character in one click · Botchelor",
      description:
        "A free random OC generator: a name, age, role, three traits, what they want in love, a dealbreaker and a " +
        "secret. Fantasy, modern, sci-fi, gothic or cozy.",
      path: RANDOM_OC_PATH,
      // Its own card beside it (opengraph-image.tsx).
      image: null,
    }),
    ...(variant ? { robots: { index: false, follow: true } } : {}),
  };
}

/** Starting from a random character: a few lines of help under the characters, for people (and for search). */
const TIPS = [
  "Keep one thing and change the rest. A random character is a prompt, not a contract: the secret or the quirk is usually the part worth keeping.",
  "Ask why. Why would a hedge witch name every houseplant? The answer is their backstory.",
  "Put the want and the dealbreaker against each other. A character who wants someone braver but can't stand show-offs already has a story.",
  "Give them someone to meet. A character comes alive next to another one: send yours on a date and see what they do.",
];

/**
 * The random OC generator (lib/random-oc.ts): genre and kind as links (no form, so it works without JavaScript and every
 * page is an address), six whole characters, each with "Make this character" (the one-sentence box on /create) and their
 * chemistry with the next one on the page (the OC chemistry test), and "Six more" on the next batch.
 */
export default async function RandomOcGeneratorPage({ searchParams }: Props) {
  const sp = await searchParams;
  const genre = readGenre(sp.genre);
  const kind = readKind(sp.kind);
  const batch = readOcBatch(sp.batch);
  const ocs = randomOcs({ genre, kind, batch });
  const next = (batch % RANDOM_OC_MAX_BATCH) + 1;
  // A wide page (docs/brand.md, Layout): six whole characters three across need the room; in the 46rem reading column
  // "Make this character" wrapped and the sheet's values ran one word a line (visual audit 2026-11-20).
  return (
    <div className="page-wide random-oc-page">
      <section className="card names-tool random-oc-tool">
        <p className="kicker">
          <Link href={TOOLS_PATH}>Free OC tools</Link>
        </p>
        <h1>{TITLE}</h1>
        <p className="lede">
          A whole original character in one click: a name, an age, who they are, three traits, what they want in love, what
          they can&apos;t stand and a secret. Six at a time, as many times as you like.
        </p>
        <nav className="names-pick" aria-label="Genre">
          <span>Genre</span>
          <Link href={randomOcHref(null, kind)} aria-current={genre === null ? "page" : undefined}>
            Mixed
          </Link>
          {RANDOM_OC_GENRES.map((g) => (
            <Link key={g} href={randomOcHref(g, kind)} aria-current={genre === g ? "page" : undefined}>
              {RANDOM_OC_GENRE_INFO[g].label}
            </Link>
          ))}
        </nav>
        <nav className="names-pick" aria-label="Kind of character">
          <span>Names</span>
          {OC_NAME_KINDS.map((k) => (
            <Link key={k} href={randomOcHref(genre, k)} aria-current={kind === k ? "page" : undefined}>
              {OC_NAME_KIND_LABELS[k]}
            </Link>
          ))}
        </nav>
        {genre && <p className="muted small">{`${RANDOM_OC_GENRE_INFO[genre].label}: ${RANDOM_OC_GENRE_INFO[genre].world}.`}</p>}

        <ul className="random-oc-list" data-ocs={ocs.length}>
          {ocs.map((oc, i) => {
            const partner = ocs[(i + 1) % ocs.length];
            return (
              // Dealt in one after another, like a hand of cards (app/globals.css .random-oc, the motion kit).
              <li key={oc.name} className="random-oc" style={{ "--i": i } as CSSProperties}>
                <p className="muted small random-oc-meta">
                  {RANDOM_OC_GENRE_INFO[oc.genre].label} · {oc.pronouns} · {oc.age}
                </p>
                <h2 className="random-oc-name">{oc.name}</h2>
                <p>{`${roleLine(oc)[0].toUpperCase()}${roleLine(oc).slice(1)}.`}</p>
                <ul className="random-oc-traits" aria-label="Traits">
                  {oc.traits.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <dl className="random-oc-sheet">
                  <dt>Wants</dt>
                  <dd>{oc.want}</dd>
                  <dt>Can&apos;t stand</dt>
                  <dd>{oc.dealbreaker}</dd>
                  <dt>Secret</dt>
                  <dd>{`${oc.secret[0].toUpperCase()}${oc.secret.slice(1)}`}</dd>
                </dl>
                <p className="random-oc-actions">
                  {/* nofollow: the builder drafts from the sentence as it opens, so a crawler has no reason to go there.
                      Outlined: six of them to a page, so the page's one filled button is Six more (2026-11-22). */}
                  <Link className="button secondary" href={createFromOc(oc)} rel="nofollow" data-track="random-oc-make">
                    Make this character
                  </Link>
                  {partner && partner !== oc && (
                    <Link className="small" href={chemistryResultHref(oc, partner)} rel="nofollow" data-track="random-oc-chemistry">
                      {`Their chemistry with ${partner.name.split(" ")[0]} →`}
                    </Link>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
        <Link className="button" href={randomOcHref(genre, kind, next)} rel="nofollow" data-track="random-oc-more">
          Six more characters
        </Link>
        <p className="muted small">
          Free, no sign-up, no AI: the characters come from hand-written lists, and the same page always shows the same
          ones, so you can send someone the link.
        </p>
      </section>

      <section className="card">
        <h2>Making a random character your own</h2>
        <ul className="names-tips">
          {TIPS.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
        <p className="muted small">
          Got one you like? <Link href={OC_QUESTIONS_PATH}>Ask them some questions</Link> to find out who they really are.
        </p>
      </section>

      <section className="card names-cta">
        <h2>Found your character? Give them a love life</h2>
        <p>
          Botchelor is a blind-date show for original characters. Make yours, and they go on a date written by AI that
          nobody can steer, not even you, then text you how it went. Free to start, no sign-up.
        </p>
        <Link className="button" href="/create">
          Make your character
        </Link>
        <MoreTools current={RANDOM_OC_PATH} />
      </section>

      {/* The tool as a free web app under the tools hub, for search (lib/seo.ts toolJsonLd). */}
      <JsonLd data={toolJsonLd(RANDOM_OC_PATH)} />
    </div>
  );
}
