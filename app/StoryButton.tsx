"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";

export type StoryView = { title: string; paragraphs: string[] };

/**
 * "Read it as a story" (lib/stories.ts): the finished date or chapter told again as prose, made on the first press and
 * kept. `endpoint` and `body` say which (a show date's own route, or After Dark's with the chapter); `price` is what the
 * first press costs, said on the button. `initial`: a story already made, shown at once.
 */
export default function StoryButton({
  endpoint,
  body = {},
  price,
  initial = null,
  className = "",
}: {
  endpoint: string;
  body?: Record<string, unknown>;
  price?: string;
  initial?: StoryView | null;
  className?: string;
}) {
  const [story, setStory] = useState<StoryView | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(Boolean(initial));

  async function tell() {
    if (story) return setOpen((o) => !o);
    setBusy(true);
    setError(null);
    const res = await requestJson(endpoint, body, "POST", { timeoutMs: 120_000 }).catch(() => null);
    setBusy(false);
    const got = res?.ok ? ((res.data as { story?: StoryView }).story ?? null) : null;
    if (!got) return setError(res?.message ?? "The story didn't come. Try again.");
    setStory(got);
    setOpen(true);
  }

  return (
    <section className={`story ${className}`.trim()} aria-label="The story">
      <p>
        <button type="button" className="button-ghost small" onClick={() => void tell()} disabled={busy} aria-expanded={story ? open : undefined}>
          {busy ? "Writing the story…" : story ? (open ? "Hide the story" : "📖 Read it as a story") : "📖 Read it as a story"}
          {!story && !busy && price ? <span className="muted small">{" "}· {price}</span> : null}
        </button>
      </p>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {story && open && (
        <article className="story-text">
          <h2>{story.title}</h2>
          {story.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          <p className="muted small">Told again as prose by AI from the date&apos;s own lines.</p>
        </article>
      )}
    </section>
  );
}
