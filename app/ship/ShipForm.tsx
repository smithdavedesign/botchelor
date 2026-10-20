import { SHIP_NAME_MAX } from "@/lib/ship-names";

/**
 * The ship name generator's two names. A plain GET form to /ship (app/ship/route.ts), which redirects to the
 * result's own address, so it works without JavaScript and every result is a link. Prefilled on a result page.
 */
export default function ShipForm({ a = "", b = "", submit = "Make ship names" }: { a?: string; b?: string; submit?: string }) {
  return (
    <form action="/ship" method="get" className="ship-form">
      <label>
        First name
        <input type="text" name="a" required maxLength={SHIP_NAME_MAX} autoComplete="off" spellCheck={false} placeholder="Juniper" defaultValue={a} />
      </label>
      <span className="ship-x" aria-hidden="true">
        ×
      </span>
      <label>
        Second name
        <input type="text" name="b" required maxLength={SHIP_NAME_MAX} autoComplete="off" spellCheck={false} placeholder="Dex" defaultValue={b} />
      </label>
      <button type="submit">{submit}</button>
    </form>
  );
}
