import Link from "next/link";
import type { Db } from "@/lib/db";
import { listShowcase, MEDIUM_LABEL, MEDIUMS, seenFilters, showcaseFacets, sideOf, type Filters, type ShowcaseViewer } from "@/lib/showcase";
import { actLabel, placeLabel, shapeLabel } from "@/lib/showcase-labels";
import FilterForm from "./FilterForm";
import ShowcaseGrid from "./ShowcaseGrid";

type Key = keyof Omit<Filters, "page">;

const FROM_LABEL: Record<string, string> = { date: "From dates", studio: "From the Studio" };

/**
 * The showcase's filters and grid (lib/showcase.ts), the same on /showcase and a creator's page. A filtered view is its
 * address, so it can be shared, and everything works without scripts.
 *
 * Laid out as (David, 2026-11-01: "too many buttons"): the side (safe for work, the default; After Dark, explicit, for
 * whoever may see it); one bar with how it's sorted and what type; one row of dropdowns for the rest (character, place,
 * pose, how it was made, shape), each with what it would find, shown only when there's a choice or one is picked; then
 * what's picked, each with its ×.
 */
export default async function ShowcaseBrowser({ db, viewer, base, filters: asked, fixed = {} }: { db: Db; viewer: ShowcaseViewer; base: string; filters: Filters; fixed?: Filters }) {
  const filters = seenFilters(viewer, asked);
  const f = { ...filters, ...fixed };
  const [{ posts, more }, facets] = await Promise.all([listShowcase(db, viewer, f), showcaseFacets(db, viewer, { ...f, page: undefined })]);
  const query = (patch: Partial<Record<Key | "page", string | number | boolean | undefined>>, keep: Filters = filters, skipFixed = true) => {
    const q = new URLSearchParams();
    const next: Record<string, unknown> = { ...keep, page: undefined, ...patch };
    for (const [k, v] of Object.entries(next)) if (v !== undefined && v !== false && !(skipFixed && k in fixed)) q.set(k, v === true ? "1" : String(v));
    return q.toString();
  };
  const href = (patch: Partial<Record<Key | "page", string | number | boolean | undefined>>, keep: Filters = filters) => {
    const s = query(patch, keep);
    return s ? `${base}?${s}` : base;
  };
  // One choice in a bar: on, or a link to it.
  const seg = (key: string, on: boolean, to: string, label: string, n?: number) => (
    <Link key={key} href={to} className={`showcase-side${on ? " on" : ""}`} aria-current={on ? "true" : undefined} scroll={false}>
      {label}
      {n !== undefined && <> <span className="showcase-count">{n}</span></>}
    </Link>
  );
  // A dropdown: shown when there's a choice to make, or one is picked.
  const select = (key: Key, any: string, items: [string, string, number][]) =>
    items.length > 1 || (f[key] !== undefined && items.length > 0) ? (
      <label key={key} className="showcase-select">
        <span className="sr-only">{any}</span>
        <select name={key} defaultValue={typeof f[key] === "string" ? (f[key] as string) : ""}>
          <option value="">{any}</option>
          {items.map(([k, name, n]) => (
            <option key={k} value={k}>
              {name} ({n})
            </option>
          ))}
        </select>
      </label>
    ) : null;
  const side = sideOf(f);
  const explicit = viewer.ratings.includes("nsfw");
  const mediumCount = new Map(facets.medium);
  const mediums = MEDIUMS.filter((m) => mediumCount.has(m));
  const characterName = new Map(facets.character.map(([id, name]) => [id, name]));
  // What's picked, in words, each with its own ×; the side, the sort and the type are the bars above, not filters.
  const picked: [Key, string][] = [];
  if (filters.creator) picked.push(["creator", `@${filters.creator}`]);
  if (filters.character) picked.push(["character", characterName.get(filters.character) ?? "That character"]);
  if (filters.partner) picked.push(["partner", `With ${characterName.get(filters.partner) ?? "them"}`]);
  if (filters.from) picked.push(["from", FROM_LABEL[filters.from]]);
  if (filters.pov) picked.push(["pov", "First person"]);
  if (filters.act) picked.push(["act", actLabel(filters.act)]);
  if (filters.place) picked.push(["place", placeLabel(filters.place)]);
  if (filters.shape) picked.push(["shape", shapeLabel(filters.shape)]);
  // Switching sides starts the other side afresh: its poses, places and people aren't this side's.
  const sideKeep: Filters = { sort: filters.sort, following: filters.following };
  // The dropdowns' form carries what's set by the bars and the page's own filters it doesn't show.
  const formKeys = new Set<string>(["character", "place", "act", "from", "pov", "shape"]);
  const keep = Object.entries(filters).flatMap(([k, v]): [string, string][] =>
    v === undefined || v === false || k === "page" || formKeys.has(k) || k in fixed ? [] : [[k, v === true ? "1" : String(v)]],
  );
  const selects = [
    !fixed.character && select("character", "Any character", facets.character),
    select("place", "Any place", facets.place.map(([k, n]) => [k, placeLabel(k), n])),
    select("act", "Any pose", facets.act.map(([k, n]) => [k, actLabel(k), n])),
    facets.from.length > 1 || f.from ? select("from", "Made any way", facets.from.map(([k, n]) => [k, FROM_LABEL[k] ?? k, n])) : null,
    select("shape", "Any shape", facets.shape.map(([k, n]) => [k, shapeLabel(k), n])),
  ].filter(Boolean);
  const pov = facets.pov > 0 || f.pov;
  return (
    <div className="showcase">
      <nav className="showcase-filters" aria-label="Filter the showcase">
        {explicit && (
          <div className="showcase-sides" role="group" aria-label="Which side">
            {seg("pg", side === "pg", href({ side: undefined }, sideKeep), "Safe for work", facets.sides.pg)}
            {seg("ad", side === "after_dark", href({ side: "after_dark" }, sideKeep), "🌙 After Dark", facets.sides.after_dark)}
          </div>
        )}
        <div className="showcase-bar">
          <div className="showcase-sides" role="group" aria-label="Sort">
            {seg("new", !f.sort && !f.following, href({ sort: undefined, following: undefined }), "Newest")}
            {seg("trending", f.sort === "trending" && !f.following, href({ sort: "trending", following: undefined }), "Trending")}
            {viewer.id && seg("following", Boolean(f.following), href({ following: true, sort: undefined }), "Following")}
          </div>
          {(mediums.length > 1 || f.medium) && (
            <div className="showcase-sides" role="group" aria-label="Type">
              {seg("all", !f.medium, href({ medium: undefined }), "All")}
              {mediums.map((m) => seg(m, f.medium === m, href({ medium: m }), MEDIUM_LABEL[m], mediumCount.get(m)))}
            </div>
          )}
        </div>
        {(selects.length > 0 || pov) && (
          <FilterForm key={query({})} action={base} keep={keep}>
            {selects}
            {pov && (
              <label className="showcase-check">
                <input type="checkbox" name="pov" value="1" defaultChecked={Boolean(f.pov)} /> First person <span className="showcase-count">{facets.pov}</span>
              </label>
            )}
          </FilterForm>
        )}
        {picked.length > 0 && (
          <p className="showcase-picked small">
            {picked.map(([k, label]) => (
              <Link key={k} href={href({ [k]: undefined })} className="showcase-picked-chip" scroll={false} aria-label={`Remove: ${label}`}>
                {label} <span aria-hidden="true">×</span>
              </Link>
            ))}
            <Link href={href({}, { side: filters.side, sort: filters.sort, following: filters.following, medium: filters.medium })} scroll={false} className="showcase-clear">
              Clear the filters
            </Link>
          </p>
        )}
      </nav>
      {posts.length ? (
        <ShowcaseGrid posts={posts} admin={viewer.admin} reels={query({}, f, false)} />
      ) : (
        <p className="muted showcase-empty">Nothing here yet{Object.keys(filters).some((k) => k !== "page" && filters[k as Key] !== undefined) ? " with those filters" : ""}. Creators publish from their Studio: 📣 on any picture or clip.</p>
      )}
      {more && (
        <p className="showcase-more">
          <Link href={href({ page: (f.page ?? 1) + 1 })} className="button">More</Link>
        </p>
      )}
    </div>
  );
}
