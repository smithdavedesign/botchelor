"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import RateMedia from "@/app/after-dark/[a]/[b]/RateMedia";
import { HARD_NOS, INTENSITIES, INTENSITY } from "@/lib/adult/limits";
import type { Media } from "@/lib/adult/media";
import type { Shoot, StudioState } from "@/lib/adult/studio";
import { LEVEL_LABEL, optionById, STRENGTHS, type GroupId, type Level, type ShootChoices } from "@/lib/adult/studio-catalog";

const media = (id: string) => `/api/admin/after-dark/media/${id}`;
const TABS = [
  { id: "shoot", label: "Shoot" },
  { id: "identity", label: "Identity" },
  { id: "gallery", label: "Gallery" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const STRENGTH_LABEL: Record<(typeof STRENGTHS)[number], string> = { loose: "Loose", balanced: "Balanced", strict: "Strict" };
const tokens = (n: number) => (n === 0 ? "free" : `${n} token${n === 1 ? "" : "s"}`);

/**
 * The Studio for one character (lib/adult/studio.ts): a shoot from the menus, their identity (restyle, recast, body
 * reference, limits, strength), and their gallery. Every action answers with the Studio's state after it.
 */
export default function Studio({ initial }: { initial: StudioState }) {
  const [s, setS] = useState(initial);
  const [tab, setTab] = useState<Tab>("shoot");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [fresh, setFresh] = useState<{ title: string; pictures: Media[]; kind: Shoot["kind"] } | null>(null);
  const [choices, setChoices] = useState<ShootChoices>({});
  const editModels = s.models.filter((m) => m.job === "edit");
  const newModels = s.models.filter((m) => m.job === "new");
  const [editModel, setEditModel] = useState(editModels.find((m) => m.ready)?.id ?? editModels[0]?.id ?? "");
  const [newModel, setNewModel] = useState(newModels.find((m) => m.ready)?.id ?? newModels[0]?.id ?? "");
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [bodyNude, setBodyNude] = useState(false);
  const c = s.character;
  const first = c.name.split(/\s+/)[0];
  const picked = editModels.find((m) => m.id === editModel);

  /** Sends one Studio action; the new state comes back with it. */
  async function act(label: string, body: Record<string, unknown>, opts: { title?: string } = {}) {
    setBusy(label);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/studio", body).catch(() => null);
    setBusy(null);
    if (!res) return setNote({ text: "Network error. Try again.", error: true });
    if (!res.ok) return setNote({ text: res.message, error: true });
    if (res.data.state) setS(res.data.state as StudioState);
    const pictures = (res.data.pictures as Media[] | undefined) ?? [];
    if (res.data.shoot) setFresh({ title: opts.title ?? "New pictures", pictures, kind: (res.data.shoot as Shoot).kind });
    if (typeof res.data.message === "string" && res.data.message) setNote({ text: res.data.message, error: pictures.length === 0 });
    else if (pictures.length) setNote({ text: `${pictures.length} new picture${pictures.length === 1 ? "" : "s"}.` });
    return res.data;
  }

  /** "Use this face": the existing face route (lib/adult/steering.ts), with the others it was picked from. */
  async function useFace(imageId: string, rivals: string[] = []) {
    setBusy(`face:${imageId}`);
    const res = await requestJson("/api/admin/after-dark/face", { character_id: c.id, image_id: imageId, rivals }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setNote({ text: res?.message ?? "Couldn't pick that face.", error: true });
    setS((x) => ({ ...x, identity: { ...x.identity, face: imageId } }));
    setNote({ text: `Every picture and video of ${first} now keeps this face.` });
  }

  const level = (Object.entries(choices) as [string, string | string[] | undefined][]).reduce<Level>((lv, [g, v]) => {
    const ids = Array.isArray(v) ? v : v ? [v] : [];
    for (const id of ids) {
      const opt = id.startsWith("own:") ? null : optionById(g as GroupId, id);
      if (opt && opt.level > lv) lv = opt.level;
    }
    return lv;
  }, 0);

  function pick(group: GroupId, id: string, multi: number) {
    setChoices((x) => {
      if (multi > 1) {
        const cur = new Set(x.accessories ?? []);
        if (cur.has(id)) cur.delete(id);
        else if (cur.size < multi) cur.add(id);
        return { ...x, accessories: [...cur] };
      }
      const key = group as Exclude<GroupId, "accessories">;
      return { ...x, [key]: x[key] === id ? undefined : id };
    });
  }

  const gallery = (pics: Media[], opts: { faces?: boolean; rivals?: string[] } = {}) => (
    <ul className="ad-studio-grid">
      {pics.map((p) => (
        <li key={p.id} className="card ad-studio-item">
          {/* eslint-disable-next-line @next/next/no-img-element -- private, presigned media; not for next/image */}
          <img src={media(p.id)} alt={`${c.name}, ${p.kind === "baseline" ? "a face to keep" : "a picture"}`} loading="lazy" />
          <div className="ad-studio-item-tools">
            <RateMedia id={p.id} kind={p.kind} rating={p.rating ?? null} tags={p.tags ?? []} />
            {s.identity.face === p.id ? (
              <span className="badge">The face</span>
            ) : (
              <button type="button" className="button-ghost small" disabled={Boolean(busy)} onClick={() => void useFace(p.id, opts.rivals?.filter((r) => r !== p.id) ?? [])}>
                Use this face
              </button>
            )}
            {s.identity.body === p.id ? (
              <span className="badge">The body</span>
            ) : (
              p.kind === "scene" && (
                <button type="button" className="button-ghost small" disabled={Boolean(busy)} onClick={() => void act(`body:${p.id}`, { action: "use_body", character_id: c.id, image_id: p.id })}>
                  Use as body
                </button>
              )
            )}
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="ad-studio-main">
      <h1>🎨 {c.name}&apos;s studio</h1>
      <p className="muted small">
        {s.tokens === null ? "Admin: no tokens taken." : `${s.tokens} token${s.tokens === 1 ? "" : "s"} left.`}{" "}
        {s.left === null ? "" : `${s.left} Studio pictures left this month.`} Everything here is private to you, and every picture is checked before
        it&apos;s kept.
      </p>
      <nav className="ad-studio-tabs" role="tablist" aria-label="Studio">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {note && (
        <p className={note.error ? "error" : "muted"} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}

      {tab === "shoot" && (
        <div className="ad-studio-panel">
          {s.menu.map((g) => (
            <fieldset key={g.id} className="ad-studio-group">
              <legend>
                {g.title}
                {g.multi > 1 ? <span className="muted small"> (up to {g.multi})</span> : null}
              </legend>
              <div className="ad-chip-row">
                {(g.id === "place" ? [...s.places.map((p) => ({ id: p.id, label: `${p.label} (theirs)`, level: 0 as Level, public: p.public, locked: null })), ...g.options] : g.options).map((o) => {
                  const on = g.multi > 1 ? (choices.accessories ?? []).includes(o.id) : choices[g.id as Exclude<GroupId, "accessories">] === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      className={`ad-chip${on ? " on" : ""}`}
                      aria-pressed={on}
                      disabled={Boolean(o.locked) || Boolean(busy)}
                      title={o.locked ?? (o.level ? LEVEL_LABEL[o.level] : undefined)}
                      onClick={() => pick(g.id, o.id, g.multi)}
                    >
                      {o.label}
                      {o.level >= 2 ? " 🔞" : ""}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <div className="ad-studio-go">
            <label>
              Model{" "}
              <select value={editModel} onChange={(e) => setEditModel(e.target.value)} disabled={Boolean(busy)}>
                {editModels.map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.ready}>
                    {m.label} · {tokens(m.price)} · {m.runner === "venice" ? "run by Venice" : m.runner === "replicate" ? "Replicate" : "third party via Venice"}
                    {m.ready ? "" : " (not set up)"}
                  </option>
                ))}
              </select>
            </label>
            <span className="badge">{LEVEL_LABEL[level]}</span>
            <button
              type="button"
              className="primary"
              disabled={Boolean(busy) || !picked?.ready}
              onClick={() => void act("shoot", { action: "shoot", character_id: c.id, choices, model: editModel }, { title: "This shoot" })}
            >
              {busy === "shoot" ? "Shooting… (about a minute)" : `Shoot ${s.sizes.shoot} · ${tokens(picked?.price ?? 0)}`}
            </button>
          </div>
          <p className="muted small">
            Anything left unpicked is left to them (and their light to what your ratings have taught it). Their face is Picture 1
            {s.identity.body ? ", their body reference Picture 2" : ""}.
          </p>
        </div>
      )}

      {tab === "identity" && (
        <div className="ad-studio-panel">
          <div className="ad-studio-refs">
            <figure>
              {s.identity.face ? (
                // eslint-disable-next-line @next/next/no-img-element -- private, presigned media
                <img src={media(s.identity.face)} alt={`${c.name}'s face`} />
              ) : (
                <div className="ad-studio-empty">No face yet: the first shoot makes one.</div>
              )}
              <figcaption className="small">The face every picture keeps</figcaption>
            </figure>
            <figure>
              {s.identity.body ? (
                // eslint-disable-next-line @next/next/no-img-element -- private, presigned media
                <img src={media(s.identity.body)} alt={`${c.name}'s body reference`} />
              ) : (
                <div className="ad-studio-empty">No body reference yet.</div>
              )}
              <figcaption className="small">
                Body reference{" "}
                {s.identity.body && (
                  <button type="button" className="linklike" disabled={Boolean(busy)} onClick={() => void act("unbody", { action: "use_body", character_id: c.id, image_id: null })}>
                    remove
                  </button>
                )}
              </figcaption>
            </figure>
          </div>

          <fieldset className="ad-studio-group">
            <legend>How strictly pictures keep the face</legend>
            <div className="ad-chip-row">
              {STRENGTHS.map((x) => (
                <button key={x} type="button" className={`ad-chip${s.identity.strength === x ? " on" : ""}`} aria-pressed={s.identity.strength === x} disabled={Boolean(busy)} onClick={() => void act("strength", { action: "strength", character_id: c.id, strength: x })}>
                  {STRENGTH_LABEL[x]}
                </button>
              ))}
            </div>
          </fieldset>

          <h2>Restyle</h2>
          <p className="muted small">The same person with these changed: {s.sizes.restyle} to pick from, for {tokens(s.prices.restyle)}.</p>
          {s.restyle.map((g) => (
            <fieldset key={g.id} className="ad-studio-group">
              <legend>{g.title}</legend>
              <div className="ad-chip-row">
                {g.options.map((o) => (
                  <button key={o.id} type="button" className={`ad-chip${changes[g.id] === o.id ? " on" : ""}`} aria-pressed={changes[g.id] === o.id} disabled={Boolean(busy)} onClick={() => setChanges((x) => ({ ...x, [g.id]: x[g.id] === o.id ? "" : o.id }))}>
                    {o.label}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="ad-studio-go">
            <button
              type="button"
              className="primary"
              disabled={Boolean(busy) || !Object.values(changes).some(Boolean) || !picked?.ready}
              onClick={() => void act("restyle", { action: "restyle", character_id: c.id, changes: Object.fromEntries(Object.entries(changes).filter(([, v]) => v)), model: editModel }, { title: "Restyled: pick one" })}
            >
              {busy === "restyle" ? "Restyling…" : `Restyle · ${tokens(s.prices.restyle)}`}
            </button>
            {c.own && !c.house && (
              <button
                type="button"
                className="button-ghost"
                disabled={Boolean(busy) || !Object.values(changes).some(Boolean)}
                onClick={() => void act("save_looks", { action: "save_looks", character_id: c.id, changes: Object.fromEntries(Object.entries(changes).filter(([, v]) => v)) })}
                title="Write these to their look, so their appearance line and every later picture say the same"
              >
                Save to their look
              </button>
            )}
          </div>

          <h2>Recast</h2>
          <p className="muted small">A new face drawn from their look: {s.sizes.recast} to pick from, for {tokens(s.prices.recast)}.</p>
          <div className="ad-studio-go">
            <select value={newModel} onChange={(e) => setNewModel(e.target.value)} disabled={Boolean(busy)} aria-label="Model for a new face">
              {newModels.map((m) => (
                <option key={m.id} value={m.id} disabled={!m.ready}>
                  {m.label} · {m.runner === "venice" ? "run by Venice" : m.runner === "replicate" ? "Replicate" : "third party via Venice"}
                  {m.ready ? "" : " (not set up)"}
                </option>
              ))}
            </select>
            <button type="button" className="primary" disabled={Boolean(busy) || !newModels.find((m) => m.id === newModel)?.ready} onClick={() => void act("recast", { action: "recast", character_id: c.id, model: newModel }, { title: "New faces: pick one" })}>
              {busy === "recast" ? "Drawing…" : `Draw ${s.sizes.recast} · ${tokens(s.prices.recast)}`}
            </button>
          </div>

          <h2>Body reference</h2>
          <p className="muted small">Head to toe, from their face: shoots add it after the face, so their body stays theirs. {s.sizes.body} to pick from.</p>
          <div className="ad-studio-go">
            <label className="ad-check-row">
              <input type="checkbox" checked={bodyNude} onChange={(e) => setBodyNude(e.target.checked)} disabled={Boolean(busy)} /> Nude
            </label>
            <button type="button" className="primary" disabled={Boolean(busy) || !picked?.ready} onClick={() => void act("body", { action: "body", character_id: c.id, nude: bodyNude, model: editModel }, { title: "Body references: pick one" })}>
              {busy === "body" ? "Drawing…" : `Make ${s.sizes.body} · ${tokens(s.prices.body)}`}
            </button>
          </div>

          <h2>Their studio limits</h2>
          <fieldset className="ad-studio-group">
            <legend>Intensity</legend>
            <div className="ad-chip-row">
              {INTENSITIES.map((x) => (
                <button key={x} type="button" className={`ad-chip${s.identity.intensity === x ? " on" : ""}`} aria-pressed={s.identity.intensity === x} disabled={Boolean(busy)} onClick={() => void act("limits", { action: "limits", character_id: c.id, intensity: x })}>
                  {INTENSITY[x].label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="ad-studio-group">
            <legend>Hard nos</legend>
            <div className="ad-chip-row">
              {HARD_NOS.map((h) => {
                const on = s.identity.hard_nos.includes(h.id);
                return (
                  <button
                    key={h.id}
                    type="button"
                    className={`ad-chip${on ? " on" : ""}`}
                    aria-pressed={on}
                    disabled={Boolean(busy)}
                    onClick={() => void act("limits", { action: "limits", character_id: c.id, hard_nos: on ? s.identity.hard_nos.filter((x) => x !== h.id) : [...s.identity.hard_nos, h.id] })}
                  >
                    {h.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
      )}

      {fresh && fresh.pictures.length > 0 && (
        <section className="ad-studio-fresh">
          <h2>{fresh.title}</h2>
          {gallery(fresh.pictures, { rivals: fresh.kind === "restyle" || fresh.kind === "recast" ? fresh.pictures.map((p) => p.id) : [] })}
        </section>
      )}

      {tab === "gallery" && (
        <div className="ad-studio-panel">
          {s.shoots.some((x) => x.redo) && (
            <div className="ad-studio-redo">
              {s.shoots
                .filter((x) => x.redo)
                .map((x) => (
                  <p key={x.id} className="small">
                    You 👎&apos;d every picture of a shoot on {new Date(x.created_at).toLocaleString()}.{" "}
                    <button type="button" className="primary small" disabled={Boolean(busy)} onClick={() => void act(`redo:${x.id}`, { action: "redo", shoot_id: x.id }, { title: "The redo" })}>
                      Redo it free
                    </button>
                  </p>
                ))}
            </div>
          )}
          {s.gallery.length ? gallery(s.gallery) : <p className="muted">Nothing yet: their pictures land here.</p>}
        </div>
      )}
    </section>
  );
}
