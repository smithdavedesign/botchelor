"use client";

import { useState, type ReactNode } from "react";
import {
  LOVE_LANGUAGES,
  MAX_HOBBIES,
  MAX_PROMPTS,
  PROFILE_MIN_INTERESTS,
  PROFILE_MIN_PROMPTS,
  PROFILE_PROMPTS,
  PROMPT_IDEAS,
  STAR_SIGNS,
  SUGGESTIONS,
  TEXT_DETAILS,
  suggest,
  type CharacterExtras,
  type PromptId,
  type TextDetail,
} from "@/lib/extras";
import { ARCHETYPES, DRAWN_TO_MAX, GOALS, KIND_LABEL_MAX, KINDS } from "@/lib/kinds";

export type SetExtras = (update: (prev: CharacterExtras) => CharacterExtras) => void;

const PLACEHOLDERS: Partial<Record<TextDetail, string>> = {
  occupation: "Lighthouse keeper",
  hometown: "a fishing village",
  style: "Thrifted cardigans and mismatched socks",
  signature_item: "a yellow raincoat",
  go_to_order: "Two desserts, no main",
  walk_on_music: "A kazoo cover of a sea shanty",
  quirk: "Names every houseplant after a retired detective",
  catchphrase: "“That's a problem for future me.”",
  hidden_talent: "Can fold a fitted sheet",
  pet_peeve: "Lukewarm tea",
  guilty_pleasure: "Reading the last page first",
  ideal_first_date: "A night market with too many snacks",
  green_flag: "Remembers small details",
  red_flag: "Owns a gong",
};

/** One free-text detail with its 🎲 (which draws a fresh idea into this field). */
export function DetailField({ k, extras, setExtras }: { k: TextDetail; extras: CharacterExtras; setExtras: SetExtras }) {
  const { label, max } = TEXT_DETAILS[k];
  const set = (v: string) => setExtras((p) => ({ ...p, [k]: v }));
  return (
    <label className="detail-field">
      {label}
      <span className="detail-row">
        <input type="text" name={`extra_${k}`} maxLength={max} placeholder={PLACEHOLDERS[k]} value={extras[k] ?? ""} onChange={(e) => set(e.target.value)} />
        {SUGGESTIONS[k] && (
          <button type="button" className="dice" aria-label={`Suggest a ${label.toLowerCase()}`} title="Suggest one" onClick={() => set(suggest(k))}>
            🎲
          </button>
        )}
      </span>
    </label>
  );
}

function Group({ title, filled, children, open = false }: { title: string; filled: number; children: ReactNode; open?: boolean }) {
  return (
    <details className="detail-group" open={open || filled > 0}>
      <summary>
        {title} {filled > 0 && <span className="badge">{filled}</span>}
      </summary>
      {children}
    </details>
  );
}

const filledOf = (e: CharacterExtras, keys: (keyof CharacterExtras)[]) =>
  keys.filter((k) => {
    const v = e[k];
    return Array.isArray(v) ? v.length > 0 : Boolean(typeof v === "string" ? v.trim() : v);
  }).length;

/** Fills every blank text detail (and empty hobbies, and enough prompts for a dating profile) with an idea; never touches what's already written. */
export function surpriseFill(e: CharacterExtras): CharacterExtras {
  const out: CharacterExtras = { ...e };
  for (const k of Object.keys(TEXT_DETAILS) as TextDetail[]) if (!out[k]?.trim() && SUGGESTIONS[k]) out[k] = suggest(k);
  if (!out.hobbies?.length) {
    const picks = new Set<string>();
    while (picks.size < 3) picks.add(suggest("hobbies"));
    out.hobbies = [...picks];
  }
  // The swipe deck needs two answered prompts: start any that are missing from the ideas (lib/extras.ts PROMPT_IDEAS).
  const answered = (out.prompts ?? []).filter((p) => p.answer.trim());
  const used = new Set(answered.map((p) => p.id));
  const ideas = (Object.keys(PROMPT_IDEAS) as PromptId[]).filter((id) => !used.has(id));
  while (answered.length < PROFILE_MIN_PROMPTS && ideas.length) {
    const id = ideas.splice(Math.floor(Math.random() * ideas.length), 1)[0];
    const options = PROMPT_IDEAS[id] ?? [];
    answered.push({ id, answer: options[Math.floor(Math.random() * options.length)] ?? "" });
  }
  out.prompts = answered;
  return out;
}

/**
 * The optional details step: the dating-profile layer (lib/extras.ts). Everything is skippable; the 🎲 buttons
 * draw ideas, and "Surprise me" fills only the blanks.
 */
export default function DetailsStep({ extras, setExtras, name }: { extras: CharacterExtras; setExtras: SetExtras; name: string }) {
  const [hobbyDraft, setHobbyDraft] = useState("");
  const hobbies = extras.hobbies ?? [];
  const prompts = extras.prompts ?? [];
  const usedPrompts = new Set(prompts.map((p) => p.id));
  const answeredPrompts = prompts.filter((p) => p.answer.trim()).length;

  function addHobby(h: string) {
    const v = h.trim().slice(0, 30);
    if (!v || hobbies.length >= MAX_HOBBIES || hobbies.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    setExtras((p) => ({ ...p, hobbies: [...(p.hobbies ?? []), v] }));
    setHobbyDraft("");
  }
  const removeHobby = (h: string) => setExtras((p) => ({ ...p, hobbies: (p.hobbies ?? []).filter((x) => x !== h) }));
  const setPrompt = (i: number, patch: Partial<{ id: PromptId; answer: string }>) =>
    setExtras((p) => ({ ...p, prompts: (p.prompts ?? []).map((q, j) => (j === i ? { ...q, ...patch } : q)) }));
  const addPrompt = () => {
    const next = PROFILE_PROMPTS.find((p) => !usedPrompts.has(p.id));
    if (next && prompts.length < MAX_PROMPTS) setExtras((p) => ({ ...p, prompts: [...(p.prompts ?? []), { id: next.id, answer: "" }] }));
  };
  const removePrompt = (i: number) => setExtras((p) => ({ ...p, prompts: (p.prompts ?? []).filter((_, j) => j !== i) }));

  return (
    <fieldset className="wizard-fields">
      <legend className="wizard-legend">Their dating profile</legend>
      <p className="muted">
        This is what the swipe deck shows, like any dating app. {name || "They"} need{name ? "s" : ""} {PROFILE_MIN_PROMPTS} answered prompts and{" "}
        {PROFILE_MIN_INTERESTS} interests; everything else is optional. It all shows on their card and shapes how they talk — never how a date ends.
      </p>
      <p className="small profile-progress" role="status">
        {answeredPrompts >= PROFILE_MIN_PROMPTS && hobbies.length >= PROFILE_MIN_INTERESTS ? (
          "✓ Ready for the swipe deck"
        ) : (
          <>
            For the swipe deck: <strong>{Math.min(answeredPrompts, PROFILE_MIN_PROMPTS)}/{PROFILE_MIN_PROMPTS}</strong> prompts answered ·{" "}
            <strong>{Math.min(hobbies.length, PROFILE_MIN_INTERESTS)}/{PROFILE_MIN_INTERESTS}</strong> interests
          </>
        )}
      </p>
      <p>
        <button type="button" className="secondary small" onClick={() => setExtras(surpriseFill)}>
          🎲 Surprise me — fill the blanks
        </button>
      </p>

      <Group title="Who they are" filled={filledOf(extras, ["kind", "archetype", "here_for", "drawn_to"])} open>
        <div className="detail-pair">
          <label>
            What they are
            <select
              name="extra_kind"
              value={extras.kind ?? ""}
              onChange={(e) => setExtras((p) => ({ ...p, kind: (e.target.value || undefined) as CharacterExtras["kind"], ...(e.target.value === "other" ? {} : { kind_label: undefined }) }))}
            >
              <option value="">—</option>
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.emoji} {k.label}
                </option>
              ))}
            </select>
          </label>
          {extras.kind === "other" && (
            <label>
              Which is…
              <input
                type="text"
                name="extra_kind_label"
                maxLength={KIND_LABEL_MAX}
                placeholder="A lighthouse spirit"
                value={extras.kind_label ?? ""}
                onChange={(e) => setExtras((p) => ({ ...p, kind_label: e.target.value }))}
              />
            </label>
          )}
        </div>
        <div className="detail-pair">
          <label>
            The type they play
            <select
              name="extra_archetype"
              value={extras.archetype ?? ""}
              onChange={(e) => setExtras((p) => ({ ...p, archetype: (e.target.value || undefined) as CharacterExtras["archetype"] }))}
            >
              <option value="">—</option>
              {ARCHETYPES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Here for
            <select
              name="extra_here_for"
              value={extras.here_for ?? ""}
              onChange={(e) => setExtras((p) => ({ ...p, here_for: (e.target.value || undefined) as CharacterExtras["here_for"] }))}
            >
              <option value="">—</option>
              {GOALS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="drawn-to">
          <legend>
            Drawn to <span className="muted">(up to {DRAWN_TO_MAX}; they show up a little earlier in the swipe deck, nobody&apos;s hidden)</span>
          </legend>
          <ul className="chips">
            {KINDS.filter((k) => k.id !== "other").map((k) => {
              const on = (extras.drawn_to ?? []).includes(k.id as never);
              const full = (extras.drawn_to ?? []).length >= DRAWN_TO_MAX;
              return (
                <li key={k.id}>
                  <button
                    type="button"
                    className={on ? "chip chip-on" : "chip"}
                    aria-pressed={on}
                    disabled={!on && full}
                    onClick={() =>
                      setExtras((p) => {
                        const cur = p.drawn_to ?? [];
                        const next = on ? cur.filter((x) => x !== k.id) : [...cur, k.id as (typeof cur)[number]];
                        return { ...p, drawn_to: next.length ? next : undefined };
                      })
                    }
                  >
                    {k.emoji} {k.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>
      </Group>

      <Group title="The basics" filled={filledOf(extras, ["occupation", "hometown", "star_sign", "love_language"])} open>
        <DetailField k="occupation" extras={extras} setExtras={setExtras} />
        <DetailField k="hometown" extras={extras} setExtras={setExtras} />
        <div className="detail-pair">
          <label>
            Star sign
            <select name="extra_star_sign" value={extras.star_sign ?? ""} onChange={(e) => setExtras((p) => ({ ...p, star_sign: (e.target.value || undefined) as CharacterExtras["star_sign"] }))}>
              <option value="">—</option>
              {STAR_SIGNS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Love language
            <select
              name="extra_love_language"
              value={extras.love_language ?? ""}
              onChange={(e) => setExtras((p) => ({ ...p, love_language: (e.target.value || undefined) as CharacterExtras["love_language"] }))}
            >
              <option value="">—</option>
              {LOVE_LANGUAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Group>

      <Group title="Interests & loves" filled={filledOf(extras, ["hobbies", "go_to_order", "walk_on_music"])} open>
        <label htmlFor="hobby-input">
          Interests <span className="muted">(at least {PROFILE_MIN_INTERESTS}, up to {MAX_HOBBIES})</span>
        </label>
        {hobbies.length > 0 && (
          <ul className="chips">
            {hobbies.map((h) => (
              <li key={h} className="chip chip-removable">
                {h}
                <button type="button" aria-label={`Remove ${h}`} onClick={() => removeHobby(h)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {hobbies.length < MAX_HOBBIES && (
          <span className="detail-row">
            <input
              id="hobby-input"
              type="text"
              maxLength={30}
              placeholder="Type one and press Enter"
              value={hobbyDraft}
              onChange={(e) => setHobbyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addHobby(hobbyDraft);
                }
              }}
            />
            <button type="button" className="secondary small" onClick={() => addHobby(hobbyDraft)}>
              Add
            </button>
          </span>
        )}
        <div className="voice-picks" role="group" aria-label="Hobby ideas">
          {(SUGGESTIONS.hobbies ?? [])
            .filter((h) => !hobbies.includes(h))
            .slice(0, 8)
            .map((h) => (
              <button key={h} type="button" className="look-chip" disabled={hobbies.length >= MAX_HOBBIES} onClick={() => addHobby(h)}>
                + {h}
              </button>
            ))}
        </div>
        <DetailField k="go_to_order" extras={extras} setExtras={setExtras} />
        <DetailField k="walk_on_music" extras={extras} setExtras={setExtras} />
      </Group>

      <Group title="Quirks" filled={filledOf(extras, ["quirk", "catchphrase", "hidden_talent", "pet_peeve", "guilty_pleasure"])}>
        <DetailField k="quirk" extras={extras} setExtras={setExtras} />
        <DetailField k="catchphrase" extras={extras} setExtras={setExtras} />
        <DetailField k="hidden_talent" extras={extras} setExtras={setExtras} />
        <DetailField k="pet_peeve" extras={extras} setExtras={setExtras} />
        <DetailField k="guilty_pleasure" extras={extras} setExtras={setExtras} />
      </Group>

      <Group title="On a date" filled={filledOf(extras, ["ideal_first_date", "green_flag", "red_flag"])}>
        <DetailField k="ideal_first_date" extras={extras} setExtras={setExtras} />
        <DetailField k="green_flag" extras={extras} setExtras={setExtras} />
        <DetailField k="red_flag" extras={extras} setExtras={setExtras} />
      </Group>

      <Group title="Profile prompts" filled={prompts.length} open>
        <p className="muted small">
          Answer at least {PROFILE_MIN_PROMPTS} (up to {MAX_PROMPTS}) in their voice: they&apos;re the heart of their card in the swipe deck.
        </p>
        {prompts.map((p, i) => (
          <div key={i} className="prompt-edit">
            <label>
              Prompt
              <select value={p.id} onChange={(e) => setPrompt(i, { id: e.target.value as PromptId })}>
                {PROFILE_PROMPTS.filter((o) => o.id === p.id || !usedPrompts.has(o.id)).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Their answer
              <textarea name={`extra_prompt_${i}`} maxLength={160} rows={2} value={p.answer} onChange={(e) => setPrompt(i, { answer: e.target.value })} />
            </label>
            <button type="button" className="link-button danger" onClick={() => removePrompt(i)}>
              Remove this prompt
            </button>
          </div>
        ))}
        {prompts.length < MAX_PROMPTS && (
          <button type="button" className="secondary small" onClick={addPrompt}>
            + Add a prompt
          </button>
        )}
      </Group>
    </fieldset>
  );
}
