import { shortName } from "@/lib/names";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import { AiFiction, AiTag } from "@/app/AiLabel";
import CharacterName from "@/app/CharacterName";
import { characterPortrait } from "@/lib/portraits";
import Pager from "@/app/Pager";
import { pageHref, pageOf as pageSlice, parsePage } from "@/lib/paging";
import { portraitPathSql } from "@/lib/assets";
import JsonLd from "@/app/JsonLd";
import { breadcrumbJsonLd, characterJsonLd } from "@/lib/seo";
import ShareLink from "@/app/ShareLink";
import { getDatingProfile } from "@/lib/dating";
import { hasExtras, profileComplete, profileMissing, type CharacterExtras } from "@/lib/extras";
import ProfileDetails from "./ProfileDetails";
import { PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { getDb } from "@/lib/db";
import { getCharacterDatesPage, getPublicCharacter } from "@/lib/game";
import { isAdmin } from "@/lib/admins";
import { hasJobKey } from "@/lib/connections";
import { CLIP_TOKEN_COST, episodeAllowance } from "@/lib/allowance";
import { loadCharacter } from "@/lib/character";
import { thisWeek } from "@/lib/life";
import { describeTemperament } from "@/lib/temperament";
import { connections, describeDrift, describeForgets, loadCharacterMemory, loadForgets, stageFor } from "@/lib/memory";
import { getCharacterRatings } from "@/lib/ratings";
import { relationshipsOf, viewRelationship } from "@/lib/relationships";
import { authFromCookieStore, userIdFromCookieStore } from "@/lib/http";
import { endingLabel } from "@/lib/rules";
import RatingButtons from "./RatingButtons";
import Reviews from "./Reviews";
import { reviewableNow, reviewSummary } from "@/lib/reviews";
import OwnerControls from "./OwnerControls";
import { isTalkLevel, type TalkLevel } from "@/lib/talk";
import { partnerStyleOf } from "@/lib/partners";
import { whileAwayOf } from "@/lib/activity";
import LearnedPanel from "./LearnedPanel";
import AfterDarkTeaser from "@/app/AfterDarkTeaser";
import OriginBadge from "@/app/OriginBadge";
import { originOf, originsOf } from "@/lib/origin";
import { ctaMine, dateCta } from "@/lib/date-cta";
import DateThisCharacter from "./DateThisCharacter";
import { accessHere } from "@/lib/adult/place";
import { adultAvailable } from "@/lib/adult/mode";
import { studioAccess } from "@/lib/adult/studio";
import { mediaAllowed } from "@/lib/jurisdiction";
import { afterDarkHref } from "@/lib/after-dark-host";

export const dynamic = "force-dynamic";

const PREMIUM_IDS = new Set(PREMIUM_HOUSE_CHARACTERS.map((c) => c.id));

type Search = { rel?: string | string[]; dates?: string | string[] };
type Props = { params: Promise<{ id: string }>; searchParams?: Promise<Search> };

/** Their relationships on the card: this many a page (?rel=N). The date record pages itself (?dates=N, lib/game.ts). */
const RELATIONSHIPS_PAGE = 8;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const c = await getPublicCharacter(await getDb(), id);
  if (!c) return { title: "Character not found · Botchelor", robots: { index: false, follow: false } };
  if (c.private) return { title: `${c.name} · Botchelor`, robots: { index: false, follow: false } };
  return {
    title: `${c.name}, ${c.age}: a contestant on Botchelor`,
    description: `${c.name}, a contestant on Botchelor: ${c.bio} Wants: ${c.want}`.slice(0, 200),
    alternates: { canonical: `/characters/${c.id}` },
  };
}

/** A shareable contestant card: a character's public persona only (no dealbreaker, no soul). */
export default async function CharacterPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp: Search = (await searchParams) ?? {};
  const db = await getDb();
  const c = await getPublicCharacter(db, id);
  if (!c) notFound();
  const viewerId = userIdFromCookieStore(await cookies());
  // A private character (its owner's choice): everyone but the owner sees only its name.
  if (c.private && c.owner_id !== viewerId) {
    return (
      <article className="character-private">
        <p className="kicker">Contestant</p>
        <h1>{c.name}</h1>
        <p className="muted">🔒 Their creator keeps this character private.</p>
        <p>
          <Link href="/characters">← Characters</Link>
        </p>
      </article>
    );
  }
  const [{ dates: episodes, record, page: datesPage, pages: datesPages }, ratings, memory, dating, reviews] = await Promise.all([
    getCharacterDatesPage(db, id, viewerId, parsePage(sp.dates)),
    getCharacterRatings(db, id, viewerId),
    loadCharacterMemory(db, id),
    getDatingProfile(db, id),
    reviewSummary(db, id, viewerId),
  ]);
  const week = thisWeek(c.id, c.this_week);
  // The owner also sees its private facts (marked as theirs alone); everyone else gets the public card.
  const shownExtras =
    ratings.is_owner && viewerId
      ? ((await db.query<{ extras: CharacterExtras | null }>(`select extras from characters where id = $1 and owner_id = $2`, [id, viewerId])).rows[0]?.extras ?? c.extras)
      : c.extras;
  // Its relationships in the graph (lib/relationships.ts), as this viewer may see them: the public layer, or the
  // owner's (with their own private dates). Strongest tie first.
  const relationships = await (async () => {
    const edges = await relationshipsOf(db, id);
    const others = edges.map((r) => (r.lo === id ? r.hi : r.lo));
    // Each one's face and whether it's private to someone else (then: its name only, never linked).
    type Other = { id: string; name: string; hue: number | null; house: boolean; portrait: string | null; private: boolean };
    const faces = new Map(
      others.length
        ? (
            await db.query<Other>(
              `select c.id, c.name, c.avatar_hue as hue, c.is_house as house, ${portraitPathSql("c")} as portrait,
                      (c.visibility = 'private' and c.owner_id is distinct from $2::text) as private
                 from characters c where c.id = any($1)`,
              [others, viewerId],
            )
          ).rows.map((r) => [r.id, r])
        : [],
    );
    return edges
      .map((rel) => ({ rel, view: viewRelationship(rel, { userId: viewerId, owner: ratings.is_owner }) }))
      .filter((x) => x.view !== null)
      .map(({ rel, view }) => {
        const otherId = rel.lo === id ? rel.hi : rel.lo;
        const other = faces.get(otherId) ?? { id: otherId, name: "Someone", hue: null, house: false, portrait: null, private: true };
        return { otherId, other, path: `/couples/${rel.lo}/${rel.hi}`, view: view! };
      })
      .sort((x, y) => y.view.tie - x.view.tie);
  })();
  // The owner's clip panel: admin (no paywall), their bought tokens, and whether they have a Google key.
  const clip =
    ratings.is_owner && !c.house && viewerId
      ? await Promise.all([
          isAdmin(db, viewerId),
          episodeAllowance(db, viewerId),
          hasJobKey(db, viewerId, "video"),
        ]).then(([admin, tokens, key]) => ({
          admin,
          boughtTokens: tokens.pack_left,
          hasKey: key,
          cost: CLIP_TOKEN_COST,
          // Baseline-still gate: Veo drifts without an image anchor, so a clip now needs an approved portrait first.
          hasPortrait: Boolean(c.portrait_asset_id),
        }))
      : null;
  // One partner or more (lib/partners.ts): public as a badge, the setting for the owner.
  const partnerStyle = c.house ? null : await partnerStyleOf(db, id);
  // The After Dark Studio for this character (lib/adult/studio.ts; David, 2026-10-24): its owner (or an admin, for the
  // house cast), where After Dark is open to them and pictures are allowed where they are (lib/jurisdiction.ts).
  const studio = await (async () => {
    const auth = authFromCookieStore(await cookies());
    if (!auth?.authenticated) return null;
    const here = await accessHere(db, auth).catch(() => null);
    if (!here?.entitled.ok || !mediaAllowed(here) || !(await adultAvailable(db))) return null;
    const r = await studioAccess(db, auth.userId, id);
    if (r.ok) return { href: afterDarkHref(`/after-dark/studio/${id}`), ready: true };
    return r.error === "not_switched_on" ? { href: afterDarkHref("/after-dark"), ready: false } : null;
  })().catch(() => null);
  // What it does while its owner is away (lib/activity.ts), for the owner's controls.
  const away = c.house
    ? null
    : ((await db.query<{ while_away: string | null; created_via: string; adopted: boolean }>(`select while_away, created_via, adopted_at is not null as adopted from characters where id = $1`, [id])).rows[0] ?? null);
  // Who made them (lib/origin.ts), and the "date this character" call to action under the header (lib/date-cta.ts).
  const origin = (await originsOf(db, [id])).get(id) ?? originOf({ house: c.house, agent: dating?.made_by === "agent" });
  const mine = ratings.is_owner ? [] : await ctaMine(db, viewerId, { id, house: c.house });
  const takenBy = partnerStyle?.taken && !partnerStyle.partners.some((p) => mine.some((m) => m.id === p.id)) ? shortName(partnerStyle.partners[0]?.name ?? "someone") : null;
  const cta = dateCta({
    first: shortName(c.name),
    id,
    isOwner: ratings.is_owner,
    isPrivate: c.private,
    available: Boolean(dating?.open_to_dates) || (c.house && PREMIUM_IDS.has(c.id)),
    takenBy,
    mine,
  });
  // Owner only: how much they talk (lib/talk.ts), and whether a text key makes marathon possible.
  const talk =
    ratings.is_owner && !c.house && viewerId
      ? await Promise.all([
          db.query<{ talk: string | null }>("select talk from characters where id = $1", [id]),
          hasJobKey(db, viewerId, "text"),
        ]).then(([t, key]) => ({ level: isTalkLevel(t.rows[0]?.talk) ? t.rows[0].talk as TalkLevel : "standard" as TalkLevel, hasTextKey: key }))
      : null;
  // Owner only: how the engine reads it on a date (its effective temperament, learned drift included).
  const plays = ratings.is_owner && !c.house ? (await loadCharacter(db, id))?.signals ?? null : null;
  const people = connections(memory);
  const relPage = pageSlice(relationships, parsePage(sp.rel), RELATIONSHIPS_PAGE);
  const here = (key: "rel" | "dates", hash: string) => (n: number) => pageHref(`/characters/${c.id}`, { ...sp }, key, n, hash);
  // Owner only: what it has learned, where each item came from, and what it's been told to forget.
  const learned =
    ratings.is_owner && !c.house && memory
      ? {
          sections: [
            {
              title: "Warms to:",
              items: (memory.sources?.likes ?? memory.likes.map((cue) => ({ cue, from: [] }))).map((l) => ({ kind: "like" as const, item: l.cue, label: l.cue, from: l.from })),
            },
            {
              title: "Clashes over:",
              items: (memory.sources?.turnoffs ?? memory.turnoffs.map((cue) => ({ cue, from: [] }))).map((l) => ({ kind: "turnoff" as const, item: l.cue, label: l.cue, from: l.from })),
            },
            {
              title: "Lines it carries into new dates:",
              quote: true,
              items: memory.sources
                ? memory.sources.lines.map((l) => ({ kind: "line" as const, item: l.text, label: l.text, from: [l] }))
                : memory.memorable_lines.map((text) => ({ kind: "line" as const, item: text, label: text, from: [] })),
            },
            {
              title: "How it reflected on its recent dates:",
              quote: true,
              items: (memory.sources?.reflections ?? []).map((r) => ({ kind: "reflection" as const, item: r.episode_id, label: r.text, from: [r] })),
            },
          ],
          drift: describeDrift(memory.signal_delta),
          people: (memory.people ?? [])
            .filter((p) => p.wanted_more !== null || p.they_said)
            .map((p) => ({ ...p, from: p.last_episode_id ? [{ episode_id: p.last_episode_id, with: p.name, at: p.last_at }] : [] })),
          forgotten: await describeForgets(db, id, await loadForgets(db, id)),
        }
      : null;

  return (
    <article>
      <JsonLd
        data={[
          characterJsonLd(c),
          breadcrumbJsonLd([
            { name: "Botchelor", path: "/" },
            { name: "Characters", path: c.house ? "/characters" : `/characters?tab=${origin === "person" ? "people" : "agents"}` },
            { name: c.name, path: `/characters/${c.id}` },
          ]),
        ]}
      />
      <p className="kicker">
        <Link href="/characters">← Characters</Link> · Contestant card
      </p>
      <div className="contestant">
        <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} size={96} portraitSrc={c.portrait_asset_id ? `/api/assets/${c.portrait_asset_id}` : null} />
        <div className="meta">
          <h1>
            {c.name}
            <OriginBadge origin={origin} />
            {c.house && dating && !dating.can_ask_out && !PREMIUM_IDS.has(c.id) && <span className="badge">Off this season</span>}
            {!c.house && dating?.open_to_dates && <span className="badge badge-open">💌 Open to dates</span>}
            {partnerStyle?.taken && partnerStyle.partners[0] && <span className="badge">
                💍 With <CharacterName character={partnerStyle.partners[0]} label={shortName(partnerStyle.partners[0].name)} size={18} />
              </span>}
            {partnerStyle && !partnerStyle.taken && partnerStyle.effective === "open" && (partnerStyle.choice === "open" || partnerStyle.decided) && (
              <span className="badge">🌈 Open to more than one</span>
            )}
          </h1>
          <p className="muted">
            Age {c.age}
            {c.pronouns && <> · {c.pronouns}</>} · <span className="stage">{stageFor(memory?.dates ?? 0)}</span>
            {/* The portrait is a generated picture (the house cast's and an OC's alike): labelled as one. */}
            {(characterPortrait(c.id) || c.portrait_asset_id) && (
              <>
                {" "}
                <AiTag label="AI-generated portrait" />
              </>
            )}
          </p>
          {(c.extras.occupation || c.extras.hometown) && (
            <p className="contestant-job">
              {c.extras.occupation}
              {c.extras.occupation && c.extras.hometown && " · "}
              {c.extras.hometown && <>from {c.extras.hometown}</>}
            </p>
          )}
        </div>
      </div>
      <AiFiction />
      <DateThisCharacter cta={cta} targetId={c.id} first={shortName(c.name)} />

      {ratings.is_owner && !c.house && (
        // The swipe deck (lib/swipes.ts): a complete dating profile to swipe; open to dates to be in others' decks.
        <p className="notice swipe-cta">
          {profileComplete(c.extras) ? (
            <>
              💘 <Link href={`/swipe?character=${c.id}`}>Swipe for {shortName(c.name)}</Link> ·{" "}
              <Link href={`/matches?character=${c.id}`}>💬 {shortName(c.name)}&apos;s matches</Link>
              {dating?.open_to_dates ? " · they're in the swipe deck too" : " · open them to dates to be in others' decks"}
            </>
          ) : (
            <>
              💘 Finish {shortName(c.name)}&apos;s dating profile to swipe: {profileMissing(c.extras).map((m) => m.replace(/ \(extras\.\w+\)$/, "")).join(", ")}.{" "}
              <Link href={`/characters/${c.id}/edit`}>Fill it in</Link>
            </>
          )}
        </p>
      )}
      {studio && (
        <section className="card character-studio">
          <h2>🎨 Studio</h2>
          {studio.ready ? (
            <p>
              Shoots of {shortName(c.name)}, their face and look, and their gallery, in After Dark.{" "}
              <Link className="button" href={studio.href}>
                Open the Studio
              </Link>
            </p>
          ) : (
            <p className="muted">
              Switch {shortName(c.name)} into After Dark first, then the Studio opens for them. <Link href={studio.href}>After Dark</Link>
            </p>
          )}
        </section>
      )}
      {/* Adopted while its agent is away (lib/away.ts): said to everyone, so nobody takes the show's answers for its agent's. */}
      {away?.adopted && <p className="muted small character-adopted">🎭 Played by the show while its agent is away: it answers likes and texts back.</p>}
      {ratings.is_owner && !c.house && <OwnerControls id={c.id} name={c.name} private={c.private} openToDates={dating?.open_to_dates ?? false} audience={dating?.open_to} clip={clip ?? undefined} talk={talk ?? undefined} partners={partnerStyle ?? undefined} whileAway={away ? { mode: whileAwayOf(away), adopted: away.adopted } : undefined} />}
      {plays && (
        <p className="muted small owner-temperament">
          🔒 How {shortName(c.name)} plays on a date: <strong>{describeTemperament(plays)}</strong>. Only you see this; tune it on the{" "}
          <Link href={`/characters/${c.id}/edit`}>Soul step</Link>.
        </p>
      )}

      {c.clip_asset_id && (
        <section className="card">
          {c.clip_is_video ? (
            // A Veo intro clip on the owner's own Google key (lib/video.ts), stored with us and served with byte ranges.
            <video
              className="character-clip"
              controls
              playsInline
              preload="metadata"
              poster={c.portrait_asset_id ? `/api/assets/${c.portrait_asset_id}` : undefined}
              aria-label={`${c.name}'s intro clip`}
            >
              <source src={`/api/assets/${c.clip_asset_id}/video`} type="video/mp4" />
            </video>
          ) : (
            // A clip from the retired Sora era: its MP4 lived with OpenAI and is gone; the still was stored with us.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="character-clip" src={`/api/assets/${c.clip_asset_id}`} alt={`A still from ${c.name}'s intro clip`} />
          )}
          <AiTag label="AI-generated clip" />
        </section>
      )}

      <section className="card">
        <p>{c.bio}</p>
        {week && (
          <p className="this-week">
            🗓️ <strong>This week:</strong> {week}
          </p>
        )}
        {c.appearance && (
          <p className="muted">
            <strong>Looks:</strong> {c.appearance}
          </p>
        )}
        <ul className="chips">
          {c.traits.map((t) => (
            <li className="chip" key={t}>
              {t}
            </li>
          ))}
        </ul>
        <p>
          <strong>Wants:</strong> {c.want}
        </p>
        {c.voice && (
          <p className="muted">
            <strong>How they talk:</strong> {c.voice}
          </p>
        )}
      </section>

      {hasExtras(shownExtras) && <ProfileDetails extras={shownExtras} owner={ratings.is_owner} />}

      <section className="card">
        <h2>Audience rating</h2>
        <p className="muted">How the crowd reads this contestant. It&apos;s just for fun — it never changes a date, the odds or your points on a prediction.</p>
        <RatingButtons characterId={c.id} counts={ratings.counts} mine={ratings.mine} isOwner={ratings.is_owner} />
      </section>

      <section className="card">
        <h2>Reviews</h2>
        <Reviews characterId={c.id} name={c.name} initial={reviews} isOwner={ratings.is_owner} house={c.house} open={!c.house || (await reviewableNow(c.id))} />
      </section>

      {memory?.arc && (
        <section className="card">
          <h2>Who they&apos;ve become</h2>
          <p>{memory.arc}</p>
          {learned && (learned.sections.some((x) => x.items.length) || learned.drift.length > 0 || learned.people.length > 0 || learned.forgotten.length > 0) && (
            <LearnedPanel characterId={c.id} name={c.name} {...learned} />
          )}
        </section>
      )}

      {memory && ((memory.milestones?.length ?? 0) > 0 || (memory.chapters?.length ?? 0) > 0) && (
        <section className="card">
          <h2>Their story so far</h2>
          {(memory.milestones?.length ?? 0) > 0 && (
            <ul className="chips milestones">
              {memory.milestones!.map((m) => (
                <li className="chip" key={m.id}>
                  <Link href={`/episodes/${m.episode_id}`}>{m.label}</Link>
                </li>
              ))}
            </ul>
          )}
          {(memory.chapters?.length ?? 0) > 0 && (
            <ul className="list chapters">
              {memory.chapters!.map((ch) => (
                <li key={ch.season}>
                  <strong>{ch.label}</strong> — {ch.line}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {c.house && <AfterDarkTeaser character={c.id} />}

      {relationships.length > 0 && (
        <section className="card" id="relationships">
          <div className="section-head">
            <h2>Relationships</h2>
            <span>
              <Link href={`/characters/${c.id}/relationships`}>📱 Open their relationship board</Link> ·{" "}
              <Link href={`/graph?focus=${encodeURIComponent(c.id)}`}>✨ See {shortName(c.name)} in the Constellation</Link>
            </span>
          </div>
          <ul className="list connections">
            {relPage.items.map((r) => (
              <li key={r.otherId} className="row-2line">
                {/* Two lines on purpose: who and where they stand, then the numbers and the links (they wrapped raggedly). */}
                <span className="row-2line-head">
                  <CharacterName character={r.other} /> {r.view.stage_label && <span className="badge">{r.view.stage_label}</span>}
                </span>
                <span className="muted row-2line-meta">
                  {r.view.dates === 1 ? "1 date" : `${r.view.dates} dates`} · <Link href={r.path}>see them together</Link>
                  {ratings.is_owner && (
                    <>
                      {" "}
                      · <Link href={`${r.path.replace("/couples/", "/messages/")}?as=${encodeURIComponent(c.id)}`}>💬 their texts</Link>
                    </>
                  )}
                </span>
                <span className="meter-track tie" role="img" aria-label={`How close: ${Math.round(r.view.tie * 100)}%`}>
                  <span className="meter-fill" style={{ width: `${Math.round(r.view.tie * 100)}%` }} />
                </span>
              </li>
            ))}
          </ul>
          <Pager page={relPage.page} pages={relPage.pages} label="Relationships pages" href={here("rel", "relationships")} scroll={false} />
        </section>
      )}

      <section className="card" id="date-record">
        <h2>Date record</h2>
        {record.dates > 0 ? (
          <>
            <p>
              <strong>{record.dates}</strong> {record.dates === 1 ? "aired date" : "aired dates"} ·{" "}
              {record.second_dates} second {record.second_dates === 1 ? "date" : "dates"} · {record.friends} just
              friends · {record.disasters} {record.disasters === 1 ? "disaster" : "disasters"}
            </p>
            <ul className="list">
              {episodes.map((e) => (
                <li key={e.episode_id} className="row-split">
                  <span className="row-2line-head">
                    vs <CharacterName character={e.partner} /> <span className="badge">{endingLabel(e.ending, e.date_number)}</span>
                  </span>
                  <Link href={e.share_path}>See the date</Link>
                </li>
              ))}
            </ul>
            <Pager page={datesPage} pages={datesPages} label="Date record pages" href={here("dates", "date-record")} prev="Newer" next="Older" scroll={false} />
          </>
        ) : (
          <p className="muted">No aired dates yet.</p>
        )}
      </section>

      {(cta.kind === "send" || cta.kind === "make") && (
        <section className="card">
          <h2>Date {shortName(c.name)}</h2>
          <DateThisCharacter cta={cta} targetId={c.id} first={shortName(c.name)} />
        </section>
      )}

      <section className="card">
        <h2>Share this contestant</h2>
        <ShareLink path={`/characters/${c.id}`} label="Character link" />
        <p className="muted">
          <Link href="/">Make your own character</Link> · <Link href="/characters">See every character</Link>
        </p>
      </section>
    </article>
  );
}
