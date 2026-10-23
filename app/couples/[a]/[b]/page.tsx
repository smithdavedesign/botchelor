import { shortName } from "@/lib/names";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import Avatar from "@/app/Avatar";
import CharacterName from "@/app/CharacterName";
import Pager from "@/app/Pager";
import { pageHref, pageOf as pageSlice, parsePage } from "@/lib/paging";
import PhoneFrame from "@/app/PhoneFrame";
import { getDb } from "@/lib/db";
import { getPublicCharacter, type CharacterRef, type PublicCharacter } from "@/lib/game";
import { userIdFromCookieStore } from "@/lib/http";
import { activeNudge, alsoSeeing } from "@/lib/between-dates";
import { loadRelationship, pairKey, viewRelationship } from "@/lib/relationships";
import { planFromChain } from "@/lib/simulation";
import { venueName } from "@/lib/venues";
import { chainPage, loadChain } from "@/lib/text-chain";
import NudgeForm from "./NudgeForm";
import ThreadPreview from "./ThreadPreview";
import { ArcCard, CopyLink, FollowButton } from "./CoupleActions";
import NextDate from "./NextDate";
import MatchHeader from "./MatchHeader";
import { loadThread } from "@/lib/inbox";
import { nextDate } from "@/lib/date-proposals";
import { arcQuestion } from "@/lib/arcs";
import { followState } from "@/lib/follows";
import AfterDarkTeaser from "@/app/AfterDarkTeaser";
import OriginBadge from "@/app/OriginBadge";
import { originOf, originsOf } from "@/lib/origin";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ a: string; b: string }>; searchParams?: Promise<{ dates?: string | string[] }> };

/** "Their dates": this many a page (?dates=N). */
const TIMELINE_PAGE = 10;

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
  // Owners: the couple's whole text chain (lib/text-chain.ts), the newest page first. Nobody owns a house couple's
  // characters, so nobody texts there; anywhere else a spectator learns the texts are the owners'.
  const fullChain = owner ? await loadChain(db, a, b, { userId: viewerId, owner: true }) : null;
  const chain = fullChain ? chainPage(fullChain) : null;
  const texted = owners.some((o) => o.owner_id !== null);
  const nudges = owner ? await Promise.all(mine.map(async (id) => ({ id, note: await activeNudge(db, id, id === a ? b : a) }))) : [];
  // Spectators: follow the couple, and call their arc (lib/follows.ts, lib/arcs.ts). Public couples only.
  const listed = rel!.public.dates > 0;
  const [follow, arc] = listed ? await Promise.all([followState(db, viewerId, a, b), arcQuestion(db, viewerId, a, b)]) : [null, null];
  // Owners: what they can do next for this couple (lib/date-proposals.ts), with the plan they agreed to by text since
  // their last date, which is where the next date will happen (lib/plans.ts), or else the plan from their latest date.
  const last = view.timeline.at(-1) ?? null;
  const [lo] = pairKey(a, b);
  const agreed = fullChain ? await planFromChain(db, fullChain, lo, a === lo ? { lo: ca.name, hi: cb.name } : { lo: cb.name, hi: ca.name }).catch(() => null) : null;
  const plan = agreed
    ? agreed.texts.map((t) => t.text)
    : owner && last
      ? (view.plans ?? []).filter((p) => p.episode_id === last.episode_id).map((p) => p.text)
      : [];
  const next = owner ? await nextDate(db, viewerId, a, b, last?.episode_id ?? null, plan, agreed ? venueName(agreed.place) : null) : null;
  return { ca, cb, view, owner, mine, seeing: { [a]: seeingA, [b]: seeingB } as Record<string, string[]>, chain, texted, nudges, follow, arc, next };
}

/** A swipe-deck match that hasn't dated yet (lib/swipes.ts): only its owners see it, with their chat and the yes or no. */
async function loadMatch(a: string, b: string) {
  const t = await loadThread(await getDb(), userIdFromCookieStore(await cookies()), a, b);
  if (!t?.match) return null;
  return { ca: t.ca, cb: t.cb, mine: t.mine, match: t.match, chain: t.chain };
}

const refOf = (c: PublicCharacter): CharacterRef => ({
  id: c.id,
  name: c.name,
  house: c.house,
  hue: c.hue,
  portrait: c.portrait_asset_id ? `/api/assets/${c.portrait_asset_id}` : null,
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { a, b } = await params;
  const db = await getDb();
  const [ca, cb] = await Promise.all([getPublicCharacter(db, a), getPublicCharacter(db, b)]);
  if (!ca || !cb) return { title: "Couple not found · Botchelor", robots: { index: false, follow: false } };
  const [lo, hi] = pairKey(a, b);
  // #SEO: couple pages are high-intent long-tail content (two names + the relationship stage). Keep the title
  // descriptive, the description honest about what's on the page, and the canonical pointing at the sorted pair.
  return {
    title: `${ca.name} and ${cb.name}: their blind dates and how it's going · Botchelor`,
    description: `${ca.name} and ${cb.name} on Botchelor: every blind date they've been on, where they stand now, their inside jokes and the plans they made in the morning-after texts.`,
    alternates: { canonical: `/couples/${lo}/${hi}` },
    openGraph: { type: "website", siteName: "Botchelor", locale: "en_US", url: `/couples/${lo}/${hi}`, title: `${ca.name} and ${cb.name} on Botchelor` },
  };
}

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "";

/** A couple's page: their relationship in the graph (lib/relationships.ts), as the viewer is allowed to see it. */
export default async function CouplePage({ params, searchParams }: Props) {
  const { a, b } = await params;
  const sp = (await searchParams) ?? {};
  const [lo, hi] = pairKey(a, b);
  if (a !== lo) permanentRedirect(`/couples/${lo}/${hi}`);
  const data = await load(lo, hi);
  if (!data) {
    const match = await loadMatch(lo, hi);
    if (!match) notFound();
    return <MatchPage {...match} />;
  }
  const { ca, cb, view, owner, mine, seeing, chain, texted, nudges, follow, arc, next } = data;
  const followedUp = view.timeline.filter((t) => t.second_date_of).length;
  const latest = [...view.timeline].reverse().find((t) => t.aired) ?? view.timeline.at(-1) ?? null;
  const complicated = [ca, cb].filter((c) => seeing[c.id]?.length);
  const nameOf = (id: string) => (id === ca.id ? ca.name : cb.name);
  const first = (c: PublicCharacter) => shortName(c.name);
  const origins = await originsOf(await getDb(), [ca.id, cb.id]);
  // A character private to someone else: its name only, never linked (the private-character rule, #509).
  const viewerId = userIdFromCookieStore(await cookies());
  const hidden = (c: PublicCharacter) => c.private && c.owner_id !== viewerId;
  const timeline = pageSlice(view.timeline.map((t, i) => ({ ...t, n: i + 1 })), parsePage(sp.dates), TIMELINE_PAGE);

  return (
    <>
      <section className="card couple-head">
        <div className="couple-avatars">
          {[ca, cb].map((c) => {
            const face = <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} size={72} portraitSrc={c.portrait_asset_id ? `/api/assets/${c.portrait_asset_id}` : null} />;
            return hidden(c) ? <span key={c.id}>{face}</span> : <Link key={c.id} href={`/characters/${c.id}`}>{face}</Link>;
          })}
        </div>
        <h1>
          {first(ca)} × {first(cb)}
        </h1>
        <p className="muted small couple-names">
          {[ca, cb].map((c, i) => (
            <span key={c.id}>
              {i > 0 && " and "}
              <CharacterName character={{ ...refOf(c), private: hidden(c) }} avatar={false} />
              <OriginBadge origin={origins.get(c.id) ?? originOf({ house: c.house, agent: c.made_by_agent })} />
            </span>
          ))}
        </p>
        {view.stage_label && <p className="ending">{view.stage_label}</p>}
        <p className="muted">
          {view.dates === 1 ? "One date" : `${view.dates} dates`}
          {view.first_at && ` since ${date(view.first_at)}`}
          {view.second_dates > 0 && ` · ${view.second_dates === view.dates && view.dates > 1 ? "all" : view.second_dates} ended in a second date`}
          {view.second_dates > 0 && ` · ${followedUp === 0 ? "none booked yet" : `${followedUp} booked`}`}
        </p>
        <Meter label="How close they are" value={view.tie} word={closeness(view.tie)} />
        {view.chemistry !== null && <Meter label="Chemistry" value={view.chemistry / 100} word={String(Math.round(view.chemistry))} />}
        {view.trust !== null && <Meter label="Trust" value={view.trust / 100} word={String(Math.round(view.trust))} />}
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
        <p className="small couple-links">
          {latest && <Link href={`/episodes/${latest.episode_id}`}>▶ Watch their latest date</Link>}
          {latest && " · "}
          <Link href={`/graph?focus=${encodeURIComponent(ca.id)}`}>✨ See them in the Constellation</Link>
          {" · "}
          <CopyLink path={`/couples/${ca.id < cb.id ? ca.id : cb.id}/${ca.id < cb.id ? cb.id : ca.id}`} title={`${ca.name} × ${cb.name} on Botchelor`} />
        </p>
        {owner && <p className="muted small">You own one of them, so you also see your own private dates, their plans and their texts.</p>}
      </section>

      {next && <NextDate pair={[ca.id, cb.id]} next={next} hasNudge={nudges.length > 0} />}

      {arc && <ArcCard pair={[ca.id, cb.id]} names={`${first(ca)} and ${first(cb)}`} q={arc} />}

      <AfterDarkTeaser pair={[ca.id, cb.id]} />

      {owner && chain && (
        <ThreadPreview
          items={chain.items}
          characters={{ lo: refOf(ca), hi: refOf(cb) }}
          mine={mine.includes(ca.id) ? "lo" : "hi"}
          thread={`/messages/${ca.id}/${cb.id}?as=${encodeURIComponent(mine[0])}`}
        />
      )}

      {!owner && texted && (
        <section className="card phone-card">
          <h2>Their texts</h2>
          <PhoneFrame short>
            <div className="phone-locked">
              <span className="phone-lock" aria-hidden="true">
                🔒
              </span>
              <p>
                <strong>Their texts are private.</strong>
              </p>
              <p className="muted small">
                Only the characters&apos; owners read what {first(ca)} and {first(cb)} text each other after a date. Make your own character, and
                you&apos;ll read every text it sends.
              </p>
              <Link className="button-ghost" href="/create">
                Make a character
              </Link>
            </div>
          </PhoneFrame>
        </section>
      )}

      {owner &&
        nudges.map((n, i) => {
          const me = n.id === ca.id ? ca : cb;
          const them = n.id === ca.id ? cb : ca;
          return (
            <section key={n.id} className="card" id={i === 0 ? "nudge" : undefined}>
              <h2>
                Nudge <CharacterName character={refOf(me)} label={first(me)} size={26} />
              </h2>
              <NudgeForm pair={[ca.id, cb.id]} characterId={me.id} name={me.name} other={them.name} current={n.note} />
            </section>
          );
        })}

      <section className="card" id="their-dates">
        <h2>Their dates</h2>
        <ol className="list couple-timeline" start={(timeline.page - 1) * TIMELINE_PAGE + 1}>
          {timeline.items.map((t) => (
            <li key={t.episode_id}>
              <Link href={`/episodes/${t.episode_id}`}>Date {t.n}</Link> <span className="muted">· {t.venue}</span>{" "}
              <span className="muted small">· {date(t.at)}</span> → <strong>{t.ending_label}</strong>
              {t.second_date_of && <span className="badge">planned together</span>}
              {!t.aired && <span className="badge">not aired yet</span>}
            </li>
          ))}
        </ol>
        <Pager page={timeline.page} pages={timeline.pages} label="Their dates pages" href={(n) => pageHref(`/couples/${ca.id}/${cb.id}`, {}, "dates", n, "their-dates")} scroll={false} />
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
                <h3>
                  <CharacterName character={refOf(c)} label={first(c)} size={24} />
                </h3>
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
                {p.by === ca.id || p.by === cb.id ? (
                  <CharacterName character={refOf(p.by === ca.id ? ca : cb)} label={shortName(nameOf(p.by))} strong />
                ) : (
                  <strong>{shortName(nameOf(p.by))}</strong>
                )}
                : “{p.text}”{" "}
                <span className="badge">{p.status === "kept" ? "✅ kept" : p.status === "missed" ? "missed" : "still to do"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** How close they are, in a word: tie strength (0..1) as people would say it. */
function closeness(tie: number): string {
  return tie < 0.3 ? "Faint" : tie < 0.55 ? "Growing" : tie < 0.75 ? "Close" : "Very close";
}

function Meter({ label, value, word }: { label: string; value: number; word: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={word}>
      <span className="meter-label">{label}</span>
      <span className="meter-track">
        <span className="meter-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="meter-value">{word}</span>
    </div>
  );
}

/** A match before its first date: who matched, where the yes stands (and the booking once both want it), and their chat. */
function MatchPage({ ca, cb, mine, match, chain }: NonNullable<Awaited<ReturnType<typeof loadMatch>>>) {
  const mineLo = mine.includes(ca.id);
  const me = mineLo ? ca : cb;
  const them = mineLo ? cb : ca;
  return (
    <>
      <section className="card couple-head">
        <div className="couple-avatars">
          {[ca, cb].map((c) => (
            <Link key={c.id} href={`/characters/${c.id}`}>
              <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} size={72} portraitSrc={c.portrait_asset_id ? `/api/assets/${c.portrait_asset_id}` : null} />
            </Link>
          ))}
        </div>
        <h1>
          {shortName(ca.name)} × {shortName(cb.name)}
        </h1>
        <p className="ending">💘 Matched {date(match.matched_at)}</p>
        <MatchHeader
          mine={{ id: me.id, name: me.name }}
          them={{ id: them.id, name: them.name }}
          mineYes={mineLo ? match.yes_lo : match.yes_hi}
          themYes={mineLo ? match.yes_hi : match.yes_lo}
        />
        <p className="muted small">They matched in the swipe deck. Only the characters&apos; owners see this until one of their dates airs.</p>
      </section>
      <ThreadPreview
        items={chain.items}
        characters={{ lo: refOf(ca), hi: refOf(cb) }}
        mine={mineLo ? "lo" : "hi"}
        thread={`/messages/${ca.id}/${cb.id}?as=${encodeURIComponent(me.id)}`}
      />
    </>
  );
}
