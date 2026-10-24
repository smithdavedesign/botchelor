"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/app/request";
import RateMedia from "@/app/after-dark/[a]/[b]/RateMedia";
import { HARD_NOS, INTENSITIES, INTENSITY } from "@/lib/adult/limits";
import type { Media } from "@/lib/adult/media";
import type { PairMenu, Setup, Shoot, StudioState } from "@/lib/adult/studio";
import { LEVEL_LABEL, optionById, STRENGTHS, type GroupId, type Level, type ShootChoices } from "@/lib/adult/studio-catalog";

const media = (id: string) => `/api/admin/after-dark/media/${id}`;
const TABS = [
  { id: "shoot", label: "Shoot" },
  { id: "pair", label: "Together" },
  { id: "identity", label: "Identity" },
  { id: "gallery", label: "Gallery" },
  { id: "setups", label: "Setups" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const STRENGTH_LABEL: Record<(typeof STRENGTHS)[number], string> = { loose: "Loose", balanced: "Balanced", strict: "Strict" };
const tokens = (n: number) => (n === 0 ? "free" : `${n} token${n === 1 ? "" : "s"}`);
const PROVIDER_LABEL = { venice: "Venice", replicate: "Replicate" } as const;
const SHARE_STATUS: Record<string, string> = { pending: "asked", accepted: "accepted", sent: "sent to their texts" };
/** How often the page asks after an animation still being made. */
const POLL_MS = 20_000;

type PairPick = { act: string; swap: boolean; outfit: string; framing: string; place: string; light: string };
const NO_PAIR_PICK: PairPick = { act: "", swap: false, outfit: "", framing: "medium", place: "", light: "" };

/**
 * The Studio for one character (lib/adult/studio.ts): a shoot from the menus, a shoot of two (Together), their identity
 * (restyle, recast, body reference, limits, strength), their gallery, where a picture can be made more of, made larger,
 * animated or shared, and the setups saved to run again. Every action answers with the Studio's state after it.
 */
export default function Studio({ initial }: { initial: StudioState }) {
  const [s, setS] = useState(initial);
  const [tab, setTab] = useState<Tab>("shoot");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [fresh, setFresh] = useState<{ title: string; pictures: Media[]; kind: Shoot["kind"] } | null>(null);
  const [choices, setChoices] = useState<ShootChoices>({});
  // Their own key (Connections, After Dark pictures): its provider's models only, and its price.
  const ownKeyReady = Boolean(s.own_key.provider && s.own_key.allowed);
  const [ownKey, setOwnKey] = useState(false);
  const onOwn = ownKey && ownKeyReady;
  const fits = (m: StudioState["models"][number]) => !onOwn || m.provider === s.own_key.provider;
  const usable = (m: StudioState["models"][number]) => (onOwn ? m.provider === s.own_key.provider : m.ready);
  const editModels = s.models.filter((m) => m.job === "edit" && fits(m));
  const newModels = s.models.filter((m) => m.job === "new" && fits(m));
  const [editModel, setEditModel] = useState(initial.models.find((m) => m.job === "edit" && m.ready)?.id ?? initial.models.find((m) => m.job === "edit")?.id ?? "");
  const [newModel, setNewModel] = useState(initial.models.find((m) => m.job === "new" && m.ready)?.id ?? initial.models.find((m) => m.job === "new")?.id ?? "");
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [bodyNude, setBodyNude] = useState(false);
  const [partner, setPartner] = useState("");
  const [pairMenu, setPairMenu] = useState<PairMenu | null>(null);
  const [pairPick, setPairPick] = useState<PairPick>(NO_PAIR_PICK);
  const [sharing, setSharing] = useState<{ image: string; to: string; kind: "after_dark" | "photo" } | null>(null);
  const [animating, setAnimating] = useState<{ image: string; motion: string; seconds: 5 | 10 } | null>(null);
  const [setupName, setSetupName] = useState("");
  const c = s.character;
  const first = c.name.split(/\s+/)[0];
  const picked = editModels.find((m) => m.id === editModel) ?? editModels[0];
  const pickedNew = newModels.find((m) => m.id === newModel) ?? newModels[0];
  const price = (ours: number) => (onOwn ? s.prices.own_key : ours);
  const own = onOwn ? { own_key: true } : {};

  /** Sends one Studio action; the new state comes back with it. */
  async function act(label: string, body: Record<string, unknown>, opts: { title?: string; done?: string } = {}) {
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
    else if (opts.done) setNote({ text: opts.done });
    return res.data;
  }

  // While an animation is being made, ask after it now and then: it lands in the gallery when it's checked and kept.
  const making = s.animating.length;
  useEffect(() => {
    if (!making) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/admin/after-dark/studio?character=${encodeURIComponent(c.id)}`)
        .then((r) => r.json())
        .catch(() => null);
      if (!res?.state) return;
      const next = res.state as StudioState;
      if (next.animating.length < making) setNote({ text: "An animation is done: it's in the gallery (or, if it didn't come through, its tokens are back)." });
      setS(next);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [making, c.id]);

  /** Saves the shoot's (or Together's) choices under a name, to run again on any of their characters. */
  function saveSetup(kind: "shoot" | "pair", choices: Record<string, unknown>, model: string | undefined) {
    if (!setupName.trim()) return setNote({ text: "Give the setup a name first.", error: true });
    void act("save_setup", { action: "save_setup", character_id: c.id, name: setupName, kind, choices, model }, { done: `Saved "${setupName.trim()}".` }).then((d) => d && setSetupName(""));
  }

  const setupRow = (kind: "shoot" | "pair", choices: Record<string, unknown>, model: string | undefined) => (
    <div className="ad-studio-go">
      <input type="text" maxLength={40} placeholder="Name these choices" value={setupName} onChange={(e) => setSetupName(e.target.value)} disabled={Boolean(busy)} aria-label="Setup name" />
      <button type="button" className="button-ghost" disabled={Boolean(busy) || !setupName.trim()} onClick={() => saveSetup(kind, choices, model)}>
        Save as a setup
      </button>
    </div>
  );

  /** A saved setup's choices on its tab, ready to shoot (a Together one still needs someone picked). */
  function loadSetup(x: Setup) {
    if (x.kind === "shoot") {
      setChoices(x.choices as ShootChoices);
      if (x.model && s.models.some((m) => m.id === x.model && m.job === "edit")) setEditModel(x.model);
      setTab("shoot");
    } else {
      const ch = x.choices as Partial<Record<keyof PairPick, unknown>>;
      const str = (v: unknown) => (typeof v === "string" ? v : "");
      setPairPick({ act: str(ch.act), swap: ch.swap === true, outfit: str(ch.outfit), framing: str(ch.framing) || "medium", place: str(ch.place), light: str(ch.light) });
      if (x.model && s.models.some((m) => m.id === x.model && m.job === "edit")) setEditModel(x.model);
      setTab("pair");
      if (!partner) setNote({ text: `"${x.name}" is on the Together tab: pick who with, then shoot.` });
    }
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

  /** A partner for a shoot together: their menu (what the pair's limits allow). */
  async function choosePartner(id: string) {
    setPartner(id);
    setPairMenu(null);
    setPairPick(NO_PAIR_PICK);
    if (!id) return;
    setBusy("pair_menu");
    const res = await fetch(`/api/admin/after-dark/studio?character=${encodeURIComponent(c.id)}&partner=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .catch(() => null);
    setBusy(null);
    if (!res?.pair_menu) return setNote({ text: res?.message ?? "Couldn't open their menu.", error: true });
    setPairMenu(res.pair_menu as PairMenu);
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

  const modelSelect = (list: typeof editModels, value: string, set: (v: string) => void, label: string, priced?: (m: (typeof editModels)[number]) => number) => (
    <select value={value} onChange={(e) => set(e.target.value)} disabled={Boolean(busy)} aria-label={label}>
      {list.map((m) => (
        <option key={m.id} value={m.id} disabled={!usable(m)}>
          {m.label}
          {priced ? ` · ${tokens(price(priced(m)))}` : ""} · {m.runner === "venice" ? "run by Venice" : m.runner === "replicate" ? "Replicate" : "third party via Venice"}
          {usable(m) ? "" : " (not set up)"}
        </option>
      ))}
    </select>
  );

  /** The pictures of them alone: rate, face, body, more like this, upscale, share (and where each went). */
  const gallery = (pics: Media[], opts: { rivals?: string[]; pair?: boolean } = {}) => (
    <ul className="ad-studio-grid">
      {pics.map((p) => {
        const went = s.shares[p.id] ?? [];
        const open = sharing?.image === p.id ? sharing : null;
        const to = s.share_to.find((x) => x.character_id === open?.to);
        const video = p.kind === "video";
        const anim = animating?.image === p.id ? animating : null;
        return (
          <li key={p.id} className="card ad-studio-item">
            {video ? (
              <video src={media(p.id)} controls playsInline preload="metadata" aria-label={`${c.name}, a clip`} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- private, presigned media; not for next/image
              <img src={media(p.id)} alt={`${c.name}, ${p.kind === "baseline" ? "a face to keep" : "a picture"}`} loading="lazy" />
            )}
            <div className="ad-studio-item-tools">
              <RateMedia id={p.id} kind={p.kind} rating={p.rating ?? null} tags={p.tags ?? []} />
              {!opts.pair && !video &&
                (s.identity.face === p.id ? (
                  <span className="badge">The face</span>
                ) : (
                  <button type="button" className="button-ghost small" disabled={Boolean(busy)} onClick={() => void useFace(p.id, opts.rivals?.filter((r) => r !== p.id) ?? [])}>
                    Use this face
                  </button>
                ))}
              {!opts.pair &&
                !video &&
                (s.identity.body === p.id ? (
                  <span className="badge">The body</span>
                ) : (
                  p.kind === "scene" && (
                    <button type="button" className="button-ghost small" disabled={Boolean(busy)} onClick={() => void act(`body:${p.id}`, { action: "use_body", character_id: c.id, image_id: p.id })}>
                      Use as body
                    </button>
                  )
                ))}
            </div>
            {!opts.pair && !video && (
              <div className="ad-studio-item-tools">
                <button
                  type="button"
                  className="button-ghost small"
                  disabled={Boolean(busy) || !picked || !usable(picked)}
                  title={`${s.sizes.shoot} more like this one, ${tokens(price(s.prices.variations))}`}
                  onClick={() => void act(`more:${p.id}`, { action: "variations", character_id: c.id, image_id: p.id, model: picked?.id, ...own }, { title: "More like this" })}
                >
                  {busy === `more:${p.id}` ? "Drawing…" : "More like this"}
                </button>
                {(!onOwn || s.own_key.provider === "venice") && (
                  <button
                    type="button"
                    className="button-ghost small"
                    disabled={Boolean(busy) || s.upscale.left === 0}
                    title={`${s.upscale.scale}× larger, ${tokens(price(s.prices.upscale))}${s.upscale.left === null ? "" : `, ${s.upscale.left} left this month`}`}
                    onClick={() => void act(`up:${p.id}`, { action: "upscale", character_id: c.id, image_id: p.id, ...own }, { title: "Upscaled" })}
                  >
                    {busy === `up:${p.id}` ? "Upscaling…" : `Upscale ${s.upscale.scale}×`}
                  </button>
                )}
                {s.motions.length > 0 && !onOwn && (
                  <button
                    type="button"
                    className="button-ghost small"
                    aria-expanded={Boolean(anim)}
                    disabled={Boolean(busy) || making > 0}
                    title={making ? "One is being animated: one at a time" : "A 5 or 10 second clip of this picture"}
                    onClick={() => setAnimating(anim ? null : { image: p.id, motion: s.motions[0].id, seconds: 5 })}
                  >
                    Animate…
                  </button>
                )}
                {s.share_to.length > 0 && (s.share.after_dark || s.share.photos) && (
                  <button
                    type="button"
                    className="button-ghost small"
                    aria-expanded={Boolean(open)}
                    disabled={Boolean(busy)}
                    onClick={() => setSharing(open ? null : { image: p.id, to: s.share_to[0].character_id, kind: s.share.after_dark && !s.share_to[0].agent ? "after_dark" : "photo" })}
                  >
                    Share…
                  </button>
                )}
              </div>
            )}
            {anim && (
              <div className="ad-studio-share">
                <div className="ad-chip-row" role="group" aria-label="How it moves">
                  {s.motions.map((m) => (
                    <button key={m.id} type="button" className={`ad-chip${anim.motion === m.id ? " on" : ""}`} aria-pressed={anim.motion === m.id} disabled={Boolean(busy)} onClick={() => setAnimating({ ...anim, motion: m.id })}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="ad-chip-row" role="group" aria-label="How long">
                  {([5, 10] as const).map((sec) => (
                    <button key={sec} type="button" className={`ad-chip${anim.seconds === sec ? " on" : ""}`} aria-pressed={anim.seconds === sec} disabled={Boolean(busy)} onClick={() => setAnimating({ ...anim, seconds: sec })}>
                      {sec} s
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="primary small"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void act(`animate:${p.id}`, { action: "animate", character_id: c.id, image_id: p.id, motion: anim.motion, seconds: anim.seconds }, { title: "Animating" }).then((d) => d && setAnimating(null))
                  }
                >
                  Animate · {tokens(anim.seconds === 10 ? s.prices.animate_10 : s.prices.animate_5)}
                </button>
              </div>
            )}
            {open && (
              <div className="ad-studio-share">
                <label>
                  With{" "}
                  <select
                    value={open.to}
                    disabled={Boolean(busy)}
                    onChange={(e) => {
                      const next = s.share_to.find((x) => x.character_id === e.target.value);
                      setSharing({ ...open, to: e.target.value, kind: next?.agent ? "photo" : open.kind });
                    }}
                  >
                    {s.share_to.map((x) => (
                      <option key={x.character_id} value={x.character_id}>
                        {x.name}
                        {x.agent ? " (an agent)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {s.share.after_dark && (
                  <label className="ad-check-row">
                    <input type="radio" name={`kind-${p.id}`} checked={open.kind === "after_dark"} disabled={Boolean(busy) || to?.agent} onChange={() => setSharing({ ...open, kind: "after_dark" })} />{" "}
                    <span>In After Dark: they see it once they accept</span>
                  </label>
                )}
                {s.share.photos && (
                  <label className="ad-check-row">
                    <input type="radio" name={`kind-${p.id}`} checked={open.kind === "photo"} disabled={Boolean(busy)} onChange={() => setSharing({ ...open, kind: "photo" })} />{" "}
                    <span>As a photo in their texts (dressed pictures only)</span>
                  </label>
                )}
                <button
                  type="button"
                  className="primary small"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void act(`share:${p.id}`, { action: "share", character_id: c.id, image_id: p.id, to_character: open.to, kind: open.kind }, { done: open.kind === "photo" ? `Sent to ${to?.name ?? "them"} as a photo.` : `Shared with ${to?.name ?? "them"}: they see it once they accept.` }).then(() => setSharing(null))
                  }
                >
                  Share{s.prices.share ? ` · ${tokens(s.prices.share)}` : ""}
                </button>
              </div>
            )}
            {went.length > 0 && (
              <ul className="ad-studio-went small">
                {went.map((w) => (
                  <li key={w.id}>
                    {w.kind === "photo" ? "📷" : "🌙"} {w.to_name}: {SHARE_STATUS[w.status] ?? w.status}
                    {w.kind === "after_dark" && (
                      <>
                        {" "}
                        <button type="button" className="linklike" disabled={Boolean(busy)} onClick={() => void act(`unshare:${w.id}`, { action: "unshare", character_id: c.id, share_id: w.id }, { done: "Taken back." })}>
                          take back
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );

  const pairAct = pairMenu?.acts.find((a) => a.id === pairPick.act) ?? null;
  const pairOutfits = pairMenu ? pairMenu.outfits.filter((o) => !pairAct || pairAct.outfits.includes(o.id)) : [];
  const pairModels = editModels.filter((m) => m.max_images >= 2);
  const pairModel = pairModels.find((m) => m.id === editModel) ?? pairModels[0];
  const chipRow = (items: { id: string; label: string; disabled?: boolean; title?: string }[], on: string, set: (id: string) => void) => (
    <div className="ad-chip-row">
      {items.map((o) => (
        <button key={o.id} type="button" className={`ad-chip${on === o.id ? " on" : ""}`} aria-pressed={on === o.id} disabled={Boolean(busy) || o.disabled} title={o.title} onClick={() => set(on === o.id ? "" : o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <section className="ad-studio-main">
      <h1>🎨 {c.name}&apos;s studio</h1>
      <p className="muted small">
        {s.tokens === null ? "Admin: no tokens taken." : `${s.tokens} token${s.tokens === 1 ? "" : "s"} left.`}{" "}
        {s.left === null ? "" : `${s.left} Studio pictures left this month.`} Everything here is private to you, and every picture is checked before
        it&apos;s kept.
      </p>
      {s.own_key.provider && (
        <div className="ad-studio-own">
          <label className="ad-check-row">
            <input
              type="checkbox"
              checked={onOwn}
              disabled={Boolean(busy) || !ownKeyReady}
              onChange={(e) => {
                setOwnKey(e.target.checked);
                // The model they picked under Connections, when it's one of the Studio's.
                const theirs = s.models.find((m) => m.id === s.own_key.model && m.provider === s.own_key.provider);
                if (e.target.checked && theirs) (theirs.job === "edit" ? setEditModel : setNewModel)(theirs.id);
              }}
            />{" "}
            <span>
              On my own {PROVIDER_LABEL[s.own_key.provider]} key ({tokens(s.prices.own_key)} a job; your key pays the provider)
            </span>
          </label>
          {!s.own_key.allowed && <p className="muted small">Own {PROVIDER_LABEL[s.own_key.provider]} keys are switched off for now.</p>}
          {s.own_key.problem && (
            <p className="muted small" role="status">
              {s.own_key.problem} <a href="/account/keys">Connections</a>
            </p>
          )}
        </div>
      )}
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
      {making > 0 && (
        <p className="muted small" role="status">
          🎬 Animating, started {Math.max(1, Math.round((Date.now() - new Date(s.animating[0].created_at).getTime()) / 60_000))} min ago. It lands in the gallery once
          it&apos;s checked (a few minutes); you can leave and come back.
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
            <label>Model {modelSelect(editModels, picked?.id ?? "", setEditModel, "Model", (m) => m.price)}</label>
            <span className="badge">{LEVEL_LABEL[level]}</span>
            <button
              type="button"
              className="primary"
              disabled={Boolean(busy) || !picked || !usable(picked)}
              onClick={() => void act("shoot", { action: "shoot", character_id: c.id, choices, model: picked?.id, ...own }, { title: "This shoot" })}
            >
              {busy === "shoot" ? "Shooting… (about a minute)" : `Shoot ${s.sizes.shoot} · ${tokens(price(picked?.price ?? 0))}`}
            </button>
          </div>
          <p className="muted small">
            Anything left unpicked is left to them (and their light to what your ratings have taught it). Their face is Picture 1
            {s.identity.body && s.identity.strength !== "loose" ? ", their body reference Picture 2" : ""}.
          </p>
          {setupRow("shoot", choices, picked?.id)}
        </div>
      )}

      {tab === "pair" && (
        <div className="ad-studio-panel">
          <p className="muted small">
            {first} with someone else in your After Dark: {s.sizes.shoot} pictures of the two of them, held to the limits you set for the pair.
          </p>
          <label>
            With{" "}
            <select value={partner} onChange={(e) => void choosePartner(e.target.value)} disabled={Boolean(busy)}>
              <option value="">Pick someone</option>
              {s.partners.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          {pairMenu && (
            <>
              <fieldset className="ad-studio-group">
                <legend>What they&apos;re doing</legend>
                {chipRow(
                  pairMenu.acts.map((a) => ({ id: a.id, label: a.label, disabled: !a.available, title: a.why ?? (pairPick.swap ? a.swapped : a.says) })),
                  pairPick.act,
                  (id) => setPairPick((x) => ({ ...x, act: id, outfit: "" })),
                )}
                {pairAct && (
                  <>
                    <p className="muted small">{pairPick.swap ? pairAct.swapped : pairAct.says}</p>
                    <label className="ad-check-row">
                      <input type="checkbox" checked={pairPick.swap} disabled={Boolean(busy)} onChange={(e) => setPairPick((x) => ({ ...x, swap: e.target.checked }))} /> <span>The other way round</span>
                    </label>
                  </>
                )}
              </fieldset>
              <fieldset className="ad-studio-group">
                <legend>What they wear</legend>
                {chipRow(
                  pairOutfits.map((o) => ({ id: o.id, label: o.label })),
                  pairPick.outfit,
                  (id) => setPairPick((x) => ({ ...x, outfit: id })),
                )}
              </fieldset>
              <fieldset className="ad-studio-group">
                <legend>Framing</legend>
                {chipRow(
                  pairMenu.framings.map((f) => ({ id: f.id, label: f.label })),
                  pairPick.framing,
                  (id) => setPairPick((x) => ({ ...x, framing: id })),
                )}
              </fieldset>
              <fieldset className="ad-studio-group">
                <legend>Place</legend>
                {chipRow(
                  pairMenu.places.map((p) => ({ id: p.id, label: p.public ? `${p.label} (public)` : p.label })),
                  pairPick.place,
                  (id) => setPairPick((x) => ({ ...x, place: id })),
                )}
              </fieldset>
              <fieldset className="ad-studio-group">
                <legend>Light</legend>
                {chipRow(
                  pairMenu.lights.map((l) => ({ id: l.id, label: l.label })),
                  pairPick.light,
                  (id) => setPairPick((x) => ({ ...x, light: id })),
                )}
              </fieldset>
              <div className="ad-studio-go">
                <label>
                  Model{" "}
                  {modelSelect(pairModels, pairModel?.id ?? "", setEditModel, "Model for a shoot together", (m) => pairMenu.price[m.tier])}
                </label>
                <button
                  type="button"
                  className="primary"
                  disabled={Boolean(busy) || !pairModel || !usable(pairModel) || !pairPick.act || !pairPick.outfit || !pairPick.framing || !pairPick.place}
                  onClick={() =>
                    void act(
                      "pair",
                      {
                        action: "pair",
                        character_id: c.id,
                        partner,
                        act: pairPick.act,
                        swap: pairPick.swap,
                        outfit: pairPick.outfit,
                        framing: pairPick.framing,
                        place: pairPick.place,
                        light: pairPick.light || null,
                        model: pairModel?.id,
                        ...own,
                      },
                      { title: `${first} and ${pairMenu.partner.name}` },
                    )
                  }
                >
                  {busy === "pair" ? "Shooting… (about a minute)" : `Shoot ${s.sizes.shoot} together · ${tokens(price(pairModel ? pairMenu.price[pairModel.tier] : 0))}`}
                </button>
              </div>
              <p className="muted small">Pick what they&apos;re doing, what they wear, the framing and the place. Pictures of the two of them also land in their pair&apos;s gallery.</p>
              {setupRow("pair", { act: pairPick.act || undefined, swap: pairPick.swap, outfit: pairPick.outfit || undefined, framing: pairPick.framing || undefined, place: pairPick.place || undefined, light: pairPick.light || null }, pairModel?.id)}
            </>
          )}
          {s.pair_gallery.length > 0 && (
            <>
              <h2>Shoots together</h2>
              {gallery(s.pair_gallery, { pair: true })}
            </>
          )}
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
          <p className="muted small">The same person with these changed: {s.sizes.restyle} to pick from, for {tokens(price(s.prices.restyle))}.</p>
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
              disabled={Boolean(busy) || !Object.values(changes).some(Boolean) || !picked || !usable(picked)}
              onClick={() => void act("restyle", { action: "restyle", character_id: c.id, changes: Object.fromEntries(Object.entries(changes).filter(([, v]) => v)), model: picked?.id, ...own }, { title: "Restyled: pick one" })}
            >
              {busy === "restyle" ? "Restyling…" : `Restyle · ${tokens(price(s.prices.restyle))}`}
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
          <p className="muted small">A new face drawn from their look: {s.sizes.recast} to pick from, for {tokens(price(s.prices.recast))}.</p>
          <div className="ad-studio-go">
            {modelSelect(newModels, pickedNew?.id ?? "", setNewModel, "Model for a new face")}
            <button
              type="button"
              className="primary"
              disabled={Boolean(busy) || !pickedNew || !usable(pickedNew)}
              onClick={() => void act("recast", { action: "recast", character_id: c.id, model: pickedNew?.id, ...own }, { title: "New faces: pick one" })}
            >
              {busy === "recast" ? "Drawing…" : `Draw ${s.sizes.recast} · ${tokens(price(s.prices.recast))}`}
            </button>
          </div>

          <h2>Body reference</h2>
          <p className="muted small">Head to toe, from their face: shoots add it after the face, so their body stays theirs. {s.sizes.body} to pick from.</p>
          <div className="ad-studio-go">
            <label className="ad-check-row">
              <input type="checkbox" checked={bodyNude} onChange={(e) => setBodyNude(e.target.checked)} disabled={Boolean(busy)} /> Nude
            </label>
            <button
              type="button"
              className="primary"
              disabled={Boolean(busy) || !picked || !usable(picked)}
              onClick={() => void act("body", { action: "body", character_id: c.id, nude: bodyNude, model: picked?.id, ...own }, { title: "Body references: pick one" })}
            >
              {busy === "body" ? "Drawing…" : `Make ${s.sizes.body} · ${tokens(price(s.prices.body))}`}
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
          {gallery(fresh.pictures, { rivals: fresh.kind === "restyle" || fresh.kind === "recast" ? fresh.pictures.map((p) => p.id) : [], pair: fresh.kind === "pair" })}
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

      {tab === "setups" && (
        <div className="ad-studio-panel">
          <p className="muted small">Choices you saved, to run again on any of your characters. A place of one character&apos;s own isn&apos;t kept.</p>
          {s.setups.length === 0 ? (
            <p className="muted">None yet: pick choices on Shoot or Together, then Save as a setup.</p>
          ) : (
            <ul className="ad-shared-list">
              {s.setups.map((x) => {
                const m = s.models.find((y) => y.id === (x.model ?? picked?.id) && y.job === "edit") ?? picked;
                return (
                  <li key={x.id} className="card ad-studio-setup">
                    <strong>{x.name}</strong>{" "}
                    <span className="muted small">
                      {x.kind === "pair" ? "Together" : "Alone"}
                      {x.model ? ` · ${s.models.find((y) => y.id === x.model)?.label ?? x.model}` : ""}
                    </span>
                    <div className="ad-studio-item-tools">
                      <button type="button" className="button-ghost small" disabled={Boolean(busy)} onClick={() => loadSetup(x)}>
                        Use
                      </button>
                      {x.kind === "shoot" && m && (
                        <button
                          type="button"
                          className="primary small"
                          disabled={Boolean(busy) || !usable(m)}
                          onClick={() => void act(`setup:${x.id}`, { action: "shoot", character_id: c.id, choices: x.choices, model: m.id, ...own }, { title: x.name })}
                        >
                          {busy === `setup:${x.id}` ? "Shooting…" : `Shoot it · ${tokens(price(m.price))}`}
                        </button>
                      )}
                      <button type="button" className="linklike" disabled={Boolean(busy)} onClick={() => void act(`del:${x.id}`, { action: "delete_setup", character_id: c.id, setup_id: x.id }, { done: `Deleted "${x.name}".` })}>
                        delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
