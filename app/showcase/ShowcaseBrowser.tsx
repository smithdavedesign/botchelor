import Link from "next/link";
import type { Db } from "@/lib/db";
import { listShowcase, MEDIUM_LABEL, MEDIUMS, showcaseFacets, sideOf, type Filters, type ShowcaseViewer } from "@/lib/showcase";
import { actLabel, placeLabel, shapeLabel } from "@/lib/showcase-labels";
import ShowcaseGrid from "./ShowcaseGrid";

type Key = keyof Omit<Filters, "page">;

const FROM_LABEL: Record<string, string> = { date: "From dates", studio: "From the Studio" };

/**
 * The showcase's filters and grid (lib/showcase.ts), the same on /showcase and a creator's page. Every filter is a link
 * (each chip sets or clears one), so the page works and reads without scripts, and a filtered view can be shared.
 *
 * Laid out as: the side (safe for work, the default; After Dark, explicit, for whoever may see it), then how it's
 * sorted, then one row per thing to filter by (what it is, how it was made, pose, place, character, shape), each chip
 * with what it would find, then what's picked, each with its ×. A row shows only when it has more than one choice, or
 * one is picked.
 */
export default async function ShowcaseBrowser({ db, viewer, base, filters, fixed = {} }: { db: Db; viewer: ShowcaseViewer; base: string; filters: Filters; fixed?: Filters }) {
  const f = { ...filters, ...fixed };
  const [{ posts, more }, facets] = await Promise.all([listShowcase(db, viewer, f), showcaseFacets(db, viewer, { ...f, page: undefined })]);
  const href = (patch: Partial<Record<Key | "page", string | number | boolean | undefined>>, keep: Filters = filters) => {
    const q = new URLSearchParams();
    const next: Record<string, unknown> = { ...keep, page: undefined, ...patch };
    for (const [k, v] of Object.entries(next)) if (v !== undefined && v !== false && !(k in fixed)) q.set(k, v === true ? "1" : String(v));
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const chip = (key: Key, value: string | boolean, label: string, n?: number) => {
    const on = f[key] === value;
    return (
      <Link key={`${key}-${String(value)}`} href={href({ [key]: on ? undefined : value })} className={`chip showcase-chip${on ? " chip-on" : ""}`} aria-current={on ? "true" : undefined} scroll={false}>
        {label}
        {n !== undefined && <span className="showcase-count">{n}</span>}
      </Link>
    );
  };
  // A row of choices: shown when there's a choice to make, or one is picked.
  const row = (label: string, key: Key, items: [string, string, number][]) =>
    items.length > 1 || (f[key] !== undefined && items.length > 0) ? (
      <div className="showcase-row" role="group" aria-label={label}>
        <span className="showcase-row-label">{label}</span>
        {items.map(([k, name, n]) => chip(key, k, name, n))}
      </div>
    ) : null;
  const side = sideOf(f);
  const explicit = viewer.ratings.includes("nsfw");
  const mediumCount = new Map(facets.medium);
  const characterName = new Map(facets.character.map(([id, name]) => [id, name]));
  // What's picked, in words, each with its own ×; the side and the sort are the tabs above, not filters.
  const picked: [Key, string][] = [];
  if (filters.creator) picked.push(["creator", `@${filters.creator}`]);
  if (filters.character) picked.push(["character", characterName.get(filters.character) ?? "That character"]);
  if (filters.partner) picked.push(["partner", `With ${characterName.get(filters.partner) ?? "them"}`]);
  if (filters.medium) picked.push(["medium", MEDIUM_LABEL[filters.medium]]);
  if (filters.from) picked.push(["from", FROM_LABEL[filters.from]]);
  if (filters.pov) picked.push(["pov", "First person"]);
  if (filters.act) picked.push(["act", actLabel(filters.act)]);
  if (filters.place) picked.push(["place", placeLabel(filters.place)]);
  if (filters.shape) picked.push(["shape", shapeLabel(filters.shape)]);
  // Switching sides starts the other side afresh: its poses, places and people aren't this side's.
  const sideKeep: Filters = { sort: filters.sort, following: filters.following };
  return (
    <div className="showcase">
      <nav className="showcase-filters" aria-label="Filter the showcase">
        {explicit && (
          <div className="showcase-sides" role="group" aria-label="Which side">
            <Link href={href({ side: undefined }, sideKeep)} className={`showcase-side${side === "pg" ? " on" : ""}`} aria-current={side === "pg" ? "true" : undefined} scroll={false}>
              Safe for work <span className="showcase-count">{facets.sides.pg}</span>
            </Link>
            <Link href={href({ side: "after_dark" }, sideKeep)} className={`showcase-side${side === "after_dark" ? " on" : ""}`} aria-current={side === "after_dark" ? "true" : undefined} scroll={false}>
              🌙 After Dark <span className="showcase-count">{facets.sides.after_dark}</span>
            </Link>
          </div>
        )}
        <div className="showcase-row" role="group" aria-label="Sort">
          <span className="showcase-row-label">Show</span>
          <Link href={href({ sort: undefined, following: undefined })} className={`chip showcase-chip${!f.sort && !f.following ? " chip-on" : ""}`} aria-current={!f.sort && !f.following ? "true" : undefined} scroll={false}>
            Newest
          </Link>
          {chip("sort", "trending", "Trending this week")}
          {viewer.id && chip("following", true, "Following")}
        </div>
        {row(
          "Type",
          "medium",
          MEDIUMS.filter((m) => mediumCount.has(m)).map((m) => [m, MEDIUM_LABEL[m], mediumCount.get(m)!]),
        )}
        {(facets.from.length > 1 || facets.pov > 0 || f.from || f.pov) && (
          <div className="showcase-row" role="group" aria-label="Made">
            <span className="showcase-row-label">Made</span>
            {facets.from.length > 1 || f.from ? facets.from.map(([k, n]) => chip("from", k, FROM_LABEL[k] ?? k, n)) : null}
            {(facets.pov > 0 || f.pov) && chip("pov", true, "First person", facets.pov)}
          </div>
        )}
        {row("Pose", "act", facets.act.map(([k, n]) => [k, actLabel(k), n]))}
        {row("Place", "place", facets.place.map(([k, n]) => [k, placeLabel(k), n]))}
        {!fixed.character && row("Character", "character", facets.character)}
        {row("Shape", "shape", facets.shape.map(([k, n]) => [k, shapeLabel(k), n]))}
        {picked.length > 0 && (
          <p className="showcase-picked small">
            {picked.map(([k, label]) => (
              <Link key={k} href={href({ [k]: undefined })} className="showcase-picked-chip" scroll={false} aria-label={`Remove: ${label}`}>
                {label} <span aria-hidden="true">×</span>
              </Link>
            ))}
            <Link href={href({}, { side: filters.side, sort: filters.sort, following: filters.following })} scroll={false} className="showcase-clear">
              Clear the filters
            </Link>
          </p>
        )}
      </nav>
      {posts.length ? (
        <ShowcaseGrid posts={posts} admin={viewer.admin} />
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
