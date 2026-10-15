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
import { thisWeek } from "@/lib/life";
import { connections, describeDrift, loadCharacterMemory, stageFor } from "@/lib/memory";
import { getCharacterRatings } from "@/lib/ratings";
import { userIdFromCookieStore } from "@/lib/http";
import { ENDING_LABELS } from "@/lib/rules";
import RatingButtons from "./RatingButtons";
import OwnerControls from "./OwnerControls";

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
  const people = connections(memory);
  const remembered = (memory?.people ?? []).filter((p) => p.wanted_more !== null || p.they_said);

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
          {ratings.is_owner &&
            (() => {
              const drift = describeDrift(memory.signal_delta);
              const hasLearned =
                memory.likes.length > 0 ||
                memory.turnoffs.length > 0 ||
                drift.length > 0 ||
                memory.memorable_lines.length > 0 ||
                memory.reflections.length > 0 ||
                remembered.length > 0;
              if (!hasLearned) return null;
              return (
                <div className="training-data muted">
                  <p>
                    <em>
                      What {c.name} has learned from its dates. It&apos;s read-only — you can&apos;t edit it — and it&apos;s
                      gathered automatically from how its dates went, then fed back into how it plays future ones. Only you can
                      see this.
                    </em>
                  </p>
                  {memory.likes.length > 0 && (
                    <p>
                      <strong>Warms to:</strong> {memory.likes.join(", ")}.
                    </p>
                  )}
                  {memory.turnoffs.length > 0 && (
                    <p>
                      <strong>Clashes over:</strong> {memory.turnoffs.join(", ")}.
                    </p>
                  )}
                  {drift.length > 0 && (
                    <p>
                      <strong>How its dates have shaped it:</strong> {drift.join(", ")}.
                    </p>
                  )}
                  {memory.memorable_lines.length > 0 && (
                    <div>
                      <strong>Lines it carries into new dates:</strong>
                      <ul className="list">
                        {memory.memorable_lines.map((line, i) => (
                          <li key={i}>
                            <q>{line}</q>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {remembered.length > 0 && (
                    <div>
                      <strong>Who it remembers:</strong>
                      <ul className="list">
                        {remembered.map((p) => (
                          <li key={p.id}>
                            {p.name}
                            {p.wanted_more !== null && <> — {p.wanted_more ? "still wants to see them again" : "isn't hoping for a rematch"}</>}
                            {p.they_said && (
                              <>
                                ; remembers them saying <q>{p.they_said}</q>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {memory.reflections.length > 0 && (
                    <div>
                      <strong>How it reflected on its recent dates:</strong>
                      <ul className="list">
                        {memory.reflections.map((text, i) => (
                          <li key={i}>
                            <q>{text}</q>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })()}
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
