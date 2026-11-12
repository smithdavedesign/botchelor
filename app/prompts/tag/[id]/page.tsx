import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "@/app/JsonLd";
import { findPrompts, indexablePromptTags, promptTagPath, sourceOf, tagById, visibleTags } from "@/lib/prompts-library";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

/** How many prompts a tag page shows; the full, paged list is the library filtered by the tag. */
export const TAG_PAGE_PROMPTS = 60;

export function generateStaticParams() {
  return indexablePromptTags().map((t) => ({ id: t.id }));
}

export const dynamicParams = false;

const pageTag = (id: string) => indexablePromptTags().find((t) => t.id === decodeURIComponent(id)) ?? null;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const tag = pageTag((await params).id);
  if (!tag) return { title: "Prompts · Botchelor", robots: { index: false, follow: false } };
  return pageMetadata({
    title: `${tag.count.toLocaleString("en-US")} ${tag.label.toLowerCase()} portrait prompts · Botchelor`,
    description: `${tag.count.toLocaleString("en-US")} openly licensed character-portrait prompts tagged "${tag.label}" (${tag.group.toLowerCase()}), each with its source and licence, ready to copy or save for a character of your own.`,
    path: promptTagPath(tag.id),
  });
}

/**
 * One tag of the prompt library as a page of its own (the 2026-11-11 growth plan: 2,000 prompts sat on one address, so
 * search saw one page). PG tags with enough prompts only (lib/prompts-library.ts indexablePromptTags); the rest are 404,
 * so a typed address makes no thin page. Plain links, no script: the copy and save buttons live in the library itself.
 */
export default async function PromptTagPage({ params }: { params: Promise<{ id: string }> }) {
  const tag = pageTag((await params).id);
  if (!tag) notFound();
  const prompts = findPrompts({ tag: tag.id, showNsfw: false });
  const shown = prompts.slice(0, TAG_PAGE_PROMPTS);
  const library = `/prompts?tag=${encodeURIComponent(tag.id)}`;
  return (
    <article className="page-read prompts-page">
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
      <h1>{tag.label} portrait prompts</h1>
      <p className="lede">
        {prompts.length.toLocaleString("en-US")} prompts from openly licensed datasets, each keeping its licence. Copy one into the Studio, or start a character from the look.
      </p>
      <ul className="prompts-list">
        {shown.map((p) => (
          <li key={p.prompt} className="prompt-item">
            <p className="prompt-text">{p.prompt}</p>
            {visibleTags(p, false).length > 0 && (
              <ul className="prompt-tags" aria-label="Tags">
                {visibleTags(p, false).map((t) => {
                  const own = tagById(t.id);
                  const page = own && indexablePromptTags().some((x) => x.id === t.id);
                  return (
                    <li key={t.id}>
                      <Link className={`prompt-tag${t.studio ? "" : " is-facet"}`} href={page ? promptTagPath(t.id) : `/prompts?tag=${encodeURIComponent(t.id)}`} aria-current={t.id === tag.id ? "true" : undefined}>
                        {t.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="prompt-meta muted small">{`${sourceOf(p).name} · ${sourceOf(p).license}`}</p>
          </li>
        ))}
      </ul>
      {prompts.length > shown.length && (
        <p>
          <Link className="button secondary" href={library}>
            All {prompts.length.toLocaleString("en-US")} {tag.label.toLowerCase()} prompts, with copy and save
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
