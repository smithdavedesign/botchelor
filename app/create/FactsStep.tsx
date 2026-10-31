"use client";

import { FACT_IDEAS, FACT_LABEL_MAX, FACT_VALUE_MAX, MAX_FACTS, type CharacterExtras, type CharacterFact } from "@/lib/extras";
import type { SetExtras } from "./DetailsStep";

/**
 * "More about them": up to MAX_FACTS facts of the creator's own, each a label and a value, public (on the card) or
 * private (only the character itself, on its dates). A date brings out a few per act (lib/extras.ts factsForAct),
 * so a long list never turns into a recited one.
 */
export default function FactsStep({ extras, setExtras, name }: { extras: CharacterExtras; setExtras: SetExtras; name: string }) {
  const facts = extras.facts ?? [];
  const who = name.trim().split(/\s+/)[0] || "them";
  const set = (next: CharacterFact[]) => setExtras((p) => ({ ...p, facts: next }));
  const update = (i: number, patch: Partial<CharacterFact>) =>
    set(
      facts.map((f, j) => {
        if (j !== i) return f;
        const merged = { ...f, ...patch };
        if (!merged.private) delete merged.private;
        return merged;
      }),
    );
  // A secret is private by nature (the audit, 2026-10-31: "+ A secret" left 🔒 unchecked, so it went on the card).
  const add = (label = "") => facts.length < MAX_FACTS && set([...facts, { label, value: "", private: label === "A secret" || undefined }]);
  const remove = (i: number) => set(facts.filter((_, j) => j !== i));
  const used = new Set(facts.map((f) => f.label.trim().toLowerCase()));

  return (
    <fieldset className="wizard-fields">
      <legend className="wizard-legend">More about {who} (optional)</legend>
      <p className="muted">
        Anything else that makes {who} who they are: a fear, a secret, what they collect, what they&apos;d never do. Up to {MAX_FACTS}. Each
        date brings out a few, so different dates show different sides of them. Facts shape how a date goes, never how it ends.
      </p>
      <p className="muted small">
        <strong>Public</strong> facts go on the card. <strong>🔒 Private</strong> ones only {who} knows: they shape the character on dates
        and are never shown or said outright.
      </p>

      <div className="chips" role="group" aria-label="Fact ideas">
        {FACT_IDEAS.filter((idea) => !used.has(idea.toLowerCase())).slice(0, 10).map((idea) => (
          <button key={idea} type="button" className="look-chip" disabled={facts.length >= MAX_FACTS} onClick={() => add(idea)}>
            + {idea}
          </button>
        ))}
      </div>

      <ul className="fact-list">
        {facts.map((f, i) => (
          <li key={i} className="fact-row">
            <label className="detail-field">
              <span className="sr-only">Fact {i + 1} label</span>
              <input
                type="text"
                name={`fact_label_${i}`}
                maxLength={FACT_LABEL_MAX}
                placeholder="Allergic to"
                value={f.label}
                onChange={(e) => update(i, { label: e.target.value })}
              />
            </label>
            <label className="detail-field">
              <span className="sr-only">Fact {i + 1} value</span>
              <input
                type="text"
                name={`fact_value_${i}`}
                maxLength={FACT_VALUE_MAX}
                placeholder="coriander, which they'll deny"
                value={f.value}
                onChange={(e) => update(i, { value: e.target.value })}
              />
            </label>
            <label className="fact-private">
              <input type="checkbox" name={`fact_private_${i}`} checked={Boolean(f.private)} onChange={(e) => update(i, { private: e.target.checked || undefined })} />
              🔒 Private
            </label>
            <button type="button" className="link-button danger" aria-label={`Remove fact ${i + 1}`} onClick={() => remove(i)}>
              Remove
            </button>
          </li>
        ))}
      </ul>

      <p>
        <button type="button" className="secondary small" disabled={facts.length >= MAX_FACTS} onClick={() => add()}>
          + Add a fact
        </button>{" "}
        <span className="muted small" role="status">
          {facts.length} of {MAX_FACTS}
        </span>
      </p>
    </fieldset>
  );
}
