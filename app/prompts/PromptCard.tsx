import Link from "next/link";
import type { ReactNode } from "react";
import { namesArtist } from "@/lib/prompt-artists";
import { type LibraryPrompt, type PromptTag, sourceOf } from "@/lib/prompts-library";
import PromptText from "./PromptText";

/**
 * The tone a card's swatch takes from its tags (app/ux/prompts.css paints each from the brand's two accents): the first
 * Studio tag's group ("light", "framing"…), else the style facet ("photo", "painting"…), else who's in it, else plain. A
 * prompt record carries no picture of its own, so the swatch stands in; nothing is drawn.
 */
export function promptTone(tags: readonly PromptTag[]): string {
  const studio = tags.find((t) => t.studio);
  if (studio) return studio.id.split(".")[0];
  const style = tags.find((t) => t.id.startsWith("style:"));
  if (style) return style.id.slice("style:".length);
  return tags.some((t) => t.id.startsWith("subject:")) ? "subject" : "plain";
}

type Props = {
  prompt: LibraryPrompt;
  /** The tags this viewer sees (lib/prompts-library.ts visibleTags). */
  tags: PromptTag[];
  /** Where a tag chip goes. */
  tagHref: (id: string) => string;
  /** The tag the page is filtered by, marked on its chip. */
  currentTag?: string | null;
  /** The library clamps the text to four lines with "more" (a client component); a tag page shows it whole, with no script. */
  clamp?: boolean;
  /** The button row (Copy · Save on the library); none on a tag page. */
  actions?: ReactNode;
};

/**
 * One prompt as a compact card in the library's grid (the 2026-11-13 lift; it had been a card nested in a card, one a
 * row): the dataset beside a swatch in the tags' tone, the text, its tags, then one button row on the right. The `li`
 * keeps `class="prompt-item"` exactly: the screenshot scripts and tests count it.
 */
export default function PromptCard({ prompt, tags, tagHref, currentTag = null, clamp = false, actions }: Props) {
  const source = sourceOf(prompt);
  return (
    <li className="prompt-item" data-tone={promptTone(tags)}>
      <p className="prompt-head muted small">
        <span className="prompt-swatch" aria-hidden="true" />
        <span className="prompt-source">{`${source.name} · ${source.license}`}</span>
        {/* The datasets' prompts often ask for a living artist's style (lib/prompt-artists.ts): said on the card, and the
            library can leave these out. */}
        {namesArtist(prompt.prompt) && (
          <span className="chip prompt-artist" title="This prompt asks for a real artist's style. The library can hide these: tick the box above the list.">
            names an artist
          </span>
        )}
      </p>
      {clamp ? <PromptText text={prompt.prompt} /> : <p className="prompt-text">{prompt.prompt}</p>}
      {tags.length > 0 && (
        <ul className="prompt-tags" aria-label="Tags">
          {tags.map((t) => (
            <li key={t.id}>
              <Link className={`prompt-tag${t.studio ? "" : " is-facet"}${t.nsfw ? " is-nsfw" : ""}`} href={tagHref(t.id)} aria-current={t.id === currentTag ? "true" : undefined}>
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {actions && <div className="prompt-actions">{actions}</div>}
    </li>
  );
}
