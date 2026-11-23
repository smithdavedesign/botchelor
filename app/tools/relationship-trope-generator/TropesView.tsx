import Link from "next/link";
import JsonLd from "@/app/JsonLd";
import {
  firstScene,
  shipHrefFor,
  TROPE_FAQ,
  TROPE_MOOD_INFO,
  TROPE_MOODS,
  TROPE_NAME_MAX,
  TROPES_MAX_BATCH,
  TROPES_PATH,
  tropes,
  tropesHref,
  type TropeMood,
  type TropeNames,
} from "@/lib/relationship-tropes";
import { siteUrl } from "@/lib/site";
import { CHEMISTRY_TOOL_PATH, compatibilityHref, RANDOM_SHIP_TOOL_PATH, SHIP_TOOL_PATH } from "@/lib/tools";
import MoreTools from "../MoreTools";

/**
 * One page of tropes (lib/relationship-tropes.ts): moods as links and two optional names in a plain GET form (no
 * script, and every page is an address), six tropes each with how it goes and a first scene, and "Six more tropes" on
 * the next batch. The same shape as the place name generator's page (PlacesView). The FAQ's FAQPage data goes on the
 * main page only (`faqData`), so search sees the answers once.
 */
export default function TropesView({ mood, batch, names, faqData = false }: { mood: TropeMood | null; batch: number; names: TropeNames; faqData?: boolean }) {
  const shown = tropes({ mood, batch });
  const info = mood ? TROPE_MOOD_INFO[mood] : null;
  const next = (batch % TROPES_MAX_BATCH) + 1;
  const ship = shipHrefFor(names);
  const named = Boolean(names.typedA || names.typedB);
  return (
    <>
      <section className="card names-tool">
        <p className="kicker">{mood ? <Link href={tropesHref(null, 1, names)}>Relationship trope generator</Link> : "A free tool for shippers and writers"}</p>
        <h1>{info ? info.title : "Relationship trope generator"}</h1>
        <p className="lede">
          {info
            ? info.blurb
            : "Romance tropes for your ship, six at a time: sweet, slow burn, angsty, funny or flirty, each with a first scene. Put two names in and the scenes are about them."}
        </p>
        <nav className="names-pick" aria-label="Mood">
          <span>Mood</span>
          <Link href={tropesHref(null, 1, names)} aria-current={mood === null ? "page" : undefined}>
            Mixed
          </Link>
          {TROPE_MOODS.map((m) => (
            <Link key={m} href={tropesHref(m, 1, names)} aria-current={mood === m ? "page" : undefined}>
              {TROPE_MOOD_INFO[m].label}
            </Link>
          ))}
        </nav>
        <form action={tropesHref(mood)} method="get" className="ship-form trope-names">
          <label>
            First character (optional)
            <input type="text" name="a" maxLength={TROPE_NAME_MAX} autoComplete="off" spellCheck={false} placeholder="e.g. Juniper" defaultValue={names.typedA} />
          </label>
          <span className="ship-x" aria-hidden="true">
            ×
          </span>
          <label>
            Second character (optional)
            <input type="text" name="b" maxLength={TROPE_NAME_MAX} autoComplete="off" spellCheck={false} placeholder="e.g. Dex" defaultValue={names.typedB} />
          </label>
          {batch !== 1 && <input type="hidden" name="batch" value={batch} />}
          <button type="submit" className="secondary">
            Put them in the scenes
          </button>
        </form>
        <ul className="names-list trope-list" data-tropes={shown.length}>
          {shown.map((tr) => (
            <li key={tr.id}>
              <strong>{tr.name}</strong>
              <span className="muted small">{TROPE_MOOD_INFO[tr.mood].label}</span>
              <span>{tr.how}</span>
              <span className="small trope-scene">
                <em>First scene:</em> {firstScene(tr, names)}
              </span>
              {ship && (
                <Link className="small" href={ship} rel="nofollow">
                  Ship name for them →
                </Link>
              )}
            </li>
          ))}
        </ul>
        <Link className="button secondary" href={tropesHref(mood, next, names)} rel="nofollow">
          Six more tropes
        </Link>
        <p className="muted small">
          Free, no sign-up, no AI: the tropes are hand-written, and the same page always shows the same ones, so you can send
          someone the link. {named ? "The names live only in the link." : null}
        </p>
      </section>

      <section className="card">
        <h2>Then make it a ship</h2>
        <p>
          Name the pair with the{" "}
          <Link href={ship ?? SHIP_TOOL_PATH} rel={ship ? "nofollow" : undefined}>
            ship name generator
          </Link>, let the{" "}
          <Link href={RANDOM_SHIP_TOOL_PATH}>random ship generator</Link> pick a pair for you, or see whether they&apos;d last
          with the{" "}
          <Link href={ship ? compatibilityHref(names.typedA, names.typedB) : CHEMISTRY_TOOL_PATH} rel={ship ? "nofollow" : undefined}>
            ship compatibility test
          </Link>
          .
        </p>
      </section>

      <section className="card chem-faq">
        <h2>Questions</h2>
        {TROPE_FAQ.map(({ q, a }) => (
          <div key={q} className="chem-faq-item">
            <h3>{q}</h3>
            <p>{a}</p>
          </div>
        ))}
        {faqData && (
          <JsonLd
            data={{
              "@context": "https://schema.org",
              "@type": "FAQPage",
              url: `${siteUrl()}${TROPES_PATH}`,
              mainEntity: TROPE_FAQ.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
            }}
          />
        )}
      </section>

      <section className="card names-cta">
        <h2>Got the trope? Send them on a date</h2>
        <p>
          Botchelor is a blind-date show for original characters. Build one, and they go on a date written by AI that nobody
          can steer, not even you, then text you how it went. Free to start, no sign-up.
        </p>
        <Link className="button" href="/create">
          Make your character
        </Link>
        <MoreTools current={TROPES_PATH} />
      </section>
    </>
  );
}
