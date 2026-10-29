"use client";

import { useEffect, useState } from "react";
import type { Made, MadeStep } from "@/lib/showcase-made";

/**
 * How a post was made (lib/showcase-made.ts), in the showcase's viewer: what made it, the model and where it ran, and
 * the prompt (folded, with Copy), and for a boomerang, loop or still, the clip it came from.
 */
export default function MadeWith({ postId }: { postId: string }) {
  const [made, setMade] = useState<Made | null | "none">(null);
  useEffect(() => {
    let live = true;
    setMade(null);
    fetch(`/api/showcase/${encodeURIComponent(postId)}/made`)
      .then((r) => (r.ok ? r.json() : "none"))
      .then((m) => live && setMade(m as Made | "none"))
      .catch(() => live && setMade("none"));
    return () => {
      live = false;
    };
  }, [postId]);
  if (made === "none") return null;
  if (!made) return <p className="muted small showcase-made">How it was made…</p>;
  return (
    <section className="showcase-made" aria-label="How it was made">
      <h2 className="small">How it was made</h2>
      <Step step={made} />
      {made.from && (
        <div className="showcase-made-from">
          <p className="small muted">Made from</p>
          <Step step={made.from} />
        </div>
      )}
    </section>
  );
}

function Step({ step }: { step: MadeStep }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <p className="small">{step.how}, {new Date(step.made_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}.</p>
      <p className="small">
        <span className="showcase-made-label">Model</span>{" "}
        {step.model ? (
          <>
            <strong>{step.model.label}</strong>
            <span className="muted">
              {" "}
              ({step.model.id}
              {step.model.provider ? ` on ${step.model.provider}` : ""})
            </span>
          </>
        ) : (
          <span className="muted">{step.model_note}</span>
        )}
      </p>
      {step.prompt ? (
        <details className="showcase-prompt">
          <summary className="small">
            <span className="showcase-made-label">Prompt</span> {step.prompt.length.toLocaleString()} characters
          </summary>
          <p className="small">{step.prompt}</p>
          <button type="button" className="button-ghost small" onClick={() => void navigator.clipboard?.writeText(step.prompt ?? "").then(() => setCopied(true))}>
            {copied ? "Copied" : "Copy the prompt"}
          </button>
        </details>
      ) : null}
      {step.prompt_note && <p className="muted small">{step.prompt_note}</p>}
    </>
  );
}
