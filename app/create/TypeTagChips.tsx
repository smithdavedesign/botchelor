"use client";

import { autoTags, CHARACTER_TAGS_MAX } from "@/lib/character-tags-shared";
import { byDemand, tagsIn } from "@/lib/tags";
import { useTagDemand } from "@/app/useTagDemand";

/**
 * What kind of person they are (docs/tags.md): the type tags as chips, up to CHARACTER_TAGS_MAX. Untouched (`value`
 * null), the chips show what the show reads from the traits and bio as they're typed (autoTags), and nothing is sent:
 * the show keeps reading them. A press makes the pick the owner's; "Let the show pick" hands it back.
 */
export default function TypeTagChips({
  value,
  onChange,
  traits,
  bio,
}: {
  value: string[] | null;
  onChange: (v: string[] | null) => void;
  traits: readonly string[];
  bio: string;
}) {
  // Every type tag, most wanted first: who people talk to on Botchelor (lib/tag-demand.ts), the census until that's here.
  const TYPES = byDemand(tagsIn("type"), "sfw", useTagDemand()?.types);
  const suggested = autoTags({ traits: traits.filter((t) => t.trim()), bio });
  const on = value ?? suggested;
  const full = on.length >= CHARACTER_TAGS_MAX;
  const toggle = (id: string) => onChange(on.includes(id) ? on.filter((t) => t !== id) : full ? on : [...on, id]);
  return (
    <fieldset className="type-tags">
      <legend>
        What kind of person? <span className="muted">(up to {CHARACTER_TAGS_MAX}: how people find them)</span>
      </legend>
      <p className="muted small">
        {value === null
          ? suggested.length
            ? "Read from their traits for now. Press any to choose them yourself."
            : "The show reads these from their traits. Or choose them yourself."
          : "Your pick."}{" "}
        {value !== null && (
          <button type="button" className="linklike" onClick={() => onChange(null)}>
            Let the show pick
          </button>
        )}
      </p>
      <div className="rp-tags type-tags-chips" role="group" aria-label="Type">
        {TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`rp-tag${value === null && on.includes(t.id) ? " type-tag-auto" : ""}`}
            aria-pressed={on.includes(t.id)}
            disabled={!on.includes(t.id) && full}
            title={t.about}
            onClick={() => toggle(t.id)}
          >
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
