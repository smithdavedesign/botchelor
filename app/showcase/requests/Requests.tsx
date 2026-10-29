"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import type { Request } from "@/lib/showcase-social";

/**
 * Showcase posts waiting on their OK (lib/showcase-social.ts): what each shows (an explicit one only if After Dark is
 * open to them), who wants to publish it, and Yes or No. One No and it isn't published.
 */
export default function Requests({ initial }: { initial: Request[] }) {
  const [left, setLeft] = useState(initial);
  const [note, setNote] = useState<string | null>(null);
  async function answer(postId: string, yes: boolean) {
    const res = await requestJson("/api/showcase/requests", { post_id: postId, yes }).catch(() => null);
    if (!res?.ok) return setNote("That didn't go through. Try again.");
    setLeft((x) => x.filter((r) => r.post_id !== postId));
    setNote(yes ? (res.data.status === "live" ? "Said yes: it's live." : "Said yes: it goes up once everyone has.") : "Said no: it won't be published.");
  }
  if (!left.length) return <p className="muted">{note ?? "Nothing waiting on you."}</p>;
  return (
    <>
      {note && <p className="muted" role="status">{note}</p>}
      <ul className="showcase-requests">
        {left.map((r) => (
          <li key={r.post_id} className="card">
            {r.mime?.startsWith("video/") ? (
              <video src={`/api/showcase/${r.post_id}/media`} muted loop playsInline controls preload="metadata" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- served by the showcase's own gate
              <img src={`/api/showcase/${r.post_id}/media`} alt={`A picture with ${r.character.name}`} />
            )}
            <p>
              <strong>{r.creator.display_name}</strong> (@{r.creator.handle}) wants to publish this, with {r.character.name}, on the showcase.
            </p>
            {r.caption && <p className="muted small">“{r.caption}”</p>}
            <p className="muted small">If you say yes, either of you can take it down any time.</p>
            <p>
              <button type="button" className="primary small" onClick={() => void answer(r.post_id, true)}>
                Yes, publish it
              </button>{" "}
              <button type="button" className="button-ghost small" onClick={() => void answer(r.post_id, false)}>
                No
              </button>
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
