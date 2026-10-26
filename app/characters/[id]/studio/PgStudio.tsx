"use client";

import { useCallback, useEffect, useState } from "react";
import { requestJson } from "@/app/request";
import { AiTag } from "@/app/AiLabel";
import { PG_CUSTOM_MAX, type PgChoices, type PgGroup, type PgGroupId } from "@/lib/studio/pg-catalog";
import type { PgPicture, PgState } from "@/lib/studio/pg";
import type { Library } from "@/lib/studio/library";
import CreateLibrary from "@/app/studio/CreateLibrary";
import ExportDialog from "@/app/studio/ExportDialog";
import TileTools, { SelectBar } from "@/app/studio/TileTools";
import { PG_API, useSelection, type Selection } from "@/app/studio/selection";

const pictureUrl = (id: string) => `/api/studio/pictures/${id}`;

/**
 * The PG Studio's page (lib/studio/pg.ts): Shoot (the menus, a pick or a few per group, their own words, then a shoot of
 * four) and Gallery (every picture they've kept, each with its rating). One open group at a time keeps a phone's page short.
 */
export default function PgStudio({ initial }: { initial: PgState }) {
  const [state, setState] = useState(initial);
  const [tab, setTab] = useState<"shoot" | "gallery" | "create">("shoot");
  // One of their own venues (Create), standing in for the menu's place.
  const [ownPlace, setOwnPlace] = useState<string | null>(null);
  const [choices, setChoices] = useState<Partial<Record<PgGroupId, string | string[]>>>({});
  const [custom, setCustom] = useState("");
  const [open, setOpen] = useState<PgGroupId | null>("shot");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [fresh, setFresh] = useState<PgPicture[]>([]);
  // The creator suite (2026-10-26): pictures picked to export together, and the export open for them.
  const sel = useSelection();
  const [exporting, setExporting] = useState<string[] | null>(null);
  const c = state.character;
  const groups = state.groups as readonly PgGroup[];

  const place = typeof choices.place === "string" ? choices.place : null;
  const beach = place === "beach" || place === "pool";

  function toggle(g: PgGroup, id: string) {
    setChoices((cur) => {
      const now = cur[g.id];
      if (g.pick === "one") return { ...cur, [g.id]: now === id ? undefined : id };
      const list = Array.isArray(now) ? now : [];
      if (list.includes(id)) return { ...cur, [g.id]: list.filter((x) => x !== id) };
      if (g.max && list.length >= g.max) return cur;
      return { ...cur, [g.id]: [...list, id] };
    });
  }
  const picked = (g: PgGroup, id: string) => (Array.isArray(choices[g.id]) ? (choices[g.id] as string[]).includes(id) : choices[g.id] === id);
  const summary = (g: PgGroup) => {
    const v = choices[g.id];
    const ids = Array.isArray(v) ? v : v ? [v] : [];
    return ids.map((id) => g.options.find((o) => o.id === id)?.label).filter(Boolean).join(", ");
  };

  async function shoot() {
    setBusy(true);
    setNote(null);
    // Swimwear only goes with a beach or pool: a pick left over from another place is dropped rather than refused.
    const mine = state.library.places.find((p) => p.id === ownPlace);
    const body: PgChoices = { ...choices, ...(custom.trim() ? { custom: custom.trim() } : {}), ...(mine ? { own_place: { name: mine.name, description: mine.description } } : {}) };
    if (mine) delete body.place;
    if (!beach && body.wardrobe === "swim") delete body.wardrobe;
    const res = await requestJson(`/api/characters/${c.id}/studio`, { action: "shoot", choices: body }).catch(() => null);
    setBusy(false);
    if (!res) return setNote({ text: "That didn't reach the server. Check your connection and try again.", error: true });
    if (!res.ok) return setNote({ text: res.message, error: true });
    const pics = (res.data.pictures as PgPicture[]) ?? [];
    setFresh(pics);
    const refresh = await fetch(`/api/characters/${c.id}/studio`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (refresh) setState(refresh as PgState);
    setNote(res.data.message ? { text: String(res.data.message), error: pics.length === 0 } : { text: `${pics.length} new picture${pics.length === 1 ? "" : "s"}: they're in the gallery too.` });
  }

  // The Create tab saved or deleted something: the Where menu and the prompts row follow at once.
  const onLibrary = useCallback((lib: Library) => setState((s) => ({ ...s, library: { places: lib.places.filter((p) => p.mode === "safe"), prompts: lib.prompts.filter((p) => p.mode === "safe") } })), []);

  // Whether "After Dark face" is offered (After Dark open to them, the character in their After Dark).
  const [afterDark, setAfterDark] = useState(false);
  useEffect(() => {
    fetch(`/api/characters/${c.id}/pictures`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setAfterDark(Boolean(d.after_dark)))
      .catch(() => {});
  }, [c.id]);
  async function usePicture(id: string, as: "portrait" | "face") {
    const res = await requestJson(`/api/characters/${c.id}/pictures`, { source: "studio", id, as }).catch(() => null);
    if (!res || !res.ok) return setNote({ text: res ? res.message : "That didn't reach the server.", error: true });
    setNote({ text: as === "portrait" ? `That's ${c.name.split(/\s+/)[0]}'s profile picture now.` : `That's ${c.name.split(/\s+/)[0]}'s After Dark face now.` });
  }

  async function remove(id: string) {
    const res = await requestJson(`/api/characters/${c.id}/studio`, { action: "delete", picture_id: id }).catch(() => null);
    if (res?.ok) {
      setState((s) => ({ ...s, pictures: s.pictures.filter((p) => p.id !== id) }));
      setFresh((f) => f.filter((p) => p.id !== id));
    }
  }

  const price = state.free ? (state.admin ? "free for admins" : "free: their first shoot") : `${state.price} token${state.price === 1 ? "" : "s"}`;
  const canPay = state.free || state.tokens >= state.price;

  return (
    <section className="pg-studio">
      <div className="segmented" role="tablist" aria-label="Studio">
        {(
          [
            ["shoot", "📸 Shoot"],
            ["gallery", `🖼 Gallery (${state.pictures.length})`],
            ["create", "✨ Create"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`segmented-tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "shoot" ? (
        <>
          {!c.face && <p className="muted small">They have no portrait yet, so this shoot draws them from their look. Give them a portrait first to keep one face across every shoot.</p>}
          <div className="pg-groups">
            {groups.map((g) => (
              <div key={g.id} className={`pg-group card${open === g.id ? " open" : ""}`}>
                <button type="button" className="pg-group-head" aria-expanded={open === g.id} onClick={() => setOpen(open === g.id ? null : g.id)}>
                  <strong>{g.title}</strong>
                  <span className="muted small">{(g.id === "place" && ownPlace ? `✨ ${state.library.places.find((p) => p.id === ownPlace)?.name ?? ""}` : summary(g)) || (g.pick === "many" ? `up to ${g.max}` : "any")}</span>
                </button>
                {open === g.id && (
                  <div className="chips pg-chips" role="group" aria-label={g.title}>
                    {/* Their own venues (Create) first, under the menu's: one place or the other. */}
                    {g.id === "place" &&
                      state.library.places.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={`chip pg-mine${ownPlace === p.id ? " chip-on" : ""}`}
                          aria-pressed={ownPlace === p.id}
                          title={p.description ?? undefined}
                          onClick={() => {
                            setOwnPlace(ownPlace === p.id ? null : p.id);
                            setChoices((cur) => ({ ...cur, place: undefined }));
                          }}
                        >
                          ✨ {p.name}
                        </button>
                      ))}
                    {g.options
                      .filter((o) => !o.beach || beach)
                      .map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          className={`chip${picked(g, o.id) ? " chip-on" : ""}`}
                          aria-pressed={picked(g, o.id)}
                          onClick={() => {
                            if (g.id === "place") setOwnPlace(null);
                            toggle(g, o.id);
                          }}
                        >
                          {o.label}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <label htmlFor="pg-custom">Your own words (optional)</label>
          <textarea id="pg-custom" rows={2} maxLength={PG_CUSTOM_MAX} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Holding a red umbrella, laughing at something off camera…" />
          {state.library.prompts.length > 0 && (
            <p className="create-ideas pg-my-prompts">
              <span className="muted small">✨ Your prompts:</span>
              {state.library.prompts.map((p) => (
                <button key={p.id} type="button" className="chip" title={p.text} onClick={() => setCustom(p.text.slice(0, PG_CUSTOM_MAX))}>
                  {p.title ?? (p.text.length > 30 ? `${p.text.slice(0, 28)}…` : p.text)}
                </button>
              ))}
            </p>
          )}
          <p className="pg-go">
            <button type="button" className="primary" disabled={busy || !canPay || state.left_this_month < state.shoot_size} onClick={() => void shoot()}>
              {busy ? "Shooting… (about a minute)" : `Shoot ${state.shoot_size} · ${price}`}
            </button>
            <span className="muted small">
              {state.admin ? "" : `${state.tokens} token${state.tokens === 1 ? "" : "s"} · `}
              {state.left_this_month} pictures left this month. Every picture is checked; one that doesn&apos;t pass isn&apos;t kept, and a shoot that keeps none gives the token back.
            </span>
          </p>
          {note && (
            <p className={note.error ? "error" : "notice"} role={note.error ? "alert" : "status"}>
              {note.text}
            </p>
          )}
          {fresh.length > 0 && <Pictures items={fresh} onDelete={remove} onUse={usePicture} afterDark={afterDark} sel={sel} />}
        </>
      ) : tab === "create" ? (
        <CreateLibrary scope="safe" onLibrary={onLibrary} />
      ) : state.pictures.length ? (
        <>
          {note && (
            <p className={note.error ? "error" : "notice"} role={note.error ? "alert" : "status"}>
              {note.text}
            </p>
          )}
          {!sel.selecting && (
            <p className="studio-gallery-head">
              <button type="button" className="button-ghost small" onClick={sel.start} title="Pick pictures to download together: sizes for stories and feeds, captions, a contact sheet">
                ⬇ Pick to export
              </button>
            </p>
          )}
          <Pictures items={state.pictures} onDelete={remove} onUse={usePicture} afterDark={afterDark} sel={sel} />
          {sel.selecting && (
            <SelectBar count={sel.ids.length} total={state.pictures.length} onAll={() => sel.set(state.pictures.map((p) => p.id))} onExport={() => setExporting(sel.ids)} onDone={sel.done} />
          )}
          {exporting && <ExportDialog ids={exporting} api={PG_API} onClose={() => setExporting(null)} />}
        </>
      ) : (
        <p className="muted">No pictures yet: a shoot puts its pictures here.</p>
      )}
    </section>
  );
}

function Pictures({
  items,
  onDelete,
  onUse,
  afterDark = false,
  sel,
}: {
  items: PgPicture[];
  onDelete: (id: string) => void;
  onUse?: (id: string, as: "portrait" | "face") => void;
  afterDark?: boolean;
  sel?: Selection;
}) {
  return (
    <ul className="pg-pictures">
      {items.map((p) => (
        <li key={p.id} className={`card${sel?.has(p.id) ? " picked" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the owner's private picture, from its own route */}
          <img src={pictureUrl(p.id)} alt="A Studio picture" loading="lazy" />
          <span className="pg-picture-meta">
            <AiTag />
            {p.rating === "suggestive" && <span className="badge" title="Signed-in people only">Suggestive</span>}
            {/* Their profile picture (pg only) or their After Dark face (lib/studio/picture-choice.ts). */}
            {onUse && p.rating === "pg" && (
              <button type="button" className="button-ghost small" onClick={() => onUse(p.id, "portrait")}>
                Profile picture
              </button>
            )}
            {onUse && afterDark && (
              <button type="button" className="button-ghost small" onClick={() => onUse(p.id, "face")}>
                🌙 After Dark face
              </button>
            )}
            <button type="button" className="button-ghost small" onClick={() => onDelete(p.id)}>
              Delete
            </button>
          </span>
          {/* ⬇ Download and ✍️ captions in their voice; a tick while picking pictures to export (app/studio/TileTools.tsx). */}
          <TileTools id={p.id} api={PG_API} selecting={sel?.selecting} selected={sel?.has(p.id)} onToggle={() => sel?.toggle(p.id)} />
        </li>
      ))}
    </ul>
  );
}
