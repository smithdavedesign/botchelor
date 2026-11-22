import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "@/app/JsonLd";
import { PROMPTS_PER_PAGE, findPrompts, indexablePromptTags, promptTagHeading, promptTagPath, tagById, visibleTags } from "@/lib/prompts-library";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import CopyPrompt from "../../CopyPrompt";
import PromptCard from "../../PromptCard";
import PromptExamples from "../../PromptExamples";
import SavePrompt from "../../SavePrompt";
import { examplesFor } from "@/lib/prompt-examples";

/**
 * How many prompts a tag page shows: one library page (2026-11-22: 60 whole cards ran a phone's page to 15,600px, with
 * the way on at the very bottom). The full, paged list is the library filtered by the tag, linked under the intro.
 */
export const TAG_PAGE_PROMPTS = PROMPTS_PER_PAGE;

export function generateStaticParams() {
  return indexablePromptTags().map((t) => ({ id: t.id }));
}

export const dynamicParams = false;
/** The pages are built ahead; the example pictures (lib/prompt-examples.ts) are read again every hour. */
export const revalidate = 3600;

const pageTag = (id: string) => indexablePromptTags().find((t) => t.id === decodeURIComponent(id)) ?? null;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const tag = pageTag((await params).id);
  if (!tag) return { title: "Prompts · Botchelor", robots: { index: false, follow: false } };
  const heading = promptTagHeading(tag);
  // Behind the 18+ gate like the library, so out of search too (app/prompts/page.tsx).
  return {
    ...pageMetadata({
      title: `${tag.count.toLocaleString("en-US")} ${heading[0].toLowerCase()}${heading.slice(1)} · Botchelor`,
      description: `${tag.count.toLocaleString("en-US")} openly licensed character-portrait prompts tagged "${tag.label}" (${tag.group.toLowerCase()}), each with its source and licence, ready to copy or save for a character of your own.`,
      path: promptTagPath(tag.id),
    }),
    robots: { index: false, follow: true },
  };
}

/**
 * One tag of the prompt library as a page of its own (the 2026-11-11 growth plan: 2,000 prompts sat on one address, so
 * search saw one page). PG tags with enough prompts only (lib/prompts-library.ts indexablePromptTags); the rest are 404,
 * so a typed address makes no thin page. The cards (app/prompts/PromptCard.tsx) show their whole text, in the library's
 * grid, with the library's Copy · Save row (2026-11-22: the intro promised copying that only the library offered), and
 * the way to all of them sits under the intro as well as after the cards.
 */
export default async function PromptTagPage({ params }: { params: Promise<{ id: string }> }) {
  const tag = pageTag((await params).id);
  if (!tag) notFound();
  const prompts = findPrompts({ tag: tag.id, showNsfw: false });
  const shown = prompts.slice(0, TAG_PAGE_PROMPTS);
  const library = `/prompts?tag=${encodeURIComponent(tag.id)}`;
  // A tag with a page of its own links there; the rest filter the library (the set once, not a pass over the seed a chip).
  const paged = new Set(indexablePromptTags().map((x) => x.id));
  const tagHref = (id: string) => (tagById(id) && paged.has(id) ? promptTagPath(id) : `/prompts?tag=${encodeURIComponent(id)}`);
  return (
    <article className="page-wide prompts-page">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Botchelor", path: "/" },
          { name: "Prompts", path: "/prompts" },
          { name: tag.label, path: promptTagPath(tag.id) },
        ])}
      />
      <p className="muted">
        <Link href="/prompts">← All prompts</Link>
      </p>
      <p className="kicker">{tag.group}</p>
      <h1>{promptTagHeading(tag)}</h1>
      <p className="lede">
        {prompts.length.toLocaleString("en-US")} prompts from openly licensed datasets, each keeping its licence. Copy one into the Studio, or start a character from the look.
      </p>
      {prompts.length > shown.length && (
        <p>
          <Link href={library}>Search all {prompts.length.toLocaleString("en-US")} in the library</Link>
        </p>
      )}
      <PromptExamples tag={tag} examples={await examplesFor(tag.id)} />
      <ul className="prompts-grid">
        {shown.map((p) => (
          <PromptCard
            key={p.prompt}
            prompt={p}
            tags={visibleTags(p, false)}
            tagHref={tagHref}
            currentTag={tag.id}
            actions={
              <>
                <CopyPrompt text={p.prompt} />
                <SavePrompt text={p.prompt} />
              </>
            }
          />
        ))}
      </ul>
      {prompts.length > shown.length && (
        <p>
          <Link className="button secondary" href={library}>
            The other {(prompts.length - shown.length).toLocaleString("en-US")} in the library
          </Link>
        </p>
      )}
      <section className="card ship-cta">
        <h2>Got the look? Give them a date</h2>
        <p>Build your character, and they go on a blind date written by AI that nobody can steer, while friends guess how it ends.</p>
        <Link className="button" href="/create">
          Make a character
        </Link>
      </section>
    </article>
  );
}
