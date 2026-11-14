import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import Pager from "@/app/Pager";
import { adultViewerFromCookies } from "@/lib/adult/mode";
import { artistsNamed, parseArtists } from "@/lib/prompt-artists";
import { getDb } from "@/lib/db";
import { pageHref, pageOf, parsePage } from "@/lib/paging";
import {
  ALL_PROMPTS,
  HAS_NSFW_TAGS,
  PROMPT_QUERY_MAX,
  PROMPT_SOURCES,
  PROMPTS_PER_PAGE,
  findPrompts,
  parseQuery,
  parseSource,
  parseTag,
  tagById,
  tagCounts,
  visibleTags,
} from "@/lib/prompts-library";
import { SHARE_IMAGE } from "@/lib/seo";
import CopyPrompt from "./CopyPrompt";
import MyPrompts from "./MyPrompts";
import PromptCard from "./PromptCard";
import PromptExamples from "./PromptExamples";
import { examplesFor } from "@/lib/prompt-examples";
import SavePrompt from "./SavePrompt";

const PATH = "/prompts";
const TITLE = "Prompts library";
const DESCRIPTION = `${ALL_PROMPTS.length.toLocaleString("en-US")} openly licensed image prompts for portraits of adults: search them, filter by dataset and copy one to draw your character. Free, no sign-up.`;

export const metadata: Metadata = {
  title: `${TITLE}: portrait prompts for drawing your character · Botchelor`,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  // Setting openGraph replaces the root layout's, share card included, so the card is named here (lib/seo.ts).
  openGraph: { type: "website", siteName: "Botchelor", locale: "en_US", title: TITLE, description: DESCRIPTION, url: PATH, images: [SHARE_IMAGE] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The prompts library (lib/prompts-library.ts): a server-rendered search over the seed, PROMPTS_PER_PAGE at a time,
 * so the search, the dataset and tag filters, the tag chips and the pager are plain links and a GET form that work
 * without JavaScript. Only the copy and save buttons and a long prompt's "more" are client code. NSFW tags (the Studio's
 * options past dressed) show only to a viewer After Dark is open to (adultViewerFromCookies), and the page only asks when
 * the seed has one. A wide page (the 2026-11-13 lift): the prompts are a grid of compact cards (app/prompts/PromptCard.tsx),
 * three across on a desktop, where one a row had made the page 7,200px tall.
 */
async function showsNsfw(): Promise<boolean> {
  if (!HAS_NSFW_TAGS) return false;
  try {
    return (await adultViewerFromCookies(await getDb(), await cookies())) !== null;
  } catch {
    return false;
  }
}

export default async function PromptsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const showNsfw = await showsNsfw();
  const q = parseQuery(sp.q);
  const source = parseSource(sp.source);
  const tag = parseTag(sp.tag, showNsfw);
  const artists = parseArtists(sp.artists);
  const found = findPrompts({ query: q, source, tag, showNsfw, artists });
  // How many of the prompts that match name a real artist (lib/prompt-artists.ts): said beside the box that hides them.
  const naming = artists ? findPrompts({ query: q, source, tag, showNsfw }).length - found.length : found.filter((p) => artistsNamed(p.prompt).length > 0).length;
  const list = pageOf(found, parsePage(sp.page), PROMPTS_PER_PAGE);
  const keep = { q: q || undefined, source: source ?? undefined, tag: tag ?? undefined, artists: artists ?? undefined };
  const filtered = Boolean(q || source || tag || artists);
  const tags = tagCounts(showNsfw);
  const groups = [...new Set(tags.map((t) => t.group))];

  return (
    <article className="page-wide prompts-page">
      <section className="card prompts-intro">
        <p className="kicker">A free library for drawing your character</p>
        <h1>{TITLE}</h1>
        <p className="lede">
          {ALL_PROMPTS.length.toLocaleString("en-US")} image prompts for portraits of adults, from openly licensed
          datasets. Find one close to the face you have in mind, copy it, and make it yours.
        </p>
        <form className="prompts-search" action={PATH} method="get" role="search">
          <label className="prompts-field">
            <span>Search</span>
            <input type="search" name="q" defaultValue={q} maxLength={PROMPT_QUERY_MAX} placeholder="red hair, oil painting, astronaut…" />
          </label>
          <label className="prompts-field">
            <span>Dataset</span>
            <select name="source" defaultValue={source ?? ""}>
              <option value="">All datasets</option>
              {PROMPT_SOURCES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="prompts-field">
            <span>Tag</span>
            <select name="tag" defaultValue={tag ?? ""}>
              <option value="">Any tag</option>
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {tags
                    .filter((t) => t.group === g)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {`${t.label} (${t.count})`}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button type="submit">Search</button>
          <label className="check prompts-artists">
            <input type="checkbox" name="artists" value="hide" defaultChecked={artists === "hide"} />
            <span>
              Leave out prompts that name a real artist{" "}
              <span className="muted">({naming.toLocaleString("en-US")} {artists ? "left out" : "of these do"})</span>
            </span>
          </label>
        </form>
      </section>

      <MyPrompts />

      {/* A tag picked: pictures people made in the Studio with it (lib/prompt-examples.ts), over the prompts. */}
      {tag && tagById(tag) && <PromptExamples tag={tagById(tag)!} examples={await examplesFor(tag)} />}

      <section className="card" id="prompts" aria-labelledby="prompts-count">
        <p className="muted small" id="prompts-count" aria-live="polite">
          {found.length === 0
            ? "No prompts match that."
            : `${found.length.toLocaleString("en-US")} ${found.length === 1 ? "prompt" : "prompts"}${filtered ? " match" : ""}`}
          {filtered && (
            <>
              {" · "}
              <Link href={PATH}>Show all</Link>
            </>
          )}
        </p>
        {list.items.length > 0 && (
          <ul className="prompts-grid">
            {list.items.map((p) => (
              <PromptCard
                key={p.prompt}
                prompt={p}
                tags={visibleTags(p, showNsfw)}
                tagHref={(id) => pageHref(PATH, { ...keep, tag: id }, "page", 1, "prompts")}
                currentTag={tag}
                clamp
                actions={
                  <>
                    <CopyPrompt text={p.prompt} />
                    <SavePrompt text={p.prompt} />
                  </>
                }
              />
            ))}
          </ul>
        )}
        <Pager page={list.page} pages={list.pages} label="Prompt pages" href={(n) => pageHref(PATH, keep, "page", n, "prompts")} />
      </section>

      <section className="card prompts-credits">
        <h2>Where these come from</h2>
        <p>
          Every prompt is from an openly licensed dataset and keeps its licence. We only cleaned them up: one line of plain
          words, no model weights or flags, nothing under 40 or over 400 characters, no repeats. Anything about minors,
          anything sexual or violent, anything naming a real person, and anything describing a picture that already exists
          rather than one to make was left out.
        </p>
        <p>
          The tags are the Studio&apos;s own: its framing, angle, pose, wardrobe, accessories, place, light and expression
          choices, read from each prompt&apos;s words. Style and who&apos;s in it are extra context, shown in grey.
        </p>
        <ul>
          {PROMPT_SOURCES.map((s) => (
            <li key={s.id}>
              <a href={s.href} rel="noopener noreferrer" target="_blank">
                {s.name}
              </a>{" "}
              (<a href={s.licenseHref} rel="noopener noreferrer" target="_blank">{s.license}</a>)
            </li>
          ))}
        </ul>
        <p className="muted small">
          Prompts often ask for a real artist&apos;s style, as the datasets had them: those cards say so, and the box above the
          list leaves them out. The pictures you make are covered by the <Link href="/content-policy">content policy</Link>.
        </p>
      </section>

      <section className="card ship-cta">
        <h2>Got the look? Give them a date</h2>
        <p>Build your character, and they go on a blind date written by AI that nobody can steer, while friends guess how it ends.</p>
        <Link className="button" href="/create">
          Make your character
        </Link>
      </section>
    </article>
  );
}
