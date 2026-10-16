import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import Avatar from "@/app/Avatar";
import { getDb } from "@/lib/db";
import { getPublicCharacter, type PublicCharacter } from "@/lib/game";
import { userIdFromCookieStore } from "@/lib/http";
import { activeNudge, alsoSeeing, coupleTexts } from "@/lib/between-dates";
import { loadRelationship, pairKey, viewRelationship } from "@/lib/relationships";
import NudgeForm from "./NudgeForm";
import { ArcCard, FollowButton } from "./CoupleActions";
import { arcQuestion } from "@/lib/arcs";
import { followState } from "@/lib/follows";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ a: string; b: string }> };

/** The pair and what the viewer may see of it: the public layer, or an owner's (their own dates and plans). */
async function load(a: string, b: string) {
  const db = await getDb();
  const [ca, cb] = await Promise.all([getPublicCharacter(db, a), getPublicCharacter(db, b)]);
  if (!ca || !cb) return null;
  const viewerId = userIdFromCookieStore(await cookies());
  const owners = (await db.query<{ id: string; owner_id: string | null }>(`select id, owner_id from characters where id = any($1)`, [[a, b]])).rows;
  const owner = viewerId !== null && owners.some((o) => o.owner_id === viewerId);
  const rel = await loadRelationship(db, a, b);
  const view = rel ? viewRelationship(rel, { userId: viewerId, owner }) : null;
  if (!view) return null;
  // Between dates (lib/between-dates.ts): who else each is seeing (public), and for owners their texts and nudges.
  const [seeingA, seeingB] = await Promise.all([alsoSeeing(db, a, b), alsoSeeing(db, b, a)]);
  const mine = owners.filter((o) => viewerId !== null && o.owner_id === viewerId).map((o) => o.id);
  const texts = owner ? await coupleTexts(db, a, b, 12) : [];
  const nudges = owner ? await Promise.all(mine.map(async (id) => ({ id, note: await activeNudge(db, id, id === a ? b : a) }))) : [];
  // Spectators: follow the couple, and call their arc (lib/follows.ts, lib/arcs.ts). Public couples only.
  const listed = rel!.public.dates > 0;
  const [follow, arc] = listed ? await Promise.all([followState(db, viewerId, a, b), arcQuestion(db, viewerId, a, b)]) : [null, null];
  return { ca, cb, view, owner, seeing: { [a]: seeingA, [b]: seeingB } as Record<string, string[]>, texts, nudges, follow, arc };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { a, b } = await params;
  const db = await getDb();
  const [ca, cb] = await Promise.all([getPublicCharacter(db, a), getPublicCharacter(db, b)]);
  if (!ca || !cb) return { title: "Couple not found · Botchelor", robots: { index: false, follow: false } };
  const [lo, hi] = pairKey(a, b);
  return {
    title: `${ca.name} × ${cb.name} · Botchelor`,
    description: `${ca.name} and ${cb.name} on Botchelor: every date they've been on, where they stand, and their inside jokes.`,
    alternates: { canonical: `/couples/${lo}/${hi}` },
  };
}

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "";

/** A couple's page: their relationship in the graph (lib/relationships.ts), as the viewer is allowed to see it. */
export default async function CouplePage({ params }: Props) {
  const { a, b } = await params;
  const [lo, hi] = pairKey(a, b);
  if (a !== lo) permanentRedirect(`/couples/${lo}/${hi}`);
  const data = await load(lo, hi);
  if (!data) notFound();
  const { ca, cb, view, owner, seeing, texts, nudges, follow, arc } = data;
  const complicated = [ca, cb].filter((c) => seeing[c.id]?.length);
  const nameOf = (id: string) => (id === ca.id ? ca.name : cb.name);
  const first = (c: PublicCharacter) => c.name.split(" ")[0];

  return (
    <>
      <section className="card couple-head">
        <div className="couple-avatars">
          <Link href={`/characters/${ca.id}`}>
            <Avatar seed={ca.id} name={ca.name} hue={ca.hue} house={ca.house} size={72} portraitSrc={ca.portrait_asset_id ? `/api/assets/${ca.portrait_asset_id}` : null} />
          </Link>
          <Link href={`/characters/${cb.id}`}>
            <Avatar seed={cb.id} name={cb.name} hue={cb.hue} house={cb.house} size={72} portraitSrc={cb.portrait_asset_id ? `/api/assets/${cb.portrait_asset_id}` : null} />
          </Link>
        </div>
        <h1>
          {first(ca)} × {first(cb)}
        </h1>
        {view.stage_label && <p className="ending">{view.stage_label}</p>}
        <p className="muted">
          {view.dates === 1 ? "One date" : `${view.dates} dates`}
          {view.second_dates > 0 && `, ${view.second_dates} ending in a second date`}
          {view.first_at && ` · since ${date(view.first_at)}`}
        </p>
        <Meter label="How close they are" value={view.tie} />
        {view.chemistry !== null && <Meter label="Chemistry" value={view.chemistry / 100} />}
        {view.trust !== null && <Meter label="Trust" value={view.trust / 100} />}
        {complicated.length > 0 && (
          <p className="notice">
            🌀 It&apos;s complicated:{" "}
            {complicated.map((c, i) => (
              <span key={c.id}>
                {i > 0 && "; "}
                {first(c)} is also seeing {seeing[c.id].join(" and ")}
              </span>
            ))}
            .
          </p>
        )}
        {follow && <FollowButton pair={[ca.id, cb.id]} following={follow.following} followers={follow.followers} />}
        {owner && <p className="muted small">You own one of them, so you also see your own private dates, their plans and their texts.</p>}
      </section>

      {arc && <ArcCard pair={[ca.id, cb.id]} names={`${first(ca)} and ${first(cb)}`} q={arc} />}

      {owner && texts.length > 0 && (
        <section className="card afterglow">
          <h2>Their texts</h2>
          <p className="muted small">Between dates they keep texting, about once a day. Only the characters&apos; owners see this.</p>
          {texts.map((t) => {
            const c = t.who === "lo" ? ca : cb;
            return (
              <div key={`${t.day}-${t.seq}`} className={`turn turn-${t.who === "lo" ? "a" : "b"}`}>
                <div className="turn-body">
                  <p className="turn-line">
                    <strong>{first(c)}</strong> {t.text}
                  </p>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {owner &&
        nudges.map((n) => {
          const me = n.id === ca.id ? ca : cb;
          const them = n.id === ca.id ? cb : ca;
          return (
            <section key={n.id} className="card">
              <h2>Nudge {first(me)}</h2>
              <NudgeForm pair={[ca.id, cb.id]} characterId={me.id} name={me.name} other={them.name} current={n.note} />
            </section>
          );
        })}

      <section className="card">
        <h2>Their dates</h2>
        <ol className="list couple-timeline">
          {view.timeline.map((t) => (
            <li key={t.episode_id}>
              <Link href={`/episodes/${t.episode_id}`}>{t.ending_label}</Link> <span className="muted">· {t.venue}</span>{" "}
              <span className="muted small">· {date(t.at)}</span>
              {t.second_date_of && <span className="badge">second date</span>}
              {!t.aired && <span className="badge">not aired yet</span>}
            </li>
          ))}
        </ol>
      </section>

      {view.jokes.length > 0 && (
        <section className="card">
          <h2>Inside jokes</h2>
          <p>
            {view.jokes.map((j) => (
              <span key={j} className="badge">
                “{j}”
              </span>
            ))}
          </p>
        </section>
      )}

      {Boolean(view.told[ca.id]?.length || view.told[cb.id]?.length) && (
        <section className="card">
          <h2>What they&apos;ve told each other</h2>
          {[ca, cb].map((c) =>
            view.told[c.id]?.length ? (
              <div key={c.id}>
                <h3>{first(c)}</h3>
                <ul className="list">
                  {view.told[c.id].map((line) => (
                    <li key={line}>“{line}”</li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </section>
      )}

      {owner && view.plans && view.plans.length > 0 && (
        <section className="card">
          <h2>Their plans</h2>
          <p className="muted small">From their morning-after texts. Only the characters&apos; owners see these.</p>
          <ul className="list">
            {view.plans.map((p) => (
              <li key={`${p.episode_id}-${p.by}`}>
                <strong>{nameOf(p.by).split(" ")[0]}:</strong> “{p.text}”{" "}
                <span className="badge">{p.status === "kept" ? "✅ kept" : p.status === "missed" ? "missed" : "still to do"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span className="meter-label">{label}</span>
      <span className="meter-track">
        <span className="meter-fill" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

