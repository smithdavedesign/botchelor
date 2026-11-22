import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import Icon from "@/app/Icon";
import Pager from "@/app/Pager";
import { adCast, cardsFor, CHARACTERS_PAGE, charactersHref, filterCast, parseCharacterFilter, tagChips, type AdCharacterCard } from "@/lib/adult/character-list";
import { afterDarkTitle } from "@/lib/adult/discreet";
import { canAfterDark } from "@/lib/adult/entitlement";
import { adultAvailable } from "@/lib/adult/mode";
import { whoseCounts, whoseFilters, type Whose } from "@/lib/adult/pair-pick";
import { lockedForCookies } from "@/lib/adult/privacy";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { pageOf } from "@/lib/paging";
import { tagById, type TagId } from "@/lib/tags";
import LockedPreview from "../LockedPreview";
import { currentHere, currentView } from "../view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: afterDarkTitle((await currentView()).neutralTitle, "Characters · After Dark · Botchelor"), robots: { index: false, follow: false } };
}

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/** A card's portrait: drawn this size (its resolution); the stylesheet fills the card. */
const CARD_PORTRAIT = 320;
/** The first row's faces load at once; the rest as they scroll in. */
const EAGER_CARDS = 4;

const WHOSE_LABEL: Record<Whose, string> = { all: "Everyone", house: "House cast", mine: "Yours" };
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * One of them, as a card (joi.com's character grid, docs/audits/2026-11-20-joi-teardown.md): their face, large; their
 * name; what kind of person (their type tags); a line of bio; and the viewer's nights and pictures with them. The whole
 * card is one link to their page. The face is the one After Dark keeps for this viewer where there is one (its own file,
 * under the privacy blur while that's on: a plain picture, so it keeps the card's corners, not a portrait's circle),
 * else the show's PG portrait (.avatar: never blurred).
 */
function CharacterCard({ c, eager }: { c: AdCharacterCard; eager: boolean }) {
  const tags = c.tags
    .slice(0, 2)
    .map((t) => tagById(t))
    .filter((t) => t !== undefined);
  const facts = [c.nights ? plural(c.nights, "night") : "", c.pictures ? plural(c.pictures, "picture") : ""].filter(Boolean).join(" · ");
  return (
    <li className="ad-char-card" data-character={c.id}>
      <Link href={`/after-dark/characters/${encodeURIComponent(c.id)}`} className="ad-char-link">
        <span className="ad-char-art">
          {c.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a private file from the media route, already sized
            <img src={c.photo} alt="" loading={eager ? "eager" : "lazy"} decoding="async" />
          ) : (
            <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={CARD_PORTRAIT} fill eager={eager} decorative />
          )}
          {(c.mine || c.house) && <span className="ad-char-badge">{c.mine ? "Yours" : "House"}</span>}
        </span>
        <span className="ad-char-body">
          <strong className="ad-char-name">{c.name}</strong>
          {tags.length > 0 && <span className="ad-char-tags">{tags.map((t) => `${t.icon} ${t.label}`).join(" · ")}</span>}
          {c.bio && <span className="ad-char-bio">{c.bio}</span>}
          {facts && <span className="ad-char-facts">{facts}</span>}
        </span>
      </Link>
    </li>
  );
}

/**
 * After Dark's Characters (David, 2026-11-20: "the characters page and gallery would be a nice add to our after dark
 * no?"): everyone this viewer may have a night with (lib/adult/character-list.ts: After Dark's own rule, eligibleIds),
 * as a grid of cards, each opening their page. Found by name, by Everyone · House cast · Yours where that splits them,
 * and by type tag; paged on the server (a page of cards, never the whole cast: #1822). Someone After Dark isn't open to
 * gets the locked preview (blurred tiles and the way in), as at the Gallery and the Studio.
 */
export default async function AfterDarkCharactersPage({ searchParams }: Props = {}) {
  const db = await getDb();
  const store = await cookies();
  const auth = authFromCookieStore(store);
  const sp = (await searchParams) ?? {};
  const entitled = await canAfterDark(db, auth);
  if (!entitled.ok) return <LockedPreview kind="characters" source={sp.source} next="/after-dark/characters" />;
  if (await lockedForCookies(db, auth!.userId, store)) notFound();
  const admin = entitled.why === "admin";
  if (!(await adultAvailable(db)) && !admin) notFound();
  const viewer = auth!.userId;
  const f = parseCharacterFilter(sp);
  const [cast, here] = await Promise.all([adCast(db, viewer), currentHere()]);
  const counts = whoseCounts(cast);
  const filters = whoseFilters(counts);
  // A filter that doesn't split this cast (or an old link's) reads as Everyone.
  const whose: Whose = filters.includes(f.whose) ? f.whose : "all";
  const chips = tagChips(cast);
  const shown = filterCast(cast, { q: f.q, whose, tag: f.tag });
  const paged = pageOf(shown, f.page, CHARACTERS_PAGE);
  // Where only the scenes are allowed (lib/jurisdiction.ts): the PG portraits, and no counts of pictures.
  const cards = await cardsFor(db, viewer, paged.items, { pictures: here.mode !== "text_only" });
  const filtered = Boolean(f.q || whose !== "all" || f.tag);
  const now = { q: f.q, whose, tag: f.tag };
  return (
    <div className="after-dark-mode page-full ad-chars-page">
      <article className="after-dark">
        <p className="kicker">
          <Icon name="moon" /> After Dark · characters
        </p>
        <h1>Characters</h1>
        <p className="muted ad-chars-lede">
          Everyone you can have a night with: this season&apos;s cast, the agent cast, and any of your own you&apos;ve added. Each has a page with your nights together and
          what&apos;s been made of them.
        </p>
        {cast.length > 0 && (
          <div className="ad-chars-find" data-ad-characters-find>
            <form className="ad-chars-search" action="/after-dark/characters" method="get" role="search">
              <input type="search" name="q" defaultValue={f.q} maxLength={64} placeholder={`Search ${cast.length} by name`} aria-label="Search the characters by name" />
              {whose !== "all" && <input type="hidden" name="whose" value={whose} />}
              {f.tag && <input type="hidden" name="tag" value={f.tag} />}
              <button type="submit" className="button-ghost">
                Search
              </button>
            </form>
            {filters.length > 0 && (
              <nav className="ad-chars-filters" aria-label="Whose">
                {filters.map((w) => (
                  <Link key={w} href={charactersHref({ ...now, whose: w })} aria-current={whose === w ? "true" : undefined} data-whose={w}>
                    {WHOSE_LABEL[w]} <span className="ad-pp-count">{counts[w]}</span>
                  </Link>
                ))}
              </nav>
            )}
            {chips.length > 1 && (
              <nav className="ad-chars-filters ad-chars-tags" aria-label="Type">
                {chips.map(({ tag, n }) => (
                  <Link
                    key={tag.id}
                    href={charactersHref({ ...now, tag: f.tag === tag.id ? null : (tag.id as TagId) })}
                    aria-current={f.tag === tag.id ? "true" : undefined}
                    title={tag.about}
                    data-tag={tag.id}
                  >
                    {/* "(17 characters)", never a bare "17" beside a tag on an 18+ page (audit 2026-11-22). */}
                    {tag.icon} {tag.label} <span className="ad-pp-count">({plural(n, "character")})</span>
                  </Link>
                ))}
              </nav>
            )}
          </div>
        )}
        {cast.length > 0 && (
          <p className="muted small ad-chars-count" data-ad-characters-count={shown.length}>
            {filtered ? `${shown.length} of ${cast.length}` : plural(cast.length, "character")}
            {filtered && (
              <>
                {" · "}
                <Link href="/after-dark/characters">Clear</Link>
              </>
            )}
          </p>
        )}
        {cards.length > 0 ? (
          <ul className="ad-chars-grid" data-ad-characters>
            {cards.map((c, i) => (
              <CharacterCard key={c.id} c={c} eager={i < EAGER_CARDS} />
            ))}
          </ul>
        ) : cast.length > 0 ? (
          <p className="ad-home-empty" data-ad-characters-none>
            No one matches that. <Link href="/after-dark/characters">See everyone</Link>.
          </p>
        ) : (
          <p className="ad-home-empty" data-ad-characters-empty>
            No one&apos;s in yet. Switch one of your own characters In on the <Link href="/after-dark/studio#ad-whos-in">Studio door</Link>.
          </p>
        )}
        <Pager page={paged.page} pages={paged.pages} label="Characters pages" href={(p) => charactersHref({ ...now, page: p })} />
        <p className="muted small ad-chars-foot">
          Your own characters aren&apos;t here until you <Link href="/after-dark/studio#ad-whos-in">add them to After Dark</Link>: nothing of theirs comes here before that.
        </p>
      </article>
    </div>
  );
}
