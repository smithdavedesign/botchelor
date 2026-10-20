import { CHEMISTRY_RESULT_PATH, fieldLimit, fieldOf, param, SAMPLE_PAIR, SIDES, type Side, type SheetField } from "@/lib/chemistry-test";

const SIDE_LEGEND: Record<Side, string> = { a: "First character", b: "Second character" };
const TRAITS = ["trait1", "trait2", "trait3"] as const satisfies readonly SheetField[];
/** The worked example's words as placeholders: what kind of thing goes in each box. */
const placeholder = (side: Side, field: SheetField) => fieldOf(SAMPLE_PAIR[side === "a" ? 0 : 1], field);

/** One text input of the form: /create's limit, required, and the value to put back (a result, or a refusal's keep). */
function Field({ side, field, values }: { side: Side; field: SheetField; values: Record<string, string> }) {
  return (
    <input
      type="text"
      name={param(side, field)}
      required
      maxLength={fieldLimit(field)}
      autoComplete="off"
      placeholder={placeholder(side, field)}
      defaultValue={values[param(side, field)] ?? ""}
    />
  );
}

/**
 * The OC chemistry test's two sheets: the fields /create asks for, with its limits (lib/chemistry-test.ts). A plain GET
 * to the result page, so it works without JavaScript and every result is a link. Prefilled on a result page.
 */
export default function ChemistryForm({ values = {}, submit = "Test their chemistry" }: { values?: Record<string, string>; submit?: string }) {
  return (
    <form action={CHEMISTRY_RESULT_PATH} method="get" className="chem-form">
      <div className="chem-sides">
        {SIDES.map((side) => (
          <fieldset key={side} className="chem-side">
            <legend>{SIDE_LEGEND[side]}</legend>
            <label>
              Name
              <Field side={side} field="name" values={values} />
            </label>
            <p className="chem-label" aria-hidden="true">
              Three traits
            </p>
            <div className="traits">
              {TRAITS.map((field, i) => (
                <label key={field} className="chem-trait">
                  <span className="sr-only">{`Trait ${i + 1}`}</span>
                  <Field side={side} field={field} values={values} />
                </label>
              ))}
            </div>
            <label>
              What they want from a date
              <Field side={side} field="want" values={values} />
            </label>
            <label>
              Their dealbreaker
              <Field side={side} field="dealbreaker" values={values} />
            </label>
          </fieldset>
        ))}
      </div>
      <button type="submit">{submit}</button>
    </form>
  );
}
