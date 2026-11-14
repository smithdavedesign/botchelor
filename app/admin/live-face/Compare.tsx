"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Renderer = { id: string; label: string; kind: "live" | "batch" | "stream"; provider: string; model: string; about: string; costHint: string | null; runs: boolean; key: "yours" | "house" | null; ready: boolean };
type Character = { id: string; name: string; live_face: string | null };
type CompareRow = { id: string; character_id: string; character_name: string | null; line: string; audio_seconds: number | null; created_at: string };
type RenderRow = { id: string; compare_id: string; renderer: string; provider: string; model: string; status: "queued" | "running" | "done" | "failed"; ms: number | null; cost_usd: number | null; error: string | null; rating: number | null; note: string | null };
type Listing = { renderers: Renderer[]; characters: Character[]; compares: { compare: CompareRow; renders: RenderRow[] }[]; averages: { renderer: string; rated: number; average: number }[] };

const DEFAULT_LINE = "Found a new draft in the lantern room. It hums. I think it's trying to tell me something.";
const POLL_MS = 3000;

/** The compare page's body: pick, run, watch the renders land, rate; and which renderer this admin's own calls use. */
export default function Compare() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [character, setCharacter] = useState("");
  const [line, setLine] = useState(DEFAULT_LINE);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ compare: CompareRow; renders: RenderRow[] } | null>(null);
  const [mine, setMine] = useState<string>("auto");
  const timer = useRef<number>(0);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/live-face/compare");
    if (!res.ok) {
      setError("Couldn't load the compare.");
      return;
    }
    const data = (await res.json()) as Listing;
    setListing(data);
    setCharacter((c) => c || data.characters[0]?.id || "");
    setPicked((p) => (p.size ? p : new Set(data.renderers.filter((r) => r.ready && r.kind !== "stream").map((r) => r.id))));
  }, []);

  useEffect(() => {
    void load();
    void fetch("/api/me/live-face").then(async (r) => r.ok && setMine(((await r.json()) as { renderer: string }).renderer));
  }, [load]);

  // While a compare has renders still going, ask after it every few seconds.
  useEffect(() => {
    window.clearInterval(timer.current);
    if (!open || !open.renders.some((r) => r.status === "queued" || r.status === "running")) return;
    timer.current = window.setInterval(async () => {
      const res = await fetch(`/api/admin/live-face/compare?id=${encodeURIComponent(open.compare.id)}`);
      if (res.ok) setOpen((await res.json()) as { compare: CompareRow; renders: RenderRow[] });
    }, POLL_MS);
    return () => window.clearInterval(timer.current);
  }, [open]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/live-face/compare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "run", character_id: character, line, renderers: Array.from(picked) }) });
      const data = (await res.json()) as { id?: string; message?: string; error?: string };
      if (!res.ok || !data.id) {
        setError(data.message ?? data.error ?? "That didn't work.");
        return;
      }
      const state = await fetch(`/api/admin/live-face/compare?id=${encodeURIComponent(data.id)}`);
      if (state.ok) setOpen((await state.json()) as { compare: CompareRow; renders: RenderRow[] });
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function rate(render: RenderRow, rating: number | null) {
    await fetch("/api/admin/live-face/compare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rate", render_id: render.id, rating }) });
    setOpen((o) => (o ? { ...o, renders: o.renders.map((r) => (r.id === render.id ? { ...r, rating } : r)) } : o));
    void load();
  }

  async function chooseMine(renderer: string) {
    setMine(renderer);
    await fetch("/api/me/live-face", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ renderer }) });
  }

  if (!listing) return <p className="muted">{error ?? "Loading…"}</p>;
  const byId = new Map(listing.renderers.map((r) => [r.id, r]));
  const show = (c: { compare: CompareRow; renders: RenderRow[] }) => setOpen(c);

  return (
    <div className="stack" style={{ display: "grid", gap: "1.25rem" }}>
      <section className="card" style={{ display: "grid", gap: "0.75rem" }}>
        <h2 style={{ margin: 0 }}>Run a compare</h2>
        <label>
          Character
          <select value={character} onChange={(e) => setCharacter(e.target.value)}>
            {listing.characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.live_face ? "· has a MuseTalk face" : "· no MuseTalk face yet"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Their line
          <textarea value={line} onChange={(e) => setLine(e.target.value)} maxLength={240} rows={2} />
        </label>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: "0.35rem" }}>
          <legend>Renderers</legend>
          {listing.renderers.map((r) => (
            <label key={r.id} style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", opacity: r.ready ? 1 : 0.6 }}>
              <input type="checkbox" disabled={!r.ready} checked={picked.has(r.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
              <span>
                <strong>{r.label}</strong> <span className="muted small">{r.kind} · {r.key === "yours" ? "your key" : r.key === "house" ? "house key" : r.runs ? "no key: add one on /account/keys" : "stream, not a clip"}</span>
                <br />
                <span className="small">{r.about}{r.costHint ? ` · ${r.costHint}` : ""}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="button" disabled={busy || !character || !picked.size} onClick={() => void run()}>
            {busy ? "Voicing the line…" : `▶ Render with ${picked.size} renderer${picked.size === 1 ? "" : "s"}`}
          </button>
          {error && <span className="error">{error}</span>}
        </div>
      </section>

      {open && (
        <section className="card" style={{ display: "grid", gap: "0.75rem" }}>
          <h2 style={{ margin: 0 }}>
            {open.compare.character_name ?? open.compare.character_id}: “{open.compare.line}” <span className="muted small">{open.compare.audio_seconds ? `${open.compare.audio_seconds} s of voice` : ""}</span>
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "1rem" }}>
            {open.renders.map((r) => {
              const info = byId.get(r.renderer);
              return (
                <figure key={r.id} style={{ margin: 0, display: "grid", gap: "0.4rem" }}>
                  {r.status === "done" ? (
                    <video controls playsInline preload="metadata" src={`/api/admin/live-face/compare/clip/${r.id}`} style={{ width: "100%", aspectRatio: "1 / 1", background: "#000", borderRadius: "0.75rem" }} />
                  ) : (
                    <div style={{ width: "100%", aspectRatio: "1 / 1", display: "grid", placeItems: "center", borderRadius: "0.75rem", border: "1px dashed var(--line)" }} className="muted">
                      {r.status === "failed" ? "failed" : r.status === "running" ? "rendering…" : "queued"}
                    </div>
                  )}
                  <figcaption>
                    <strong>{info?.label ?? r.renderer}</strong>
                    <br />
                    <span className="small muted">
                      {r.status === "done" ? `${((r.ms ?? 0) / 1000).toFixed(1)} s to render` : r.status}
                      {r.cost_usd !== null && r.cost_usd !== undefined ? ` · ≈ ${(r.cost_usd * 100).toFixed(1)}¢` : info?.costHint ? ` · ${info.costHint}` : ""}
                      {r.note ? ` · ${r.note}` : ""}
                    </span>
                    {r.error && (
                      <>
                        <br />
                        <span className="small error">{r.error}</span>
                      </>
                    )}
                    {r.status === "done" && (
                      <div style={{ display: "flex", gap: "0.25rem", marginTop: "0.35rem" }} role="radiogroup" aria-label={`Rating for ${info?.label ?? r.renderer}`}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button key={n} type="button" className={`button-ghost small${r.rating === n ? " is-on" : ""}`} aria-pressed={r.rating === n} onClick={() => void rate(r, r.rating === n ? null : n)}>
                            {n}
                          </button>
                        ))}
                      </div>
                    )}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </section>
      )}

      <section className="card" style={{ display: "grid", gap: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Your calls</h2>
        <p className="muted small" style={{ margin: 0 }}>Which renderer your own live calls use when the character has a face at it. Auto is the server's setting.</p>
        <label>
          Renderer
          <select value={mine} onChange={(e) => void chooseMine(e.target.value)}>
            <option value="auto">Auto (the server's)</option>
            <option value="musetalk">MuseTalk clips (ours)</option>
            <option value="simli">Simli stream</option>
          </select>
        </label>
      </section>

      {listing.averages.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Ratings so far</h2>
          <table>
            <thead>
              <tr>
                <th>Renderer</th>
                <th>Average</th>
                <th>Rated</th>
              </tr>
            </thead>
            <tbody>
              {listing.averages.map((a) => (
                <tr key={a.renderer}>
                  <td>{byId.get(a.renderer)?.label ?? a.renderer}</td>
                  <td>{a.average.toFixed(2)}</td>
                  <td>{a.rated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {listing.compares.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Recent compares</h2>
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {listing.compares.map((c) => (
              <li key={c.compare.id}>
                <button type="button" className="link" onClick={() => show(c)}>
                  {c.compare.character_name ?? c.compare.character_id}: “{c.compare.line.slice(0, 60)}{c.compare.line.length > 60 ? "…" : ""}”
                </button>{" "}
                <span className="muted small">
                  {c.renders.filter((r) => r.status === "done").length}/{c.renders.length} done
                  {c.renders.some((r) => r.rating) ? ` · rated ${c.renders.filter((r) => r.rating).map((r) => `${byId.get(r.renderer)?.label.split(" ")[0] ?? r.renderer} ${r.rating}`).join(", ")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
