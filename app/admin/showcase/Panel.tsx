"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/app/request";
import type { HeldPost } from "@/lib/showcase-moderation";

/** Admin: showcase posts held by a report, then reported ones still up; release or remove each (lib/showcase-moderation.ts). */
type Mine = { profile: { handle: string; display_name: string } | null; best: { after_dark: number; pg: number }; posted: number };

export default function ShowcaseModeration() {
  const [posts, setPosts] = useState<HeldPost[] | null>(null);
  const [mine, setMine] = useState<Mine | null>(null);
  const [form, setForm] = useState({ handle: "", display_name: "" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = () =>
    fetch("/api/admin/showcase")
      .then((r) => (r.ok ? r.json() : { posts: [] }))
      .then((d) => {
        setPosts(d.posts ?? []);
        setMine(d.mine ?? null);
      })
      .catch(() => setPosts([]));
  async function saveHandle() {
    setBusy(true);
    const res = await requestJson("/api/creator-profile", { handle: form.handle, display_name: form.display_name }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote(res?.message ?? "That didn't save.");
    setNote(null);
    void load();
  }
  async function publishBest() {
    setBusy(true);
    setNote("Publishing… a minute or two for a hundred. If it stops early, click again: what's up stays up.");
    const res = await requestJson("/api/admin/showcase", { action: "publish_best" }, "POST", { timeoutMs: 280_000 }).catch(() => null);
    setBusy(false);
    setNote(res?.ok ? `Published ${res.data.published}${res.data.already ? ` (${res.data.already} were up already)` : ""}${res.data.failed ? `; ${res.data.failed} couldn't be` : ""}.` : (res?.message ?? "That didn't go through."));
    void load();
  }
  const best = mine ? mine.best.after_dark + mine.best.pg : 0;
  const yours = mine && (
    <section className="card showcase-form">
      <h2>Your showcase</h2>
      {mine.profile ? (
        <>
          <p className="small">
            Publishing as <a href={`/creators/${mine.profile.handle}`}>@{mine.profile.handle}</a> · {mine.posted} up now.
          </p>
          <p className="muted small">
            Your best work: {mine.best.after_dark} from After Dark (👍 or 4–5★, none 👎, 1–3★ or archived; pairs with someone else&apos;s character left out) and {mine.best.pg} PG Studio pictures. Explicit posts are seen by admins only until the showcase&apos;s switch.
          </p>
          <button type="button" className="primary small" disabled={busy || !best} onClick={() => void publishBest()}>
            📣 Publish my best work ({best})
          </button>
        </>
      ) : (
        <>
          <p className="small">Pick your public creator handle first: it never shows your login or email.</p>
          <input type="text" maxLength={24} placeholder="handle" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} aria-label="Handle" />
          <input type="text" maxLength={40} placeholder="Name on your page" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} aria-label="Name on your page" />
          <button type="button" className="primary small" disabled={busy || !form.handle || !form.display_name} onClick={() => void saveHandle()}>
            Make my page
          </button>
        </>
      )}
      {note && <p className="muted small" role="status">{note}</p>}
    </section>
  );
  useEffect(() => {
    void load();
  }, []);
  async function decide(id: string, decision: "release" | "remove") {
    await requestJson("/api/admin/showcase", { post_id: id, decision }).catch(() => null);
    void load();
  }
  if (!posts) return <p className="muted">Loading…</p>;
  if (!posts.length)
    return (
      <>
        {yours}
        <p className="muted">Nothing held or reported.</p>
      </>
    );
  return (
    <>
    {yours}
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
    </>
  );
}
