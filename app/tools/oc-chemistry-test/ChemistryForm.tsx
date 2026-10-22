import { CHEMISTRY_RESULT_PATH, SHEET_LIMITS, SIDE_LABELS, SIDES, type FieldKey, type FieldValues, type Side } from "@/lib/chemistry";

/** Sample sheets as placeholders, so an empty form shows what goes where. */
const PLACEHOLDERS: Record<Side, FieldValues> = {
  a: { name: "Mira Quell", age: "29", trait1: "curious", trait2: "stubborn", trait3: "witty", want: "Someone who gets lost on purpose", dealbreaker: "People glued to their phone" },
  b: { name: "Otto Brand", age: "34", trait1: "bold", trait2: "warm", trait3: "funny", want: "A curious mind", dealbreaker: "Arrogance" },
};

function CharacterFields({ side, values }: { side: Side; values: Partial<FieldValues> }) {
  const name = (f: FieldKey) => `${side}_${f}`;
  const value = (f: FieldKey) => values[f] ?? "";
  const ph = PLACEHOLDERS[side];
  return (
    <fieldset className="chem-side">
      <legend>{SIDE_LABELS[side]}</legend>
      <label>
        Name
        <input type="text" name={name("name")} required maxLength={SHEET_LIMITS.name} autoComplete="off" placeholder={ph.name} defaultValue={value("name")} />
      </label>
      <label>
        Age <span className="muted">(18 or older, optional)</span>
        <input type="number" name={name("age")} min={SHEET_LIMITS.minAge} max={SHEET_LIMITS.maxAge} step={1} inputMode="numeric" placeholder={ph.age} defaultValue={value("age")} />
      </label>
      <fieldset className="chem-traits">
        <legend>Three traits</legend>
        <div className="traits">
          {(["trait1", "trait2", "trait3"] as const).map((f, i) => (
            <input key={f} type="text" name={name(f)} required maxLength={SHEET_LIMITS.trait} autoComplete="off" aria-label={`${SIDE_LABELS[side]}, trait ${i + 1}`} placeholder={ph[f]} defaultValue={value(f)} />
          ))}
        </div>
      </fieldset>
      <label>
        What they want from a date
        <input type="text" name={name("want")} required maxLength={SHEET_LIMITS.want} autoComplete="off" placeholder={ph.want} defaultValue={value("want")} />
      </label>
      <label>
        Their dealbreaker
        <input type="text" name={name("dealbreaker")} required maxLength={SHEET_LIMITS.dealbreaker} autoComplete="off" placeholder={ph.dealbreaker} defaultValue={value("dealbreaker")} />
      </label>
    </fieldset>
  );
}

/**
 * The chemistry test's two character sheets: the same fields and limits as /create's (lib/chemistry.ts SHEET_LIMITS).
 * A plain GET form to the result page, so it works without JavaScript and every result is a link. Prefilled on a
 * result page, or after a sheet was refused.
 */
export default function ChemistryForm({ values, submit = "Test their chemistry" }: { values?: Partial<Record<Side, Partial<FieldValues>>>; submit?: string }) {
  return (
    <form action={CHEMISTRY_RESULT_PATH} method="get" className="chem-form">
      <div className="chem-sides">
        {SIDES.map((side) => (
          <CharacterFields key={side} side={side} values={values?.[side] ?? {}} />
        ))}
      </div>
      <button type="submit">{submit}</button>
    </form>
  );
}
