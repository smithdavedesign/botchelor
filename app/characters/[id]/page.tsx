import { shortName } from "@/lib/names";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import JsonLd from "@/app/JsonLd";
import { breadcrumbJsonLd, characterJsonLd } from "@/lib/seo";
import ShareLink from "@/app/ShareLink";
import { getDatingProfile } from "@/lib/dating";
import { hasExtras, profileComplete, profileMissing, type CharacterExtras } from "@/lib/extras";
import ProfileDetails from "./ProfileDetails";
import { PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { getDb } from "@/lib/db";
import { getCharacterHistory, getPublicCharacter } from "@/lib/game";
import { isAdmin } from "@/lib/admins";
import { CLIP_TOKEN_COST, episodeAllowance } from "@/lib/allowance";
import { loadCharacter } from "@/lib/character";
import { thisWeek } from "@/lib/life";
import { describeTemperament } from "@/lib/temperament";
import { connections, describeDrift, describeForgets, loadCharacterMemory, loadForgets, stageFor } from "@/lib/memory";
import { getCharacterRatings } from "@/lib/ratings";
import { relationshipsOf, viewRelationship } from "@/lib/relationships";
import { userIdFromCookieStore } from "@/lib/http";
import { ENDING_LABELS } from "@/lib/rules";
import RatingButtons from "./RatingButtons";
import Reviews from "./Reviews";
import { reviewableNow, reviewSummary } from "@/lib/reviews";
import OwnerControls from "./OwnerControls";
import { isTalkLevel, type TalkLevel } from "@/lib/talk";
import { partnerStyleOf } from "@/lib/partners";
import LearnedPanel from "./LearnedPanel";
import AfterDarkTeaser from "@/app/AfterDarkTeaser";
import OriginBadge from "@/app/OriginBadge";
import { originOf, originsOf } from "@/lib/origin";
import { ctaMine, dateCta } from "@/lib/date-cta";
import DateThisCharacter from "./DateThisCharacter";

export const dynamic = "force-dynamic";

const PREMIUM_IDS = new Set(PREMIUM_HOUSE_CHARACTERS.map((c) => c.id));

type Props = { params: Promise<{ id: string }> };

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
export default async function CharacterPage({ params }: Props) {
  const { id } = await params;
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
  const [{ episodes, record }, ratings, memory, dating, reviews] = await Promise.all([
    getCharacterHistory(db, id),
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
    const names = new Map(
      others.length
        ? (await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [others])).rows.map((r) => [r.id, r.name])
        : [],
    );
    return edges
      .map((rel) => ({ rel, view: viewRelationship(rel, { userId: viewerId, owner: ratings.is_owner }) }))
      .filter((x) => x.view !== null)
      .map(({ rel, view }) => {
        const otherId = rel.lo === id ? rel.hi : rel.lo;
        return { otherId, name: names.get(otherId) ?? "Someone", path: `/couples/${rel.lo}/${rel.hi}`, view: view! };
      })
      .sort((x, y) => y.view.tie - x.view.tie);
  })();
  // The owner's clip panel: admin (no paywall), their bought tokens, and whether they have a Google key.
  const clip =
    ratings.is_owner && !c.house && viewerId
      ? await Promise.all([
          isAdmin(db, viewerId),
          episodeAllowance(db, viewerId),
          db.query("select 1 from user_keys where user_id = $1 and provider = 'google' limit 1", [viewerId]),
        ]).then(([admin, tokens, key]) => ({
          admin,
          boughtTokens: tokens.pack_left,
          hasKey: key.rows.length > 0,
          cost: CLIP_TOKEN_COST,
          // Baseline-still gate: Veo drifts without an image anchor, so a clip now needs an approved portrait first.
          hasPortrait: Boolean(c.portrait_asset_id),
        }))
      : null;
  // One partner or more (lib/partners.ts): public as a badge, the setting for the owner.
  const partnerStyle = c.house ? null : await partnerStyleOf(db, id);
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
          db.query("select 1 from user_keys where user_id = $1 and kind = 'text' limit 1", [viewerId]),
        ]).then(([t, key]) => ({ level: isTalkLevel(t.rows[0]?.talk) ? t.rows[0].talk as TalkLevel : "standard" as TalkLevel, hasTextKey: key.rows.length > 0 }))
      : null;
  // Owner only: how the engine reads it on a date (its effective temperament, learned drift included).
  const plays = ratings.is_owner && !c.house ? (await loadCharacter(db, id))?.signals ?? null : null;
  const people = connections(memory);
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
            {partnerStyle?.taken && partnerStyle.partners[0] && <span className="badge">💍 With {shortName(partnerStyle.partners[0].name)}</span>}
            {partnerStyle && !partnerStyle.taken && partnerStyle.effective === "open" && (partnerStyle.choice === "open" || partnerStyle.decided) && (
              <span className="badge">🌈 Open to more than one</span>
            )}
          </h1>
          <p className="muted">
            Age {c.age}
            {c.pronouns && <> · {c.pronouns}</>} · <span className="stage">{stageFor(memory?.dates ?? 0)}</span>
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
      {ratings.is_owner && !c.house && <OwnerControls id={c.id} name={c.name} private={c.private} openToDates={dating?.open_to_dates ?? false} audience={dating?.open_to} clip={clip ?? undefined} talk={talk ?? undefined} partners={partnerStyle ?? undefined} />}
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
        <section className="card">
          <div className="section-head">
            <h2>Relationships</h2>
            <span>
              <Link href={`/characters/${c.id}/relationships`}>📱 Open their relationship board</Link> ·{" "}
              <Link href={`/graph?focus=${encodeURIComponent(c.id)}`}>✨ See {shortName(c.name)} in the Constellation</Link>
            </span>
          </div>
          <ul className="list connections">
            {relationships.map((r) => (
              <li key={r.otherId}>
                <Link href={`/characters/${r.otherId}`}>{r.name}</Link> {r.view.stage_label && <span className="badge">{r.view.stage_label}</span>}
                <span className="muted">
                  {" "}
                  · {r.view.dates === 1 ? "1 date" : `${r.view.dates} dates`} · <Link href={r.path}>see them together</Link>
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
        </section>
      )}

      <section className="card">
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
                <li key={e.episode_id}>
                  <Link href={e.share_path}>vs {e.partner}</Link> <span className="badge">{ENDING_LABELS[e.ending]}</span>
                </li>
              ))}
            </ul>
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
