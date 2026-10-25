import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import Pager from "@/app/Pager";
import { adultViewerFromCookies } from "@/lib/adult/mode";
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
  sourceOf,
  tagCounts,
  visibleTags,
} from "@/lib/prompts-library";
import CopyPrompt from "./CopyPrompt";
import MyPrompts from "./MyPrompts";
import SavePrompt from "./SavePrompt";

const PATH = "/prompts";
const TITLE = "Prompts library";
const DESCRIPTION = `${ALL_PROMPTS.length.toLocaleString("en-US")} openly licensed image prompts for portraits of adults: search them, filter by dataset and copy one to draw your character. Free, no sign-up.`;

export const metadata: Metadata = {
  title: `${TITLE}: portrait prompts for drawing your character · Botchelor`,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { type: "website", siteName: "Botchelor", title: TITLE, description: DESCRIPTION, url: PATH },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The prompts library (lib/prompts-library.ts): a server-rendered search over the seed, PROMPTS_PER_PAGE at a time,
 * so the search, the dataset and tag filters, the tag chips and the pager are plain links and a GET form that work
 * without JavaScript. Only the copy buttons are client code. NSFW tags (the Studio's options past dressed) show only to
 * a viewer After Dark is open to (adultViewerFromCookies), and the page only asks when the seed has one.
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
  const found = findPrompts({ query: q, source, tag, showNsfw });
  const list = pageOf(found, parsePage(sp.page), PROMPTS_PER_PAGE);
  const keep = { q: q || undefined, source: source ?? undefined, tag: tag ?? undefined };
  const filtered = Boolean(q || source || tag);
  const tags = tagCounts(showNsfw);
  const groups = [...new Set(tags.map((t) => t.group))];

  return (
    <>
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
        </form>
      </section>

      <MyPrompts />

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
          <ul className="prompts-list">
            {list.items.map((p) => (
              <li key={p.prompt} className="prompt-item">
                <p className="prompt-text">{p.prompt}</p>
                {visibleTags(p, showNsfw).length > 0 && (
                  <ul className="prompt-tags" aria-label="Tags">
                    {visibleTags(p, showNsfw).map((t) => (
                      <li key={t.id}>
                        <Link
                          className={`prompt-tag${t.studio ? "" : " is-facet"}${t.nsfw ? " is-nsfw" : ""}`}
                          href={pageHref(PATH, { ...keep, tag: t.id }, "page", 1, "prompts")}
                          aria-current={t.id === tag ? "true" : undefined}
                        >
                          {t.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="prompt-meta">
                  <span className="muted small">{`${sourceOf(p).name} · ${sourceOf(p).license}`}</span>
                  <CopyPrompt text={p.prompt} />
                  <SavePrompt text={p.prompt} />
                </div>
              </li>
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
          Prompts often name an artist&apos;s style; the pictures you make are still covered by the{" "}
          <Link href="/content-policy">content policy</Link>.
        </p>
      </section>

      <section className="card ship-cta">
        <h2>Got the look? Give them a date</h2>
        <p>Build your character, and they go on a blind date written by AI that nobody can steer, while friends guess how it ends.</p>
        <Link className="button" href="/create">
          Make your character
        </Link>
      </section>
    </>
  );
}
