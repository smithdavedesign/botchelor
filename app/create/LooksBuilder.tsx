"use client";

/**
 * The looks builder (lib/looks.ts): pick how they look one step at a time, from picture tiles. Two tabs, the same flow:
 * the show's, and After Dark's, whose body steps show explicit tiles and add a step. After Dark's tab is blurred and
 * locked for anyone who can't open it; they're only ever shown the show's tiles, blurred, never an explicit picture.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AiFiction } from "@/app/AiLabel";
import {
  detailsFor,
  genderTileId,
  LOOK_AGES,
  LOOK_DETAILS,
  looksAppearance,
  optionLabel,
  optionsFor,
  stepsFor,
  tileId,
  type Gender,
  type LookDetail,
  type LookStep,
  type Looks,
} from "@/lib/looks";

type Props = {
  looks: Looks;
  setLooks: (l: Looks) => void;
  age: string;
  setAge: (a: string) => void;
  /** Tiles that have a picture (the rest show their label). */
  tiles: readonly string[];
  /** This viewer can open After Dark (an admin, or a subscriber with a passed age check). */
  afterDark: boolean;
  /** The appearance line the picks describe, each time they change. */
  onAppearance: (line: string) => void;
  onGender?: (g: Gender) => void;
};

/** A step's current pick, wherever it's stored (After Dark's live under looks.after_dark). */
function current(looks: Looks, step: LookStep, adTab: boolean): string | undefined {
  if (step.id === "butt") return looks.after_dark?.butt;
  if (step.id === "outfit" && adTab) return looks.after_dark?.outfit;
  if (step.id === "age") return looks.age ? String(looks.age) : undefined;
  return looks[step.id as keyof Omit<Looks, "after_dark" | "age">] as string | undefined;
}

function choose(looks: Looks, step: LookStep, adTab: boolean, id: string): Looks {
  if (step.id === "butt" || (step.id === "outfit" && adTab)) return { ...looks, after_dark: { ...looks.after_dark, [step.id]: id } };
  if (step.id === "gender") {
    // A new gender: the picks that only fit the other one go.
    const g = id as Gender;
    const next: Looks = { ...looks, gender: g };
    for (const s of stepsFor(g === "man" ? "woman" : "man", true)) {
      const k = s.id as keyof Looks;
      if (s.id === "gender" || s.id === "age" || next[k] === undefined) continue;
      if (s.only && s.only !== g) delete next[k];
      else if (!optionsFor(s, g).some((o) => o.id === next[k])) delete next[k];
    }
    for (const d of LOOK_DETAILS) if (d.only && d.only !== g) delete next[d.id as keyof Looks];
    if (next.after_dark) {
      const { butt, grooming } = next.after_dark;
      next.after_dark = { ...(g === "woman" && butt ? { butt } : {}), ...(grooming ? { grooming } : {}) };
    }
    return next;
  }
  return { ...looks, [step.id]: id };
}

/** A finer detail's current pick (lib/looks.ts LOOK_DETAILS; After Dark's under looks.after_dark). */
function detailOf(looks: Looks, d: LookDetail): string | undefined {
  if (d.afterDark) return looks.after_dark?.[d.id as "grooming"];
  return looks[d.id as keyof Omit<Looks, "after_dark" | "age">] as string | undefined;
}

/** A detail picked, or taken off (`id` undefined: None). */
function chooseDetail(looks: Looks, d: LookDetail, id: string | undefined): Looks {
  if (d.afterDark) {
    const ad: NonNullable<Looks["after_dark"]> = { ...looks.after_dark, [d.id]: id };
    if (!id) delete ad[d.id as "grooming"];
    return { ...looks, after_dark: ad };
  }
  const next = { ...looks, [d.id]: id } as Looks;
  if (!id) delete next[d.id as keyof Looks];
  return next;
}

/** What a locked After Dark tile shows: the show's nearest tile, blurred. */
function lockedTile(gender: Gender, step: LookStep, option: string): string {
  if (step.id === "butt") return tileId(gender, "body", "curvy", false);
  if (step.id === "outfit") return tileId(gender, "outfit", "casual", false);
  return tileId(gender, step.id, option, false);
}

export default function LooksBuilder({ looks, setLooks, age, setAge, tiles, afterDark, onAppearance, onGender }: Props) {
  const [tab, setTab] = useState<"show" | "after_dark">("show");
  const adTab = tab === "after_dark";
  const locked = adTab && !afterDark;
  const gender: Gender = looks.gender ?? "woman";
  const steps = stepsFor(gender, adTab);
  // A look already picked (editing, or back on this step): open on its summary, not an empty first step.
  const [i, setI] = useState(() => (looks.gender ? stepsFor(looks.gender, false).length : 0));
  const at = Math.min(i, steps.length);
  const step = steps[at] as LookStep | undefined; // undefined: the summary
  const have = new Set(tiles);
  const advance = useRef<number | null>(null);

  useEffect(() => () => {
    if (advance.current) window.clearTimeout(advance.current);
  }, []);

  // A dot, Previous, Next or Change look: the pick's own auto-advance (below) is dropped, or a tap within its 280 ms
  // landed one step further than asked (the audit, 2026-10-31).
  const go = (to: number | ((n: number) => number)) => {
    if (advance.current) window.clearTimeout(advance.current);
    advance.current = null;
    setI(to);
  };

  // The age strip runs 18 and up, sideways: bring the age they already have into view, so it reads as theirs (a 34
  // used to sit off-screen with 18–22 showing, and a tap quietly changed the Identity step's age).
  const ages = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (step?.id !== "age") return;
    ages.current?.querySelector<HTMLElement>(".chosen")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [step?.id]);

  function pick(s: LookStep, id: string) {
    if (locked) return;
    const next = choose(looks, s, adTab, id);
    setLooks(next);
    onAppearance(looksAppearance(next));
    if (s.id === "gender") onGender?.(id as Gender);
    // Like the reference flow: a pick moves on by itself, after a beat to see it chosen.
    if (advance.current) window.clearTimeout(advance.current);
    advance.current = window.setTimeout(() => setI((n) => Math.min(n + 1, stepsFor((next.gender ?? "woman") as Gender, adTab).length)), 280);
  }

  function pickDetail(d: LookDetail, id: string | undefined) {
    if (locked) return;
    const next = chooseDetail(looks, d, id);
    setLooks(next);
    onAppearance(looksAppearance(next));
  }

  function pickAge(n: number) {
    if (locked) return;
    const next = { ...looks, age: n };
    setLooks(next);
    setAge(String(n));
  }

  const src = (id: string) => (have.has(id) ? `/api/looks/${id}` : null);

  return (
    <div className={`looks-builder${adTab ? " is-after-dark" : ""}`}>
      <div className="looks-tabs" role="tablist" aria-label="Which looks">
        <button type="button" role="tab" aria-selected={!adTab} className={!adTab ? "chosen" : ""} onClick={() => setTab("show")}>
          Normal
        </button>
        <button type="button" role="tab" aria-selected={adTab} className={adTab ? "chosen" : ""} onClick={() => setTab("after_dark")}>
          🌙 After Dark {afterDark ? "" : <span className="looks-lock" aria-label="locked">🔒</span>}
        </button>
      </div>

      <ol className="looks-dots" aria-label="Looks steps">
        {[...steps, null].map((s, n) => (
          <li key={s?.id ?? "done"}>
            <button
              type="button"
              className={n === at ? "current" : n < at ? "done" : ""}
              aria-label={s?.title ?? "Your look"}
              aria-current={n === at ? "step" : undefined}
              onClick={() => go(n)}
            />
          </li>
        ))}
      </ol>

      <div className={`looks-stage${locked ? " locked" : ""}`} aria-hidden={locked || undefined}>
        {step ? (
          <>
            <h3 className="looks-title">
              <span className="muted small">
                Step {at + 1} of {steps.length}
              </span>
              {step.title}
            </h3>
            {step.id === "age" ? (
              <>
                {age && <p className="muted small looks-age-note">{age}, the age from their identity. Pick another to change it.</p>}
                <div ref={ages} className="looks-ages" role="radiogroup" aria-label="Age">
                  {LOOK_AGES.map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={String(n) === age}
                      className={String(n) === age ? "chosen" : ""}
                      onClick={() => pickAge(n)}
                      tabIndex={locked ? -1 : undefined}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <ul className={`looks-grid${step.id === "gender" || step.id === "style" ? " two" : ""}`}>
                {(step.id === "gender" ? (["woman", "man"] as const).map((g) => ({ id: g, label: g === "woman" ? "Woman" : "Man" })) : optionsFor(step, gender, adTab)).map((o) => {
                  const id = step.id === "gender" ? genderTileId(o.id as Gender) : tileId(gender, step.id, o.id, adTab && afterDark);
                  // Locked: the show's tile, blurred. An explicit one is never sent to someone who can't open After Dark.
                  const img = src(locked ? lockedTile(gender, step, o.id) : id);
                  const chosen = current(looks, step, adTab) === o.id;
                  const label = "labelMan" in o ? optionLabel(o, gender) : o.label;
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        className={`looks-tile${chosen ? " chosen" : ""}${img ? "" : " no-img"}`}
                        aria-pressed={chosen}
                        onClick={() => pick(step, o.id)}
                        tabIndex={locked ? -1 : undefined}
                      >
                        {img ? (
                          <img src={img} alt="" loading="lazy" decoding="async" />
                        ) : (
                          // No picture drawn for this tile yet: a figure over the label, not an empty box.
                          <span className="looks-tile-fallback" aria-hidden>
                            {step.id === "gender" ? (o.id === "man" ? "👨" : "👩") : "👤"}
                          </span>
                        )}
                        <span className="looks-tile-label">
                          {chosen && <span aria-hidden>✓ </span>}
                          {label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {/* The example pictures were drawn by a model: one label for the grid, not one per tile. */}
            {step.id !== "age" && <AiFiction text="Example pictures are AI-generated." className="looks-ai-note" />}
          </>
        ) : (
          <div className="looks-summary">
            <h3 className="looks-title">Their look</h3>
            <p>{looksAppearance(looks) || "Nothing picked yet: go back and choose."}</p>
            <ul className="looks-chips">
              {steps
                .filter((s) => current(looks, s, adTab))
                .map((s) => {
                  const v = current(looks, s, adTab)!;
                  const o = optionsFor(s, gender, adTab).find((x) => x.id === v);
                  return (
                    <li key={s.id}>
                      <button type="button" className="chip" onClick={() => go(steps.indexOf(s))}>
                        {s.id === "gender" ? (v === "man" ? "Man" : "Woman") : s.id === "age" ? `${v} years` : o ? optionLabel(o, gender) : v}
                      </button>
                    </li>
                  );
                })}
            </ul>
            {looks.gender && (
              // The finer details: fixed choices, no pictures, none needed (lib/looks.ts LOOK_DETAILS).
              <div className="looks-details">
                <h4>
                  Finer details <span className="muted small">· optional</span>
                </h4>
                {detailsFor(gender, adTab).map((d) => {
                  const v = detailOf(looks, d) ?? "";
                  return (
                    <div key={d.id} className="looks-detail" role="radiogroup" aria-label={d.title}>
                      <span className="looks-detail-title">{d.title}</span>
                      {[{ id: "", label: "None" }, ...d.options].map((o) => (
                        <button
                          key={o.id || "none"}
                          type="button"
                          role="radio"
                          aria-checked={v === o.id}
                          className={`chip${v === o.id ? " chip-on" : ""}`}
                          onClick={() => pickDetail(d, o.id || undefined)}
                          tabIndex={locked ? -1 : undefined}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="muted small">
              This becomes their appearance line, and their portrait is drawn from it when you create them. Tap a pick to change it.
            </p>
            {looks.gender && (
              <button type="button" className="secondary small looks-change" onClick={() => go(0)}>
                Change look
              </button>
            )}
          </div>
        )}
      </div>

      {locked && (
        <div className="looks-unlock">
          <p>
            <strong>🌙 After Dark looks are for subscribers.</strong> Spicier outfits, body details and uncensored pictures of the
            character you make.
          </p>
          <Link className="button" href="/after-dark/subscribe">
            Subscribe to unlock
          </Link>
        </div>
      )}

      <div className="looks-nav">
        {/* Small text links, so they don't compete with the wizard's own Back and Next below. */}
        <button type="button" className="link-button" onClick={() => go((n) => Math.max(0, n - 1))} disabled={at === 0}>
          ← Previous
        </button>
        {step && (
          <button type="button" className="link-button" onClick={() => go((n) => Math.min(n + 1, steps.length))}>
            {current(looks, step, adTab) ? "Next →" : "Skip →"}
          </button>
        )}
      </div>
    </div>
  );
}
