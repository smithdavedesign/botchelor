import Link from "next/link";
import {
  createFromPlace,
  isHometown,
  PLACE_KIND_LABELS,
  PLACE_KINDS,
  PLACE_NAMES_MAX_BATCH,
  PLACE_NAMES_PATH,
  PLACE_STYLE_INFO,
  PLACE_STYLES,
  placeNames,
  placeNamesHref,
  type PlaceKind,
  type PlaceStyle,
} from "@/lib/place-names";
import { OC_NAMES_PATH, ocNamesHref } from "@/lib/oc-names";
import MoreTools from "../MoreTools";

/** How to name places in each style: a few lines of help under the places, different on every style page. */
const TIPS: Record<PlaceStyle | "mixed", string[]> = {
  mixed: [
    "Name places the way the people who live there would. Locals shorten long names, and outsiders get them wrong.",
    "A place name is a tiny history: who founded it, what grew there, what went wrong. Pick one you could explain in a sentence.",
    "Vary the shapes across a map. Ten towns that all end in -ford read like one town.",
  ],
  fantasy: [
    "Old names wear down: Elderfell becomes Eldfell in a peasant's mouth. Let the map and the dialogue disagree a little.",
    "Give each people its own sounds. If elves get soft endings (-wyn, -iel), dwarves get hard ones (-gard, -hold).",
    "A tavern named for an animal and an object (the Stag and Tankard) is instantly believable. Save the clever ones for one place.",
  ],
  modern: [
    "Real towns are named for founders, trees, rivers and wishful thinking. Heights, Springs and Crossing are all promises.",
    "A neighbourhood's name tells you its history: the Garment District made clothes once, and maybe doesn't now.",
    "Name the café after what the owner loves, not what it sells. Ink & Ember says more than Bob's Coffee.",
  ],
  scifi: [
    "Colonists name new places after the ones they left: New Nairobi tells you who got there first.",
    "Numbers and Greek letters read as official; nicknames read as lived-in. A station can have both.",
    "Keep planet names to two or three syllables. Crews will say them over the radio every day.",
  ],
  gothic: [
    "Gothic places are named for what happened there: the Drowned Fen, the Weeping Moor. Decide what happened.",
    "A manor named for a family (Blackwood Priory) makes the family the place's ghost.",
    "Give the village one cheerful name, the one that's hiding the most.",
  ],
  cozy: [
    "Cozy places are named for what grows or what's baked there. One food-named place per map is plenty.",
    "A village green, a bakery and a pub are a whole setting. Name those three first.",
    "Let the locals have a nickname for everything: nobody says Lavenderbrook, they say the Brook.",
  ],
};

/**
 * One page of places (lib/place-names.ts): style and kind as links (no form, so it works without JavaScript and every
 * page is an address), twelve places each with what it is, a town or realm with "Make a character from here", and
 * "Twelve more places" on the next batch. The same shape as the OC name generator's page (NamesView).
 */
export default function PlacesView({ style, kind, batch }: { style: PlaceStyle | null; kind: PlaceKind; batch: number }) {
  const places = placeNames({ style, kind, batch });
  const info = style ? PLACE_STYLE_INFO[style] : null;
  const next = (batch % PLACE_NAMES_MAX_BATCH) + 1;
  return (
    <>
      <section className="card names-tool">
        <p className="kicker">{style ? <Link href={placeNamesHref(null)}>Place name generator</Link> : "A free tool for worldbuilding"}</p>
        <h1>{info ? info.title : "Place name generator"}</h1>
        <p className="lede">
          {info
            ? info.blurb
            : "Names for the places in your story: towns, wilds, realms and taverns, in fantasy, modern, sci-fi, gothic or cozy. Twelve at a time, as many times as you like."}
        </p>
        <nav className="names-pick" aria-label="Style">
          <span>Style</span>
          <Link href={placeNamesHref(null, kind)} aria-current={style === null ? "page" : undefined}>
            Mixed
          </Link>
          {PLACE_STYLES.map((s) => (
            <Link key={s} href={placeNamesHref(s, kind)} aria-current={style === s ? "page" : undefined}>
              {PLACE_STYLE_INFO[s].label}
            </Link>
          ))}
        </nav>
        <nav className="names-pick" aria-label="Kind of place">
          <span>Places</span>
          {PLACE_KINDS.map((k) => (
            <Link key={k} href={placeNamesHref(style, k)} aria-current={kind === k ? "page" : undefined}>
              {PLACE_KIND_LABELS[k]}
            </Link>
          ))}
        </nav>
        <ul className="names-list" data-places={places.length}>
          {places.map((p) => (
            <li key={p.name}>
              <strong>{p.name}</strong>
              <span className="muted small">
                {PLACE_STYLE_INFO[p.style].label} · {p.what}
              </span>
              {isHometown(p) && (
                <Link className="small" href={createFromPlace(p.name)}>
                  Make a character from here →
                </Link>
              )}
            </li>
          ))}
        </ul>
        <Link className="button" href={placeNamesHref(style, kind, next)} rel="nofollow">
          Twelve more places
        </Link>
        <p className="muted small">
          Free, no sign-up, no AI: the places come from hand-picked lists and syllables, and the same page always shows the
          same places, so you can send someone the link.
        </p>
      </section>

      <section className="card">
        <h2>{style ? `Naming ${PLACE_STYLE_INFO[style].label.toLowerCase()} places` : "Naming the places in a story"}</h2>
        <ul className="names-tips">
          {TIPS[style ?? "mixed"].map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
        <p className="muted small">
          Need the people too? The <Link href={style ? ocNamesHref(style) : OC_NAMES_PATH}>OC name generator</Link> has the same five styles.
        </p>
      </section>

      <section className="card names-cta">
        <h2>Found the place? Send someone on a date there</h2>
        <p>
          Botchelor is a blind-date show for original characters. Build one from your world, and they go on a date written
          by AI that nobody can steer, not even you, then text you how it went. Free to start, no sign-up.
        </p>
        <Link className="button" href="/create">
          Make your character
        </Link>
        <MoreTools current={PLACE_NAMES_PATH} />
      </section>
    </>
  );
}
