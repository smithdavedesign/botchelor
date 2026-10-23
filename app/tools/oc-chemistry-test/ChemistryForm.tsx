import { CHEMISTRY_RESULT_PATH, fieldParam, SHEET_LIMITS, SIDES, type ChemistryForm as Values, type Side } from "@/lib/chemistry-test";

const PLACEHOLDERS: Record<Side, { name: string; traits: [string, string, string]; want: string; dealbreaker: string }> = {
  a: { name: "Juniper", traits: ["curious", "warm", "dry-witted"], want: "Someone who gets lost on purpose", dealbreaker: "People who are always on their phone" },
  b: { name: "Dex", traits: ["restless", "funny", "loyal"], want: "Someone curious enough to keep up", dealbreaker: "Cynics" },
};

/**
 * The OC chemistry test's two characters, each with /create's fields and limits (lib/chemistry-test.ts SHEET_LIMITS).
 * A plain GET form to the result, so it works without JavaScript and every result is a link. Filled in again on a
 * result page.
 */
export default function ChemistryForm({ values = {}, submit = "Test their chemistry" }: { values?: Values; submit?: string }) {
  return (
    <form action={CHEMISTRY_RESULT_PATH} method="get" className="chem-form">
      {SIDES.map((side) => {
        const hint = PLACEHOLDERS[side];
        const input = (field: "name" | "want" | "dealbreaker", placeholder: string) => (
          <input
            type="text"
            name={fieldParam(side, field)}
            required
            maxLength={SHEET_LIMITS[field]}
            autoComplete="off"
            placeholder={placeholder}
            defaultValue={values[fieldParam(side, field)] ?? ""}
          />
        );
        return (
          <fieldset key={side} className="chem-side">
            <legend>{side === "a" ? "First character" : "Second character"}</legend>
            <label>
              Name
              {input("name", hint.name)}
            </label>
            <div className="chem-traits" role="group" aria-label={`${side === "a" ? "First" : "Second"} character's three traits`}>
              <span>Three traits</span>
              {([1, 2, 3] as const).map((i) => (
                <input
                  key={i}
                  type="text"
                  name={fieldParam(side, `trait${i}`)}
                  required
                  maxLength={SHEET_LIMITS[`trait${i}`]}
                  autoComplete="off"
                  aria-label={`Trait ${i}`}
                  placeholder={hint.traits[i - 1]}
                  defaultValue={values[fieldParam(side, `trait${i}`)] ?? ""}
                />
              ))}
            </div>
            <label>
              What they want from a date
              {input("want", hint.want)}
            </label>
            <label>
              Their dealbreaker
              {input("dealbreaker", hint.dealbreaker)}
            </label>
          </fieldset>
        );
      })}
      <button type="submit">{submit}</button>
    </form>
  );
}
