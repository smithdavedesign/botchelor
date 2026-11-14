import Link from "next/link";
import type { PromptExample } from "@/lib/prompt-examples";
import type { PromptTag } from "@/lib/prompts-library";

/**
 * A tag's example pictures (lib/prompt-examples.ts examplesFor, read by the page): pictures people made in the Studio and
 * put on the showcase, whose own prompt carries the tag. Nothing when there are none, so a tag page never shows an empty box.
 */
export default function PromptExamples({ tag, examples }: { tag: PromptTag; examples: PromptExample[] }) {
  if (examples.length === 0) return null;
  return (
    <section className="card prompt-examples" aria-labelledby="prompt-examples-title" data-prompt-examples={tag.id}>
      <p className="kicker">From the show&apos;s Studio</p>
      <h2 id="prompt-examples-title">Pictures made with &ldquo;{tag.label}&rdquo;</h2>
      <p className="muted small">Real pictures people made in the Studio, whose own prompt carries this tag. Tap one to watch it in the showcase.</p>
      <ul className="prompt-examples-grid">
        {examples.map((e) => (
          <li key={e.post_id}>
            <Link href={e.href}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the showcase's own tile, already sized */}
              <img src={e.src} alt={e.alt} loading="lazy" width={320} height={320} />
              <span>{e.character}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
