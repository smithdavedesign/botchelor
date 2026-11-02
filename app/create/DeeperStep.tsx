"use client";

import {
  BAGGAGE_IDEAS,
  BAGGAGE_MAX,
  HIDING_CHARS,
  HIDING_IDEAS,
  HOT_TAKE_CHARS,
  HOT_TAKE_IDEAS,
  MAX_HIDING,
  MAX_HOT_TAKES,
  MOODS,
  WINS_THEM_OVER_IDEAS,
  WINS_THEM_OVER_MAX,
  type CharacterExtras,
} from "@/lib/extras";
import type { SetExtras } from "./DetailsStep";

/**
 * "Go deeper" (optional, David 2026-11-01): what makes a date with them more than small talk. Each one is used on their
 * dates, and the step says how:
 *   - hot takes (extras.hot_takes, public): opinions they argue for; two that collide become the night's friction.
 *   - what they're hiding (their own secrets, lib/cast-secrets.ts, private): carried onto each date to guard or hint at;
 *     one a date draws out of them slips, and shows as out on their page once that date airs.
 *   - their last relationship and what really wins them over (extras.baggage / wins_them_over, private): how fast they
 *     open up, and what lands on them when the other does it.
 *   - fun or serious (extras.mood, on the card): how they play a date; a mismatch is planned in.
 * Every list grows from blank rows or the idea chips, which only ever fill a blank. Nothing here is needed to save.
 */
export default function DeeperStep({
  extras,
  setExtras,
  hiding,
  setHiding,
  name,
}: {
  extras: CharacterExtras;
  setExtras: SetExtras;
  hiding: string[];
  setHiding: (next: string[]) => void;
  name: string;
}) {
  const who = name.trim().split(/\s+/)[0] || "them";
  const takes = extras.hot_takes ?? [];
  const setTakes = (next: string[]) => setExtras((p) => ({ ...p, hot_takes: next.length ? next : undefined }));
  const setText = (k: "baggage" | "wins_them_over", v: string) => setExtras((p) => ({ ...p, [k]: v || undefined }));

  return (
    <fieldset className="wizard-fields deeper">
      <legend className="wizard-legend">Go deeper (optional)</legend>
      <p className="muted">
        What makes a date with {who} more than small talk. Every answer is used on their dates; skip any of it.
      </p>

      <ListField
        title="🔥 Hot takes"
        hint={`Opinions ${who} really holds. On a date they argue for them, and when one collides with the other person's, the night has a fight worth watching. On their card.`}
        items={takes}
        set={setTakes}
        max={MAX_HOT_TAKES}
        maxLength={HOT_TAKE_CHARS}
        ideas={HOT_TAKE_IDEAS}
        placeholder="e.g. Brunch is just a late breakfast with a markup."
        field="hot_take"
        noun="hot take"
      />

      <ListField
        title="🤫 What they're hiding"
        hint={`🔒 Only ${who} knows. They guard these on every date, hint and dodge; when a date really draws one out, it slips, and shows on their page once that date airs.`}
        items={hiding}
        set={setHiding}
        max={MAX_HIDING}
        maxLength={HIDING_CHARS}
        ideas={HIDING_IDEAS}
        placeholder="e.g. Still sleeps with a night light on"
        field="hiding"
        noun="secret"
      />

      <TextField
        title="💔 Their last relationship"
        hint={`🔒 Only ${who} knows. It shapes how fast they open up and what makes them flinch, and comes out only if a date earns it.`}
        value={extras.baggage ?? ""}
        set={(v) => setText("baggage", v)}
        maxLength={BAGGAGE_MAX}
        ideas={BAGGAGE_IDEAS}
        field="baggage"
        placeholder="e.g. Engaged once, for eleven days."
      />

      <TextField
        title="💘 What really wins them over"
        hint={`🔒 Only ${who} knows. They never ask for it; when the other person does it, it lands, and it counts when ${who} decides about a second date.`}
        value={extras.wins_them_over ?? ""}
        set={(v) => setText("wins_them_over", v)}
        maxLength={WINS_THEM_OVER_MAX}
        ideas={WINS_THEM_OVER_IDEAS}
        field="wins_them_over"
        placeholder="e.g. Someone who's kind to the waiter."
      />

      <fieldset className="deeper-group drawn-to">
        <legend>🎲 Here for fun, or taking it seriously?</legend>
        <p className="muted small">How {who} plays a date. When the other person plays it the other way, the date makes something of it. On their card.</p>
        <ul className="chips">
          {MOODS.map((m) => {
            const on = extras.mood === m.id;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  name={`mood_${m.id}`}
                  className={on ? "chip chip-on" : "chip"}
                  aria-pressed={on}
                  onClick={() => setExtras((p) => ({ ...p, mood: on ? undefined : m.id }))}
                >
                  {m.label}
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </fieldset>
  );
}

/** A short list (hot takes, secrets): a row each, idea chips that fill the first blank (or add one), up to `max`. */
function ListField({
  title,
  hint,
  items,
  set,
  max,
  maxLength,
  ideas,
  placeholder,
  field,
  noun,
}: {
  title: string;
  hint: string;
  items: string[];
  set: (next: string[]) => void;
  max: number;
  maxLength: number;
  ideas: readonly string[];
  placeholder: string;
  field: string;
  noun: string;
}) {
  const used = new Set(items.map((t) => t.trim().toLowerCase()));
  const blank = items.findIndex((t) => !t.trim());
  const full = blank < 0 && items.length >= max;
  const addIdea = (idea: string) => {
    if (blank >= 0) set(items.map((t, i) => (i === blank ? idea : t)));
    else if (items.length < max) set([...items, idea]);
  };
  return (
    <fieldset className="deeper-group">
      <legend>{title}</legend>
      <p className="muted small">{hint}</p>
      <div className="chips" role="group" aria-label={`${title.replace(/^\S+\s/, "")} ideas`}>
        {ideas
          .filter((idea) => !used.has(idea.toLowerCase()))
          .slice(0, 4)
          .map((idea) => (
            <button key={idea} type="button" className="look-chip" disabled={full} onClick={() => addIdea(idea)}>
              + {idea}
            </button>
          ))}
      </div>
      <ul className="fact-list">
        {items.map((t, i) => (
          <li key={i} className="fact-row deeper-row">
            <label className="detail-field">
              <span className="sr-only">
                {noun} {i + 1}
              </span>
              <input type="text" name={`${field}_${i}`} maxLength={maxLength} placeholder={placeholder} value={t} onChange={(e) => set(items.map((x, j) => (j === i ? e.target.value : x)))} />
            </label>
            <button type="button" className="link-button danger" aria-label={`Remove ${noun} ${i + 1}`} onClick={() => set(items.filter((_, j) => j !== i))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <p>
        <button type="button" className="secondary small" disabled={items.length >= max} onClick={() => set([...items, ""])}>
          + Add a {noun}
        </button>{" "}
        <span className="muted small" role="status">
          {items.filter((t) => t.trim()).length} of {max}
        </span>
      </p>
    </fieldset>
  );
}

/** One private line with its idea chips (shown only while it's blank). */
function TextField({
  title,
  hint,
  value,
  set,
  maxLength,
  ideas,
  field,
  placeholder,
}: {
  title: string;
  hint: string;
  value: string;
  set: (v: string) => void;
  maxLength: number;
  ideas: readonly string[];
  field: string;
  placeholder: string;
}) {
  return (
    <fieldset className="deeper-group">
      <legend>{title}</legend>
      <p className="muted small">{hint}</p>
      {!value.trim() && (
        <div className="chips" role="group" aria-label={`${title.replace(/^\S+\s/, "")} ideas`}>
          {ideas.slice(0, 3).map((idea) => (
            <button key={idea} type="button" className="look-chip" onClick={() => set(idea)}>
              + {idea}
            </button>
          ))}
        </div>
      )}
      <label className="detail-field">
        <span className="sr-only">{title.replace(/^\S+\s/, "")}</span>
        <textarea name={field} rows={2} maxLength={maxLength} placeholder={placeholder} value={value} onChange={(e) => set(e.target.value)} />
      </label>
    </fieldset>
  );
}
