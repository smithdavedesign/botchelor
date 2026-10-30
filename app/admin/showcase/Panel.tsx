"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/app/request";
import type { HeldPost } from "@/lib/showcase-moderation";

/** Admin: showcase posts held by a report, then reported ones still up; release or remove each (lib/showcase-moderation.ts). */
type Mine = {
  profile: { handle: string; display_name: string } | null;
  best: { after_dark: number; pg: number };
  posted: number;
  twins: number;
  /** Living portraits still to make (lib/showcase-loops.ts): their safe pictures, the agent-made characters' portraits. */
  loops?: { mine: number; agents: number; usd: number };
  /** After Dark posts still rated explicit, for the PG check (lib/showcase-check.ts). */
  checks?: number;
};
type TwinBatch = { made: { original: string; id: string }[]; failed: { original: string; message: string }[]; left: number };
/** About what one SFW twin costs on Venice (the PG Studio's edit model, studio.pg.usd). */
const TWIN_USD = 0.03;

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
  // SFW twins of their best (lib/showcase.ts twinBest), a few at a time until none are left; one that doesn't pass the
  // PG check is skipped from then on.
  async function makeTwins() {
    setBusy(true);
    const skip: string[] = [];
    let made = 0;
    for (;;) {
      setNote(`Drawing SFW twins… ${made} made${skip.length ? `, ${skip.length} didn't pass` : ""}. Keep this page open.`);
      const res = await requestJson("/api/admin/showcase", { action: "twin_best", skip }, "POST", { timeoutMs: 290_000 }).catch(() => null);
      if (!res?.ok) {
        setNote(`${res?.message ?? "That stopped."} ${made} made so far: click again to carry on.`);
        break;
      }
      const batch = res.data as unknown as TwinBatch;
      made += batch.made.length;
      skip.push(...batch.failed.map((f) => f.original));
      if (!batch.left || (!batch.made.length && !batch.failed.length)) {
        setNote(`${made} SFW twin${made === 1 ? "" : "s"} made${skip.length ? `; ${skip.length} didn't pass the PG check` : ""}. Publish my best work posts them.`);
        break;
      }
    }
    setBusy(false);
    void load();
  }
  // Living portraits (lib/showcase-loops.ts), a few at a time until none are left.
  async function animate(agents: boolean) {
    setBusy(true);
    let made = 0;
    let failed = 0;
    for (;;) {
      setNote(`Bringing pictures to life… ${made} made${failed ? `, ${failed} not kept` : ""}. About a minute for each three; keep this page open.`);
      const res = await requestJson("/api/admin/showcase/animate", { agents }, "POST", { timeoutMs: 295_000 }).catch(() => null);
      if (!res?.ok) {
        setNote(`${res?.message ?? "That stopped."} ${made} made so far: click again to carry on.`);
        break;
      }
      const b = res.data as unknown as { made: string[]; failed: unknown[]; left: number };
      made += b.made.length;
      failed += b.failed.length;
      if (!b.left || (!b.made.length && !b.failed.length)) {
        setNote(`${made} living portrait${made === 1 ? "" : "s"} up${failed ? `; ${failed} not kept (a frame didn't pass, or the model said no)` : ""}.`);
        break;
      }
    }
    setBusy(false);
    void load();
  }
  // The PG check on After Dark posts still rated explicit (lib/showcase-check.ts), a few at a time until none are left.
  async function sortSides() {
    setBusy(true);
    let safe = 0;
    let twin = 0;
    let explicit = 0;
    for (;;) {
      setNote(`Checking After Dark's posts… ${safe + twin} safe for work so far, ${explicit} explicit.`);
      const res = await requestJson("/api/jobs/showcase-check", {}, "POST", { timeoutMs: 295_000 }).catch(() => null);
      if (!res?.ok) {
        setNote(`${res?.message ?? "That stopped."} Click again to carry on.`);
        break;
      }
      const b = res.data as unknown as { results: { outcome: string }[]; left: number };
      safe += b.results.filter((r) => r.outcome === "safe").length;
      twin += b.results.filter((r) => r.outcome === "twin").length;
      explicit += b.results.filter((r) => r.outcome === "explicit").length;
      if (!b.left || !b.results.some((r) => r.outcome !== "skipped")) {
        const skipped = b.left ? ` ${b.left} couldn't be checked now: the hourly job tries again.` : "";
        setNote(`${safe} moved to the safe side, ${twin} already there as their SFW twin (the original's post taken down), ${explicit} explicit.${skipped}`);
        break;
      }
    }
    setBusy(false);
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
      {Boolean(mine.checks) && (
        <p className="small">
          <button type="button" className="button-ghost small" disabled={busy} onClick={() => void sortSides()}>
            🔎 Check After Dark&apos;s posts for dressed ones ({mine.checks})
          </button>{" "}
          <span className="muted">Each through the PG check: a dressed one goes to the safe side. The hourly job does this too.</span>
        </p>
      )}
      {mine.loops && mine.loops.mine + mine.loops.agents > 0 && (
        <p className="small">
          {mine.loops.mine > 0 && (
            <button type="button" className="button-ghost small" disabled={busy} onClick={() => void animate(false)}>
              🎬 Bring my safe pictures to life ({mine.loops.mine}, about ${(mine.loops.mine * mine.loops.usd).toFixed(2)})
            </button>
          )}{" "}
          {mine.loops.agents > 0 && (
            <button type="button" className="button-ghost small" disabled={busy} onClick={() => void animate(true)}>
              🎬 And the agent-made characters ({mine.loops.agents}, about ${(mine.loops.agents * mine.loops.usd).toFixed(2)})
            </button>
          )}{" "}
          <span className="muted">Short clips for the reels, each frame through the PG check. Agent-made characters post as @botchelor.</span>
        </p>
      )}
      {mine.twins > 0 && (
        <p className="small">
          <button type="button" className="button-ghost small" disabled={busy} onClick={() => void makeTwins()}>
            🫧 Make SFW twins of my best ({mine.twins}, about ${(mine.twins * TWIN_USD).toFixed(2)} on Venice)
          </button>{" "}
          <span className="muted">Dressed versions for the side everyone sees, each through the PG check.</span>
        </p>
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
