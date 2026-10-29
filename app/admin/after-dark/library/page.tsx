import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LIBRARY_PAGE_SIZE, LIBRARY_RATED, LIBRARY_SORTS, LIBRARY_TYPES, libraryHref, libraryQuery, listLibrary, madeBy, type LibraryRated, type LibrarySort, type LibraryType } from "@/lib/adult/library";
import { signedInAdmin } from "@/lib/adult/mode";
import { lockedForCookies } from "@/lib/adult/privacy";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import Stars from "./Stars";
import { MediaRequest } from "@/app/after-dark/MediaRequest";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "After Dark library · Botchelor", robots: { index: false, follow: false } };

const media = (id: string) => `/api/admin/after-dark/media/${id}`;
const day = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";

const SORT_LABEL: Record<LibrarySort, string> = { newest: "Newest", oldest: "Oldest", rating: "Rating", characters: "Characters", type: "Type", model: "Model" };
const TYPE_LABEL: Record<LibraryType, string> = { picture: "Pictures", portrait: "Portraits", video: "Videos of a night", clip: "Clips" };
const RATED_LABEL: Record<LibraryRated, string> = { good: "Hide 👎 and 1–3★", liked: "👍 or 4–5★ only", unrated: "Not rated yet", low: "👎 or 1–3★", all: "Everything" };
const TYPE_ONE: Record<LibraryType, string> = { picture: "Picture", portrait: "Portrait", video: "Video", clip: "Clip" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Every picture, portrait, video and clip After Dark has kept, everyone's, on pages (lib/adult/library.ts): sorted by
 * newest, rating, characters, type or model, and filtered by character, type, model and rating (by default nothing at
 * 1–3 stars or with its owner's 👎). Rated 1–5 stars. Signed-in
 * admins only, as moderators (like the graph); a 404 to everyone else. Videos load only when played.
 */
export default async function AfterDarkLibraryPage({ searchParams }: { searchParams: SearchParams }) {
  const db = await getDb();
  const store = await cookies();
  const admin = await signedInAdmin(db, authFromCookieStore(store));
  // A device that hasn't entered the admin's PIN (lib/adult/privacy.ts) gets nothing: the layout asks for it instead.
  if (!admin || (await lockedForCookies(db, admin, store))) notFound();
  const q = libraryQuery(await searchParams);
  const lib = await listLibrary(db, admin, q);
  const first = lib.total ? (q.page - 1) * LIBRARY_PAGE_SIZE + 1 : 0;
  const last = Math.min(lib.total, first + lib.items.length - 1);

  return (
    <article className="after-dark ad-library">
      <p className="kicker">
        <Link href="/admin">← Admin</Link> · <Link href="/after-dark">After Dark</Link> · <Link href="/admin/after-dark/graph">Graph</Link>
      </p>
      <h1>After Dark library</h1>
      <p className="muted">
        Every picture, portrait, video and clip, everyone&apos;s. Rate them; sort by any column. Pictures say the model that drew them from
        2026-10-24 on (before that, only the provider was kept); videos say their shots&apos; model.
      </p>

      <form className="ad-library-filters" method="get">
        <label>
          Sort{" "}
          <select name="sort" defaultValue={q.sort}>
            {LIBRARY_SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type{" "}
          <select name="type" defaultValue={q.type ?? ""}>
            <option value="">All</option>
            {LIBRARY_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Character{" "}
          <select name="character" defaultValue={q.character ?? ""}>
            <option value="">Anyone</option>
            {lib.characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model{" "}
          <select name="model" defaultValue={q.model ?? ""}>
            <option value="">Any</option>
            {lib.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rating{" "}
          <select name="rated" defaultValue={q.rated}>
            {LIBRARY_RATED.map((r) => (
              <option key={r} value={r}>
                {RATED_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="primary small">
          Show
        </button>
        {(q.type || q.character || q.model || q.sort !== "newest" || q.rated !== "good") && (
          <Link className="button-ghost small" href="?">
            Clear
          </Link>
        )}
      </form>

      <p className="muted small" role="status">
        {lib.total ? `${first}–${last} of ${lib.total}` : "Nothing here yet."}
      </p>

      {lib.items.length > 0 && (
        <ul className="ad-library-grid">
          {lib.items.map((it) => (
            <li key={it.id} className="card ad-library-item">
              {it.item === "reel" ? (
                <div className="ad-shots">
                  {it.shots.map((s, i) => (
                    <figure key={s.media_id}>
                      <video controls preload="none" playsInline src={media(s.media_id)} />
                      <figcaption className="small">
                        <MediaRequest id={s.media_id} admin>
                          {i + 1}. {s.who === "a" ? it.a.name.split(" ")[0] : (it.b?.name.split(" ")[0] ?? "")}: {s.text}
                        </MediaRequest>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : it.mime.startsWith("video/") ? (
                <video controls preload="none" playsInline src={media(it.id)} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- private, presigned media; not for next/image
                <img src={media(it.id)} alt={`${TYPE_ONE[it.type]} of ${it.a.name}${it.b ? ` and ${it.b.name}` : ""}`} loading="lazy" />
              )}
              <p className="small ad-library-meta">
                {/* A reel's own row is no media item: its shots' captions open theirs. */}
                <strong>{it.item === "reel" ? TYPE_ONE[it.type] : <MediaRequest id={it.id} admin>{TYPE_ONE[it.type]}</MediaRequest>}</strong>
                {it.item === "reel" ? ` · ${it.shots.length} shot${it.shots.length === 1 ? "" : "s"}` : ""} ·{" "}
                {it.b ? (
                  <Link href={`/after-dark/${it.a.id}/${it.b.id}`}>
                    {it.a.name} × {it.b.name}
                  </Link>
                ) : (
                  it.a.name
                )}
              </p>
              <p className="muted small">
                {madeBy(it)} · {day(it.created_at)}
              </p>
              <Stars id={it.id} initial={it.rating} />
            </li>
          ))}
        </ul>
      )}

      {lib.pages > 1 && (
        <nav className="ad-library-pages" aria-label="Pages">
          {q.page > 1 ? <Link href={libraryHref(q, { page: q.page - 1 })}>← Previous</Link> : <span className="muted">← Previous</span>}
          <span>
            Page {q.page} of {lib.pages}
          </span>
          {q.page < lib.pages ? <Link href={libraryHref(q, { page: q.page + 1 })}>Next →</Link> : <span className="muted">Next →</span>}
        </nav>
      )}
    </article>
  );
}
