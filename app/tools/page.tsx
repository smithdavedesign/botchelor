import Link from "next/link";
import JsonLd from "@/app/JsonLd";
import ToolPreview from "./ToolPreview";
import { OC_NAME_STYLE_INFO, OC_NAME_STYLES, OC_NAMES_PATH, ocNamesHref } from "@/lib/oc-names";
import { OC_QUESTION_THEMES, OC_QUESTIONS_PATH } from "@/lib/oc-questions";
import { breadcrumbJsonLd, itemListJsonLd, pageMetadata } from "@/lib/seo";
import { RANDOM_OC_GENRE_INFO, RANDOM_OC_GENRES, randomOcHref } from "@/lib/random-oc";
import { FREE_TOOLS, RANDOM_OC_TOOL_PATH, SHIP_TOOL_PATH, TOOLS_PATH } from "@/lib/tools";

const LIST_NAME = "Free tools for original characters";

export const metadata = pageMetadata({
  title: "Free OC tools: random OCs, names, questions, ships and chemistry · Botchelor",
  description:
    "Free tools for original characters: random OCs, OC names, questions to ask, ship names, random ships and a ship " +
    "compatibility test. No sign-up, no AI.",
  path: TOOLS_PATH,
  // Its own card beside it (app/tools/opengraph-image.tsx).
  image: null,
});

/** What each tool's card adds under its line: the generator's genres, the name generator's style pages, the question themes, a ship to try. */
function Extras({ path }: { path: string }) {
  if (path === RANDOM_OC_TOOL_PATH) {
    return (
      <nav className="tools-links" aria-label="Genres">
        {RANDOM_OC_GENRES.map((g) => (
          <Link key={g} href={randomOcHref(g)}>
            {`${RANDOM_OC_GENRE_INFO[g].label} characters`}
          </Link>
        ))}
      </nav>
    );
  }
  if (path === OC_NAMES_PATH) {
    return (
      <nav className="tools-links" aria-label="Name styles">
        {OC_NAME_STYLES.map((s) => (
          <Link key={s} href={ocNamesHref(s)}>
            {`${OC_NAME_STYLE_INFO[s].label} names`}
          </Link>
        ))}
      </nav>
    );
  }
  if (path === OC_QUESTIONS_PATH) {
    return (
      <nav className="tools-links" aria-label="Question themes">
        {OC_QUESTION_THEMES.map((t) => (
          <Link key={t.id} href={`${OC_QUESTIONS_PATH}#${t.id}`}>
            {t.title}
          </Link>
        ))}
      </nav>
    );
  }
  if (path === SHIP_TOOL_PATH) {
    return (
      <p className="muted small">
        Try <Link href="/ship/juniper/dex">Juniper × Dex</Link>.
      </p>
    );
  }
  return null;
}

/**
 * The free tools for original characters in one place (lib/tools.ts), for search: a landing for "free OC tools", and
 * the page every footer links, so each tool is a link away from every page on the site. Each tool's card leads to its
 * own landings (the name styles, the question themes). It ends one click from /create.
 */
export default function ToolsPage() {
  return (
    <>
      <section className="card tools-hub">
        <p className="kicker">Free, no sign-up</p>
        <h1>{LIST_NAME}</h1>
        <p className="lede">
          Roll a character, name them, get to know them, ship them (or let a random pair ship themselves), and see if the
          ship holds. Six tools for people who make characters, free and with no sign-up.
        </p>
        <p className="muted">
          None of them uses AI: the same names and answers go in, the same results come out, every time, on a link you can
          share.
        </p>
      </section>

      {FREE_TOOLS.map((t) => (
        <section key={t.path} className="card tools-item rise-in" aria-labelledby={`tool-${t.path.split("/").pop()}`}>
          {/* What the tool makes, from its own output (app/tools/ToolPreview.tsx). */}
          <ToolPreview path={t.path} />
          <h2 id={`tool-${t.path.split("/").pop()}`}>
            <Link href={t.path}>{t.name}</Link>
          </h2>
          <p>{t.blurb}</p>
          <Extras path={t.path} />
        </section>
      ))}

      <section className="card tools-cta">
        <h2>Then send them on a date</h2>
        <p>
          Botchelor is a blind-date show for original characters. Build yours, and they go on a date written by AI that
          nobody can steer, not even you, while friends guess how it ends. Free to start, no sign-up.
        </p>
        <Link className="button" href="/create">
          Make your character
        </Link>
      </section>

      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Botchelor", path: "/" },
            { name: "Free OC tools", path: TOOLS_PATH },
          ]),
          itemListJsonLd(
            LIST_NAME,
            FREE_TOOLS.map((t) => ({ name: t.name, path: t.path })),
          ),
        ]}
      />
    </>
  );
}
