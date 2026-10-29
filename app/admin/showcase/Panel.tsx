"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/app/request";
import type { HeldPost } from "@/lib/showcase-moderation";

/** Admin: showcase posts held by a report, then reported ones still up; release or remove each (lib/showcase-moderation.ts). */
export default function ShowcaseModeration() {
  const [posts, setPosts] = useState<HeldPost[] | null>(null);
  const load = () =>
    fetch("/api/admin/showcase")
      .then((r) => (r.ok ? r.json() : { posts: [] }))
      .then((d) => setPosts(d.posts ?? []))
      .catch(() => setPosts([]));
  useEffect(() => {
    void load();
  }, []);
  async function decide(id: string, decision: "release" | "remove") {
    await requestJson("/api/admin/showcase", { post_id: id, decision }).catch(() => null);
    void load();
  }
  if (!posts) return <p className="muted">Loading…</p>;
  if (!posts.length) return <p className="muted">Nothing held or reported.</p>;
  return (
    <ul className="showcase-requests">
      {posts.map((p) => (
        <li key={p.id} className="card">
          {p.mime?.startsWith("video/") ? <video src={`/api/showcase/${p.id}/media`} muted controls preload="metadata" /> : (
            // eslint-disable-next-line @next/next/no-img-element -- served by the showcase's own gate
            <img src={`/api/showcase/${p.id}/media`} alt={`${p.character} by @${p.handle}`} />
          )}
          <p className="small">
            @{p.handle} · {p.character} · {p.rating} · {p.reports} open report{p.reports === 1 ? "" : "s"}
            {p.held ? " · held" : ""}
          </p>
          {p.caption && <p className="muted small">“{p.caption}”</p>}
          <p>
            <button type="button" className="small" onClick={() => void decide(p.id, "release")}>
              Release
            </button>{" "}
            <button type="button" className="secondary small" onClick={() => void decide(p.id, "remove")}>
              Remove for good
            </button>
          </p>
        </li>
      ))}
    </ul>
  );
}
