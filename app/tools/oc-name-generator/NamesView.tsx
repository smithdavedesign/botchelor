import Link from "next/link";
import {
  createWithName,
  OC_NAME_KIND_LABELS,
  OC_NAME_KINDS,
  OC_NAME_STYLE_INFO,
  OC_NAME_STYLES,
  OC_NAMES_MAX_BATCH,
  OC_NAMES_PATH,
  ocNames,
  ocNamesHref,
  type OcNameKind,
  type OcNameStyle,
} from "@/lib/oc-names";
import MoreTools from "../MoreTools";

/** How to name a character in each style: a few lines of help under the names, different on every style page. */
const TIPS: Record<OcNameStyle | "mixed", string[]> = {
  mixed: [
    "Say it out loud. A name you'll type a thousand times should be easy to say and hard to mix up with the rest of the cast.",
    "Give the first name and the surname different rhythms: a short first name with a long surname, or the other way round.",
    "Check the first letters across your cast. Two characters starting with the same letter get mixed up by readers.",
  ],
  fantasy: [
    "Soft endings (-a, -wyn, -iel) read gentle; hard ones (-ric, -dor, -gar) read like armour. Pick the one that fits who they are, not who they look like.",
    "A place-like surname (Ashvale, Stormhollow) tells readers where they come from before you do.",
    "Keep apostrophes and odd spellings for one character at most. A whole cast of them is hard to read.",
  ],
  modern: [
    "Pick a first name from the year they were born, not the year you're writing: names go in and out of fashion.",
    "A surname can carry a family's history: where they came from, who married whom.",
    "Nicknames do a lot of work. Decide who uses the full name and who doesn't.",
  ],
  scifi: [
    "Short first names survive radio static. Crews call each other by one or two syllables.",
    "A double surname or a number can say a lot about a world: colonies, clones, corporations.",
    "Keep it sayable. A name nobody can pronounce gets skipped by readers.",
  ],
  gothic: [
    "Victorian first names do half the atmosphere for you. Let the surname do the other half.",
    "A family name that is also a house name (Ravenscroft, Blackwood) makes the house a character too.",
    "Give the one character with a secret the plainest name in the story.",
  ],
  cozy: [
    "Cozy names often sound like food, flowers or weather. One of each in a cast is plenty.",
    "A surname that sounds like a shop sign (Copperpot, Honeywell) is half a setting already.",
    "Nicknames are the heart of a small town: who's Clementine and who's Clem?",
  ],
};

/**
 * One page of names (lib/oc-names.ts): style and kind as links (no form, so it works without JavaScript and every
 * page is an address), twelve names each with "Make this character", and "More names" on the next batch.
 */
export default function NamesView({ style, kind, batch }: { style: OcNameStyle | null; kind: OcNameKind; batch: number }) {
  const names = ocNames({ style, kind, batch });
  const info = style ? OC_NAME_STYLE_INFO[style] : null;
  const next = (batch % OC_NAMES_MAX_BATCH) + 1;
  return (
    <>
      <section className="card names-tool">
        <p className="kicker">{style ? <Link href={ocNamesHref(null)}>OC name generator</Link> : "A free tool for original characters"}</p>
        <h1>{info ? info.title : "OC name generator"}</h1>
        <p className="lede">
          {info
            ? info.blurb
            : "Names for your original character: fantasy, modern, sci-fi, gothic or cozy, feminine, masculine or neutral. Twelve at a time, as many times as you like."}
        </p>
        <nav className="names-pick" aria-label="Style">
          <span>Style</span>
          <Link href={ocNamesHref(null, kind)} aria-current={style === null ? "page" : undefined}>
            Mixed
          </Link>
          {OC_NAME_STYLES.map((s) => (
            <Link key={s} href={ocNamesHref(s, kind)} aria-current={style === s ? "page" : undefined}>
              {OC_NAME_STYLE_INFO[s].label}
            </Link>
          ))}
        </nav>
        <nav className="names-pick" aria-label="Kind of name">
          <span>Names</span>
          {OC_NAME_KINDS.map((k) => (
            <Link key={k} href={ocNamesHref(style, k)} aria-current={kind === k ? "page" : undefined}>
              {OC_NAME_KIND_LABELS[k]}
            </Link>
          ))}
        </nav>
        <ul className="names-list" data-names={names.length}>
          {names.map((n) => (
            <li key={n.name}>
              <strong>{n.name}</strong>
              <span className="muted small">
                {OC_NAME_STYLE_INFO[n.style].label} · {n.kind}
              </span>
              <Link className="small" href={createWithName(n.name)}>
                Make this character →
              </Link>
            </li>
          ))}
        </ul>
        <Link className="button" href={ocNamesHref(style, kind, next)} rel="nofollow">
          Twelve more names
        </Link>
        <p className="muted small">
          Free, no sign-up, no AI: the names come from hand-picked lists and syllables, and the same page always shows the
          same names, so you can send someone the link.
        </p>
      </section>

      <section className="card">
        <h2>{style ? `Naming a ${OC_NAME_STYLE_INFO[style].label.toLowerCase()} character` : "Picking the right name"}</h2>
        <ul className="names-tips">
          {TIPS[style ?? "mixed"].map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </section>

      <section className="card names-cta">
        <h2>Found the name? Give them a love life</h2>
        <p>
          Botchelor is a blind-date show for original characters. Build yours, and they go on a date written by AI that
          nobody can steer, not even you, then text you how it went. Free to start, no sign-up.
        </p>
        <Link className="button" href="/create">
          Make your character
        </Link>
        <MoreTools current={OC_NAMES_PATH} />
      </section>
    </>
  );
}
