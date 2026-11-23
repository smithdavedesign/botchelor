import { CHEMISTRY_RESULT_PATH, SHEET_LIMITS } from "@/lib/chemistry-test";

/**
 * The ship compatibility test's quick form: two names and nothing else, the love-calculator way in (lib/true-love.ts
 * reads them). A plain GET form to the result, like the full one (ChemistryForm), so it works without JavaScript and
 * every result is a link. Laid out as the ship name generator's two names are (globals.css .ship-form).
 */
export default function NamesForm({ a = "", b = "", submit = "Test them", secondary = false }: { a?: string; b?: string; submit?: string; secondary?: boolean }) {
  return (
    <form action={CHEMISTRY_RESULT_PATH} method="get" className="ship-form chem-names">
      <label>
        First name
        <input type="text" name="a_name" required maxLength={SHEET_LIMITS.name} autoComplete="off" spellCheck={false} placeholder="e.g. Juniper" defaultValue={a} />
      </label>
      <span className="ship-x" aria-hidden="true">
        ×
      </span>
      <label>
        Second name
        <input type="text" name="b_name" required maxLength={SHEET_LIMITS.name} autoComplete="off" spellCheck={false} placeholder="e.g. Dex" defaultValue={b} />
      </label>
      <button type="submit" className={secondary ? "secondary" : undefined}>
        {submit}
      </button>
    </form>
  );
}
