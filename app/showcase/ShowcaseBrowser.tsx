import Link from "next/link";
import type { Db } from "@/lib/db";
import { listShowcase, MEDIUM_LABEL, MEDIUMS, showcaseFacets, type Filters, type ShowcaseViewer } from "@/lib/showcase";
import { actLabel, placeLabel, shapeLabel } from "@/lib/showcase-labels";
import ShowcaseGrid from "./ShowcaseGrid";

type Key = keyof Omit<Filters, "page">;

/**
 * The showcase's filters and grid (lib/showcase.ts), the same on /showcase and a creator's page. Every filter is a link
 * (each chip sets or clears one), so the page works and reads without scripts, and a filtered view can be shared.
 */
export default async function ShowcaseBrowser({ db, viewer, base, filters, fixed = {} }: { db: Db; viewer: ShowcaseViewer; base: string; filters: Filters; fixed?: Filters }) {
  const f = { ...filters, ...fixed };
  const [{ posts, more }, facets] = await Promise.all([listShowcase(db, viewer, f), showcaseFacets(db, viewer, { ...f, page: undefined })]);
  const href = (patch: Partial<Record<Key | "page", string | number | boolean | undefined>>) => {
    const q = new URLSearchParams();
    const next: Record<string, unknown> = { ...filters, page: undefined, ...patch };
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
  const mediumCount = new Map(facets.medium);
  const explicit = viewer.ratings.includes("nsfw");
  return (
    <div className="showcase">
      <nav className="showcase-filters" aria-label="Filter the showcase">
        <div className="showcase-row" role="group" aria-label="What it is">
          {MEDIUMS.filter((m) => mediumCount.has(m) || f.medium === m).map((m) => chip("medium", m, MEDIUM_LABEL[m], mediumCount.get(m)))}
          {chip("pov", true, "First person")}
          {chip("from", "date", "From dates")}
          {chip("from", "studio", "From the Studio")}
          {viewer.id && chip("following", true, "Following")}
          {chip("sort", "trending", "Trending this week")}
          {explicit && chip("side", "after_dark", "After Dark")}
          {explicit && chip("side", "pg", "Safe for work")}
        </div>
        {facets.act.length > 0 && (
          <div className="showcase-row" role="group" aria-label="Pose">
            <span className="showcase-row-label">Pose</span>
            {facets.act.map(([k, n]) => chip("act", k, actLabel(k), n))}
          </div>
        )}
        {facets.place.length > 0 && (
          <div className="showcase-row" role="group" aria-label="Place">
            <span className="showcase-row-label">Place</span>
            {facets.place.map(([k, n]) => chip("place", k, placeLabel(k), n))}
          </div>
        )}
        {!fixed.character && facets.character.length > 0 && (
          <div className="showcase-row" role="group" aria-label="Character">
            <span className="showcase-row-label">Character</span>
            {facets.character.map(([id, name, n]) => chip("character", id, name, n))}
          </div>
        )}
        {facets.shape.length > 1 && (
          <div className="showcase-row" role="group" aria-label="Shape">
            <span className="showcase-row-label">Shape</span>
            {facets.shape.map(([k, n]) => chip("shape", k, shapeLabel(k), n))}
          </div>
        )}
        {Object.entries(filters).some(([k, v]) => v !== undefined && k !== "page") && (
          <p className="showcase-clear">
            <Link href={base} scroll={false}>Clear the filters</Link>
          </p>
        )}
      </nav>
      {posts.length ? (
        <ShowcaseGrid posts={posts} />
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
