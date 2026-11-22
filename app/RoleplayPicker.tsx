"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { requestJson } from "@/app/request";
import { shortName } from "@/lib/names";
import { DATE_ROLEPLAYS, dateRoleplayById, premiseForYou, ROLEPLAY_PREMISE_MAX, ROLEPLAY_ROLE_MAX, ROLEPLAY_TITLE_MAX } from "@/lib/roleplays";
import type { Stage } from "@/lib/relationship-stages";
import { byDemand, SETUPS_FOR_STAGE, TAGS, tagById, type TagId } from "@/lib/tags";
import { CARD_OPENING_MAX, cardForYou, GENERIC_OPENINGS } from "@/lib/scene-cards";
import type { OpeningChoice } from "@/lib/opening-choice";
import type { MyRoleplay } from "@/lib/studio/library-limits";
import { useTagDemand } from "@/app/useTagDemand";
import { okJson } from "@/lib/ok-json";

/** The roleplays that fit where a pair stands (lib/tags.ts SETUPS_FOR_STAGE): the "For these two" shelf. */
export function forStage(stage: Stage | null | undefined): typeof DATE_ROLEPLAYS {
  const fits = stage ? SETUPS_FOR_STAGE[stage] : undefined;
  return fits ? DATE_ROLEPLAYS.filter((r) => r.tags.some((t) => fits.includes(t))) : [];
}

/** The tag chips of one facet, as the picker shows them: only tags some roleplay has, most wanted first. */
export function shelfTags(facet: "setup" | "theme", demand: Readonly<Record<string, number>> = {}) {
  const used = new Set(DATE_ROLEPLAYS.flatMap((r) => r.tags));
  return byDemand(
    TAGS.filter((t) => t.facet === facet && used.has(t.id)),
    "sfw",
    demand,
  );
}

/** What a picker chose: one of the show's roleplays, or one written for the date, and which role is the booker's. */
export type RoleplayChoice =
  | { roleplay_id: string; my_role: 0 | 1 }
  | { custom: { title: string; premise: string; roles?: [string, string] }; my_role: 0 | 1 };

/** The fields a booking or a proposal sends for a choice (POST /api/episodes, the couple's roleplay route). */
export function roleplayFields(c: RoleplayChoice | null, key: "roleplay" | "terms" = "roleplay"): Record<string, unknown> {
  if (!c) return {};
  if (key === "terms") return "roleplay_id" in c ? { roleplay_id: c.roleplay_id, my_role: c.my_role } : { custom: c.custom, my_role: c.my_role };
  return { roleplay: "roleplay_id" in c ? c.roleplay_id : c.custom, my_role: c.my_role };
}

/** A written roleplay is ready to send: a title, a premise of 20 characters or more, and both roles or neither. */
export function choiceReady(c: RoleplayChoice | null): boolean {
  if (!c) return false;
  if ("roleplay_id" in c) return true;
  const roles = c.custom.roles;
  return c.custom.title.trim().length > 0 && c.custom.premise.trim().length >= 20 && (!roles || (roles[0].trim().length > 0) === (roles[1].trim().length > 0));
}

const fill = (premise: string, a: string, b: string) => premise.replaceAll("{a}", a).replaceAll("{b}", b);

/**
 * The openings the "How it opens" step offers, as the booker reads them (lib/scene-cards.ts): the picked roleplay's
 * card's three, with the names in (or from your side when you play it yourself); the three generic ones for a scene
 * you play yourself with no roleplay; none for a roleplay you wrote (it has no card: write the opening too) or a date
 * with no roleplay. The index is what's sent, so the order is the card's.
 */
export function openingsShown(o: { value: RoleplayChoice | null; me: string; them: string; asYou: boolean }): string[] {
  const def = o.value && "roleplay_id" in o.value ? dateRoleplayById(o.value.roleplay_id) : null;
  if (def) {
    // {a} is whoever plays the first role: the booker's side unless they took the second.
    const first = (o.value?.my_role ?? 0) === 0;
    if (o.asYou) return [...cardForYou(def.card, first ? "a" : "b", o.them).openings];
    return def.card.openings.map((text) => (first ? fill(text, o.me, o.them) : fill(text, o.them, o.me)));
  }
  if (!o.value && o.asYou) return GENERIC_OPENINGS.map((text) => premiseForYou(text, "a", o.them));
  return [];
}

/**
 * The show's roleplays for a date (lib/roleplays.ts), by kind, the safe ones in your Create library (✨ Yours, signed in:
 * lib/studio/library.ts), and one of your own: pick one, and who plays whom. A roleplay is framing only: the characters
 * play it as a game they share for the evening, and the engine decides the ending. One of yours goes as written terms,
 * checked again like any.
 *
 * Its last step, "How it opens" (with `onOpening`; lib/scene-opening.ts): one of the roleplay's three openings, any of
 * them at random, or a sentence of your own. Untouched, nothing is sent and the scene opens as it always did. And when
 * you play it yourself, one line on who you are in scenes (lib/persona.ts), with the way to /account to change it.
 *
 * Shelves (lib/tags.ts, docs/tags.md): two rows of chips, who they are to each other and what kind of story, each in
 * order of demand (Botchelor's own picks when `demand` has them, else the census). With `stage` (a pair that already
 * has a history), a "For these two" shelf first, and it opens on it: second chances for exes, rivals for bad blood…
 */
export default function RoleplayPicker({
  me,
  them,
  value,
  onChange,
  signedIn,
  asYou = false,
  opening = null,
  onOpening,
  stage = null,
  demand,
}: {
  me: string;
  them: string | null;
  value: RoleplayChoice | null;
  onChange: (v: RoleplayChoice | null) => void;
  /** The library is accounts only: without one, it isn't asked for (that was a 401 on every open, 2026-10-31 UX audit). */
  signedIn: boolean;
  /** The person plays it themselves (a companion's scene): "You read fortunes…", "You're the captain". */
  asYou?: boolean;
  /** How it opens, when they chose (null: untouched). */
  opening?: OpeningChoice | null;
  /** Offers the "How it opens" step. Left out, there's no such step (the couple page's proposal has none). */
  onOpening?: (o: OpeningChoice | null) => void;
  /** Where the two of them stand (the relationship graph's stage, as the viewer may see it): the "For these two" shelf. */
  stage?: Stage | null;
  /** Each tag's demand on Botchelor (lib/tag-demand.ts), which orders the chips; the census orders the rest. */
  demand?: Readonly<Record<string, number>>;
}) {
  const id = useId();
  // Our own demand orders the chips once it's here (lib/tag-demand.ts); the census until then.
  const fetched = useTagDemand();
  const order = demand ?? fetched?.roleplays;
  const pairShown = forStage(stage);
  // A pair with a history opens on what fits them; anyone else on everything.
  const [tag, setTag] = useState<TagId | "all" | "yours" | "pair">(pairShown.length ? "pair" : "all");
  // Their library: null until it answers, and stays null for a visitor who isn't signed in (it's accounts only).
  const [yours, setYours] = useState<MyRoleplay[] | null>(null);
  const [kept, setKept] = useState<{ text: string; error?: boolean } | null>(null);
  // Who they are in scenes (lib/persona.ts): asked for only when they play it themselves; undefined until it answers.
  const [persona, setPersona] = useState<{ name: string } | null | undefined>(undefined);
  useEffect(() => {
    if (!signedIn || !asYou) return;
    let live = true;
    fetch("/api/persona")
      .then(okJson)
      .then((d) => {
        // `on: false` (SCENE_PERSONA=0): no line at all.
        if (live && d && d.on !== false) setPersona(d.persona && typeof d.persona.name === "string" ? { name: d.persona.name } : null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [signedIn, asYou]);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    fetch("/api/library")
      .then(okJson)
      .then((d) => {
        if (live && d?.library) setYours((d.library.roleplays as MyRoleplay[]).filter((x) => x.mode === "safe"));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [signedIn]);
  const mine = shortName(me);
  const theirs = them ? shortName(them) : "your date";
  const custom = value && "custom" in value ? value.custom : null;
  const def = value && "roleplay_id" in value ? dateRoleplayById(value.roleplay_id) : null;
  const saved = custom ? ((yours ?? []).find((x) => x.title === custom.title && x.premise === custom.premise) ?? null) : null;
  const roles: readonly [string, string] | null = def ? def.roles : custom?.roles && custom.roles[0].trim() && custom.roles[1].trim() ? custom.roles : null;
  const myRole = value?.my_role ?? 0;
  // {a} is whoever plays the first role: the booker's character unless they took the second.
  const [a, b] = myRole === 0 ? [mine, theirs] : [theirs, mine];
  /** A premise as a tile shows it: with the names, or from your side when you play it yourself. */
  const shownPremise = (premise: string, on: boolean) => (asYou ? premiseForYou(premise, on && myRole === 1 ? "b" : "a", theirs) : fill(premise, on ? a : mine, on ? b : theirs));
  const shown = tag === "yours" ? [] : tag === "pair" ? pairShown : DATE_ROLEPLAYS.filter((r) => tag === "all" || r.tags.includes(tag));
  const ownShown = tag === "all" || tag === "yours" ? (yours ?? []) : [];
  const setCustom = (patch: Partial<{ title: string; premise: string; roles: [string, string] }>) =>
    onChange({ custom: { title: custom?.title ?? "", premise: custom?.premise ?? "", ...(custom?.roles ? { roles: custom.roles } : {}), ...patch }, my_role: myRole });
  /** Another roleplay (or none) has other openings: a pick of one of the three doesn't carry over; a written one does. */
  const pick = (v: RoleplayChoice | null) => {
    onChange(v);
    if (opening && !("written" in opening)) onOpening?.(null);
  };
  const pickSaved = (x: MyRoleplay) => pick(saved?.id === x.id ? null : { custom: { title: x.title, premise: x.premise, ...(x.roles ? { roles: x.roles } : {}) }, my_role: myRole });
  const openings = onOpening ? openingsShown({ value, me: mine, them: theirs, asYou }) : [];
  const written = opening && "written" in opening ? opening.written : null;

  /** Keeps the one they wrote in their library (safe), so it's under ✨ Yours next time. */
  async function keep() {
    if (!custom) return;
    setKept(null);
    const roles = custom.roles && custom.roles[0].trim() && custom.roles[1].trim() ? custom.roles : null;
    const res = await requestJson("/api/library", { action: "save_roleplay", title: custom.title, premise: custom.premise, roles, mode: "safe" }).catch(() => null);
    if (!res) return setKept({ text: "That didn't reach the server. Try again.", error: true });
    if (!res.ok) return setKept({ text: res.message, error: true });
    setYours((list) => [res.data.item as MyRoleplay, ...(list ?? [])]);
    setKept({ text: "Kept: it's under ✨ Yours from now on." });
  }

  const setups = [
    { id: "all" as const, label: "All", icon: "✨", about: "Every roleplay" },
    ...(yours?.length ? [{ id: "yours" as const, label: "Yours", icon: "✨", about: "The ones in your Create library" }] : []),
    ...(pairShown.length ? [{ id: "pair" as const, label: "For these two", icon: "💞", about: "The ones that fit where the two of them stand" }] : []),
    ...shelfTags("setup", order),
  ];
  const chip = (t: { id: TagId | "all" | "yours" | "pair"; label: string; icon: string; about: string }) => (
    <button key={t.id} type="button" className="rp-tag" aria-pressed={tag === t.id} title={t.about} onClick={() => setTag(t.id)}>
      <span aria-hidden="true">{t.icon}</span> {t.label}
    </button>
  );
  return (
    <div className="rp-picker">
      <div className="rp-tags" role="group" aria-label="Who they are to each other">
        {setups.map(chip)}
      </div>
      <div className="rp-tags rp-tags-themes" role="group" aria-label="Kind of story">
        {shelfTags("theme", order).map(chip)}
      </div>
      <ul className="rp-grid" aria-label="Roleplays">
        {ownShown.map((x) => {
          const on = saved?.id === x.id;
          return (
            <li key={x.id}>
              <button type="button" className="rp-tile rp-tile-yours" aria-pressed={on} onClick={() => pickSaved(x)}>
                <span className="rp-tile-title">
                  <span aria-hidden="true">✨</span> {x.title} <span className="badge">Yours</span>
                </span>
                <span className="rp-tile-premise">{shownPremise(x.premise, on)}</span>
              </button>
            </li>
          );
        })}
        {shown.map((r) => {
          const on = def?.id === r.id;
          return (
            <li key={r.id}>
              <button type="button" className="rp-tile" aria-pressed={on} onClick={() => pick(on ? null : { roleplay_id: r.id, my_role: myRole })}>
                <span className="rp-tile-title">
                  <span aria-hidden="true">{r.icon}</span> {r.title}
                </span>
                <span className="rp-tile-premise">{shownPremise(r.premise, on)}</span>
                <span className="rp-tile-tags">{r.tags.map((t) => tagById(t)?.label).join(" · ")}</span>
              </button>
            </li>
          );
        })}
        <li>
          <button type="button" className="rp-tile rp-tile-own" aria-pressed={Boolean(custom) && !saved} onClick={() => pick(custom && !saved ? null : { custom: { title: "", premise: "" }, my_role: myRole })}>
            <span className="rp-tile-title">
              <span aria-hidden="true">✍️</span> One of your own
            </span>
            <span className="rp-tile-premise">{asYou ? `Write who you and ${theirs} are to each other in the scene. PG, and both adults.` : "Write who the two of them are to each other tonight. PG, and both adults."}</span>
          </button>
        </li>
      </ul>

      {custom && !saved && (
        <fieldset className="rp-own">
          <legend>Your roleplay</legend>
          <label htmlFor={`${id}-title`}>Title</label>
          <input id={`${id}-title`} type="text" maxLength={ROLEPLAY_TITLE_MAX} value={custom.title} placeholder="The last lighthouse keepers" onChange={(e) => setCustom({ title: e.target.value })} />
          <label htmlFor={`${id}-premise`}>
            Premise <span className="muted small">(write {"{a}"} and {"{b}"} for the two of them)</span>
          </label>
          <textarea
            id={`${id}-premise`}
            rows={3}
            maxLength={ROLEPLAY_PREMISE_MAX}
            value={custom.premise}
            placeholder="{a} and {b} keep the last lighthouse on the coast, and tonight the ships have stopped coming."
            onChange={(e) => setCustom({ premise: e.target.value })}
          />
          <div className="rp-own-roles">
            <label>
              <span className="muted small">First role (optional)</span>
              <input type="text" maxLength={ROLEPLAY_ROLE_MAX} value={custom.roles?.[0] ?? ""} placeholder="the keeper" onChange={(e) => setCustom({ roles: [e.target.value, custom.roles?.[1] ?? ""] })} />
            </label>
            <label>
              <span className="muted small">Second role</span>
              <input type="text" maxLength={ROLEPLAY_ROLE_MAX} value={custom.roles?.[1] ?? ""} placeholder="the apprentice" onChange={(e) => setCustom({ roles: [custom.roles?.[0] ?? "", e.target.value] })} />
            </label>
          </div>
          {yours !== null && (
            <p className="rp-keep">
              <button type="button" className="link-button" disabled={!choiceReady(value)} onClick={() => void keep()}>
                Keep it in your library
              </button>{" "}
              <span className="muted small">(your Create library: under ✨ Yours next time)</span>
            </p>
          )}
        </fieldset>
      )}
      {kept && (
        // Outside the form: once kept, the choice is the saved one and the form closes.
        <p className={kept.error ? "error small" : "muted small"} role="status">
          {kept.text}
        </p>
      )}

      {roles && value && (
        <fieldset className="rp-roles">
          <legend>Who plays whom?</legend>
          {([0, 1] as const).map((i) => (
            <label key={i} className="rp-role">
              <input type="radio" name={`${id}-role`} checked={myRole === i} onChange={() => onChange({ ...value, my_role: i })} />
              {asYou ? `You're ${roles[i]}, ${theirs} is ${roles[1 - i]}` : `${mine} is ${roles[i]}, ${theirs} ${roles[1 - i]}`}
            </label>
          ))}
        </fieldset>
      )}

      {asYou && signedIn && persona !== undefined && (
        // Who you are in scenes (lib/persona.ts): one quiet line, and the way to change it. Nothing more of it is here.
        <p className="muted small rp-persona" data-rp-persona>
          {persona ? (
            <>
              Playing as <strong>{persona.name}</strong> · <Link href="/account#persona">edit</Link>
            </>
          ) : (
            <Link href="/account#persona">Add who you are</Link>
          )}
        </p>
      )}

      {onOpening && (value || asYou) && (
        <fieldset className="rp-roles rp-opens">
          <legend>How it opens</legend>
          <p className="muted small rp-opens-about">Pick how it starts, or leave this and it opens its own way.</p>
          {openings.map((text, i) => (
            <label key={i} className="rp-role">
              <input type="radio" name={`${id}-opening`} checked={Boolean(opening && "pick" in opening && opening.pick === i)} onChange={() => onOpening({ pick: i as 0 | 1 | 2 })} />
              {text}
            </label>
          ))}
          {openings.length > 0 && (
            <label className="rp-role">
              <input type="radio" name={`${id}-opening`} checked={Boolean(opening && "surprise" in opening)} onChange={() => onOpening({ surprise: true })} />
              Surprise me
            </label>
          )}
          <label className="rp-role">
            <input type="radio" name={`${id}-opening`} checked={written !== null} onChange={() => onOpening({ written: written ?? "" })} />
            Write your own
          </label>
          {written !== null && (
            <div className="rp-opens-own">
              <label className="sr-only" htmlFor={`${id}-opening-own`}>
                Your opening, one sentence
              </label>
              <input
                id={`${id}-opening-own`}
                type="text"
                maxLength={CARD_OPENING_MAX}
                value={written}
                placeholder={asYou ? `I'm halfway through a crossword when ${theirs} sits down across from me.` : `${mine} is early and nervous; ${theirs} is late and pretending not to be.`}
                onChange={(e) => onOpening({ written: e.target.value })}
              />
              <span className="muted small">
                {written.length}/{CARD_OPENING_MAX} · one sentence, PG{asYou ? ", from where you stand" : ""}
              </span>
            </div>
          )}
          {opening && (
            <p className="rp-keep">
              <button type="button" className="link-button" onClick={() => onOpening(null)}>
                Let it open its own way
              </button>
            </p>
          )}
        </fieldset>
      )}
    </div>
  );
}
