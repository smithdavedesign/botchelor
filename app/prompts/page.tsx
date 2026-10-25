import type { Metadata } from "next";
import Link from "next/link";
import Pager from "@/app/Pager";
import { pageHref, pageOf, parsePage } from "@/lib/paging";
import {
  ALL_PROMPTS,
  PROMPT_QUERY_MAX,
  PROMPT_SOURCES,
  PROMPTS_PER_PAGE,
  findPrompts,
  parseQuery,
  parseSource,
  sourceOf,
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
 * so the search, the dataset filter and the pager are plain links and a GET form that work without JavaScript. Only
 * the copy buttons are client code.
 */
export default async function PromptsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = parseQuery(sp.q);
  const source = parseSource(sp.source);
  const found = findPrompts(q, source);
  const list = pageOf(found, parsePage(sp.page), PROMPTS_PER_PAGE);
  const keep = { q: q || undefined, source: source ?? undefined };

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
          <button type="submit">Search</button>
        </form>
      </section>

      <MyPrompts />

      <section className="card" id="prompts" aria-labelledby="prompts-count">
        <p className="muted small" id="prompts-count" aria-live="polite">
          {found.length === 0
            ? "No prompts match that."
            : `${found.length.toLocaleString("en-US")} ${found.length === 1 ? "prompt" : "prompts"}${q || source ? " match" : ""}`}
          {(q || source) && (
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
          anything sexual and anything naming a real person as the subject was left out.
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
