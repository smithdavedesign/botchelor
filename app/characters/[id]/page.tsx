import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import ShareLink from "@/app/ShareLink";
import { getDatingProfile } from "@/lib/dating";
import { hasExtras } from "@/lib/extras";
import ProfileDetails from "./ProfileDetails";
import { PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { getDb } from "@/lib/db";
import { getCharacterHistory, getPublicCharacter } from "@/lib/game";
import { loadCharacter } from "@/lib/character";
import { thisWeek } from "@/lib/life";
import { describeTemperament } from "@/lib/temperament";
import { connections, describeDrift, describeForgets, loadCharacterMemory, loadForgets, stageFor } from "@/lib/memory";
import { getCharacterRatings } from "@/lib/ratings";
import { userIdFromCookieStore } from "@/lib/http";
import { ENDING_LABELS } from "@/lib/rules";
import RatingButtons from "./RatingButtons";
import OwnerControls from "./OwnerControls";
import LearnedPanel from "./LearnedPanel";

export const dynamic = "force-dynamic";

const PREMIUM_IDS = new Set(PREMIUM_HOUSE_CHARACTERS.map((c) => c.id));

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const c = await getPublicCharacter(await getDb(), id);
  if (!c) return { title: "Character not found · Botchelor", robots: { index: false, follow: false } };
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
  const [{ episodes, record }, ratings, memory, dating] = await Promise.all([
    getCharacterHistory(db, id),
    getCharacterRatings(db, id, viewerId),
    loadCharacterMemory(db, id),
    getDatingProfile(db, id),
  ]);
  const week = thisWeek(c.id, c.this_week);
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
      <p className="kicker">Contestant card</p>
      <div className="contestant">
        <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} size={96} portraitSrc={c.portrait_asset_id ? `/api/assets/${c.portrait_asset_id}` : null} />
        <div className="meta">
          <h1>
            {c.name}
            {c.house && <span className="badge">House character</span>}
            {c.house && dating && !dating.can_ask_out && !PREMIUM_IDS.has(c.id) && <span className="badge">Off this season</span>}
            {dating?.made_by === "agent" && <span className="badge badge-agent">🤖 Agent-made</span>}
            {!c.house && dating?.open_to_dates && <span className="badge badge-open">💌 Open to dates</span>}
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

      {ratings.is_owner && !c.house && <OwnerControls id={c.id} name={c.name} openToDates={dating?.open_to_dates ?? false} />}
      {plays && (
        <p className="muted small owner-temperament">
          🔒 How {c.name.split(" ")[0]} plays on a date: <strong>{describeTemperament(plays)}</strong>. Only you see this; tune it on the{" "}
          <Link href={`/characters/${c.id}/edit`}>Soul step</Link>.
        </p>
      )}

      {c.clip_asset_id && (
        <section className="card">
          {/* A BYOK-generated intro clip (owner's own, provider-moderated). Poster is durable; the MP4 proxies. */}
          <video className="character-clip" controls playsInline preload="none" poster={`/api/assets/${c.clip_asset_id}`}>
            <source src={`/api/assets/${c.clip_asset_id}/video`} type="video/mp4" />
          </video>
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

      {hasExtras(c.extras) && <ProfileDetails extras={c.extras} />}

      <section className="card">
        <h2>Audience rating</h2>
        <p className="muted">How the crowd reads this contestant. It&apos;s just for fun — it never changes a date, the odds or your points on a prediction.</p>
        <RatingButtons characterId={c.id} counts={ratings.counts} mine={ratings.mine} isOwner={ratings.is_owner} />
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

      {people.length > 0 && (
        <section className="card">
          <h2>Connections</h2>
          <ul className="list connections">
            {people.map((p) => (
              <li key={p.id}>
                <Link href={`/characters/${p.id}`}>{p.name}</Link> <span className="badge">{p.label}</span>
                <span className="muted">
                  {p.dates > 1 && <> · {p.dates} dates</>}
                  {p.turned_down === "them" && <> · {c.name.split(" ")[0]} turned them down</>}
                  {p.turned_down === "you" && <> · they turned {c.name.split(" ")[0]} down</>}
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

      <section className="card">
        <h2>Share this contestant</h2>
        <ShareLink path={`/characters/${c.id}`} label="Character link" />
        <p className="muted">
          <Link href="/">Make your own character</Link> · <Link href="/cast">See the whole cast</Link>
        </p>
      </section>
    </article>
  );
}
