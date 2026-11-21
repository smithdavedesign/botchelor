import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import Avatar, { sized } from "@/app/Avatar";
import JsonLd from "@/app/JsonLd";
import ShowTabs from "@/app/ShowTabs";
import { avatarPalette, initials } from "@/lib/avatar";
import { getDb } from "@/lib/db";
import { shortName } from "@/lib/names";
import { characterPortrait } from "@/lib/portraits";
import { closedSeasons } from "@/lib/season-ref";
import { breadcrumbJsonLd, characterIndexable, pageMetadata } from "@/lib/seo";
import { cachedWorld } from "@/lib/social/cache";
import { evidenceLinks } from "@/lib/social/evidence";
import { TIE_KINDS } from "@/lib/social/kinds";
import { endWords, LINE_STYLES } from "@/lib/social/lenses";
import { socialLensesOn } from "@/lib/social/lens-sky";
import type { EgoNetwork, Ring, TieView } from "@/lib/social/types";
import { arcPath, CENTRE_RADIUS, labelPath, lineEnds, nameLayout, ROLE_WORDS, worldPicture, WORLD_SIZE, type NamePlace, type WorldMember, type WorldPicture } from "@/lib/social/world-picture";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A world with fewer public ties than this says noindex: a name and a line or two is thin for a search engine. */
const INDEX_MIN_TIES = 3;

/** About how big the picture is drawn on a desktop, per picture unit (640 units across ~700px): faces get copies that size. */
const DRAWN_SCALE = 1.1;

const RING_TITLE: Record<Ring, string> = { inner: "Inner circle", close: "Close", friends: "Friends", acquaintances: "Around them" };
const RING_HINT: Record<Ring, string> = {
  inner: "The five closest: family, a partner, best friends",
  close: "The next ten",
  friends: "Friends, coworkers, the people they share a place with",
  acquaintances: "Who they've met, rivals, the house's gossip",
};

/** One character's public world, once a request (the metadata and the page share it). Null: no page. */
const load = cache(async (id: string): Promise<EgoNetwork | null> => {
  if (!socialLensesOn() || !ID.test(id)) return null;
  return cachedWorld(id, null).catch(() => null);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const w = await load(id);
  if (!w) return { title: "Not found", robots: { index: false } };
  const name = w.centre.name;
  const people = new Set([...w.ties.map((t) => t.to_person ?? (t.from === id ? t.to : t.from)), ...w.shared.map((s) => (s.a === id ? s.b : s.a))]).size;
  const description = w.centre.private
    ? `${name} is private: their creator keeps them to themselves.`
    : `Who ${shortName(name)} is closest to on Botchelor, who they're at odds with and where they hang out: ${people} ${people === 1 ? "person" : "people"} across family, friends, work, rivals and the house's gossip.`;
  const meta = pageMetadata({ title: `${name}'s world`, description, path: `/graph/world/${id}`, image: null });
  const thin = w.ties.length < INDEX_MIN_TIES;
  const indexable = !w.centre.private && !thin && (await getDb().then((db) => characterIndexable(db, id)).catch(() => false));
  return indexable ? meta : { ...meta, robots: { index: false, follow: true } };
}

/**
 * A face on the picture: their portrait or their initials on their colour, linked to their own world. `at` is where its
 * name goes (nameLayout), absent when it has none or none fits.
 */
function Face({ m, at }: { m: WorldMember; at?: NamePlace }) {
  if (m.person) {
    return (
      <g className="world-person">
        <circle cx={m.x} cy={m.y} r={m.r} />
        {at && (
          <text x={at.x} y={at.y} textAnchor={at.anchor}>
            {m.name}
          </text>
        )}
      </g>
    );
  }
  if (m.masked || m.private) {
    return (
      <g className="world-private">
        <title>{`${m.name} (private)`}</title>
        <circle cx={m.x} cy={m.y} r={m.r} />
      </g>
    );
  }
  const p = avatarPalette(m.id, m.hue);
  // A small copy at about its drawn size (a desktop draws the picture at about 1.1): the original is a 1–2 MB PNG read
  // from the database on every request, past the CDN, and a world asks for ~100 at once (#1948: it tied up the pool).
  const src = sized(characterPortrait(m.id) ?? m.portrait, m.r * 2 * DRAWN_SCALE);
  const clip = `world-clip-${m.id}`;
  // Names under the closest faces only (the list names everyone; nameLayout leaves off any that would overlap); on a
  // phone, the inner circle's alone, bigger.
  return (
    <a href={`/graph/world/${encodeURIComponent(m.id)}`} className="world-face">
      <title>{`${m.name}: their world`}</title>
      {src ? (
        <>
          <clipPath id={clip}>
            <circle cx={m.x} cy={m.y} r={m.r} />
          </clipPath>
          <circle cx={m.x} cy={m.y} r={m.r} fill={p.from} />
          <image href={src} x={m.x - m.r} y={m.y - m.r} width={m.r * 2} height={m.r * 2} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" />
        </>
      ) : (
        <>
          <circle cx={m.x} cy={m.y} r={m.r} fill={p.from} />
          {m.r >= 14 && (
            <text x={m.x} y={m.y + m.r * 0.32} textAnchor="middle" className="world-initials" style={{ fontSize: m.r * 0.85, fill: p.ink }}>
              {initials(m.name)}
            </text>
          )}
        </>
      )}
      <circle cx={m.x} cy={m.y} r={m.r} className="world-face-ring" />
      {at && (
        <text x={at.x} y={at.y} textAnchor={at.anchor} dominantBaseline="hanging" className={`world-name is-${m.ring}`}>
          {shortName(m.name)}
        </text>
      )}
    </a>
  );
}

/** Their lines with the centre, side by side, each linked to their row in the list below. */
function Lines({ m }: { m: WorldMember }) {
  const e = lineEnds(m);
  const href = `#with-${m.id}`;
  if (m.masked || !m.lines.length) {
    return (
      <a href={href} className="world-tie">
        <line {...e} className="world-line-private" />
      </a>
    );
  }
  const dx = e.x2 - e.x1;
  const dy = e.y2 - e.y1;
  const d = Math.hypot(dx, dy) || 1;
  const [nx, ny] = [-dy / d, dx / d];
  const width = m.ring === "inner" ? 2.4 : m.ring === "close" ? 2 : 1.6;
  const gap = width * 1.9;
  return (
    <a href={href} className="world-tie" aria-label={`${m.name}: what's between them`}>
      <line {...e} className="world-line-hit" />
      {m.lines.map((l, i) => {
        const off = (i - (m.lines.length - 1) / 2) * gap;
        const s = LINE_STYLES[l.s];
        const token = l.v < 0 ? "--social-conflict" : s.token;
        return (
          <line
            key={`${l.g}:${l.k.join("+")}`}
            x1={e.x1 + nx * off}
            y1={e.y1 + ny * off}
            x2={e.x2 + nx * off}
            y2={e.y2 + ny * off}
            style={{ stroke: `var(${token})` }}
            strokeWidth={width}
            strokeLinecap="round"
            strokeDasharray={s.dash.length ? s.dash.map((x) => x * width).join(" ") : undefined}
            opacity={l.e ? 0.45 : "faint" in s && s.faint ? 0.6 : 0.9}
          />
        );
      })}
    </a>
  );
}

function Picture({ pic, label }: { pic: WorldPicture; label: string }) {
  const mid = WORLD_SIZE / 2;
  const c = pic.centre;
  const p = avatarPalette(c.id, c.hue);
  const src = c.private ? null : sized(characterPortrait(c.id) ?? c.portrait, CENTRE_RADIUS * 2 * DRAWN_SCALE);
  // Lines under faces, the outer rings' first, so an inner face is never crossed.
  const outerFirst = [...pic.members].reverse();
  const names = nameLayout(pic.members, (m) => (m.person ? m.name : shortName(m.name)));
  return (
    <svg className="world-sky" viewBox={`0 0 ${WORLD_SIZE} ${WORLD_SIZE}`} role="img" aria-label={label}>
      <defs>
        {pic.places.map((pl) => (
          <path key={pl.key} id={`world-edge-${pl.key.replace(/[^A-Za-z0-9_-]/g, "_")}`} d={labelPath(pl.angle, pl.span)} fill="none" />
        ))}
        <clipPath id="world-clip-centre">
          <circle cx={mid} cy={mid} r={CENTRE_RADIUS} />
        </clipPath>
      </defs>
      {pic.rings.map((r) => (
        <circle key={r.ring} cx={mid} cy={mid} r={r.r} className="world-ring" />
      ))}
      {pic.arcs.map((a) => (
        <path key={a.ring} d={arcPath(a.r, a.from, a.to)} className="world-odds" />
      ))}
      {outerFirst.map((m) => (
        <Lines key={m.id} m={m} />
      ))}
      {outerFirst.map((m) => (
        <Face key={m.id} m={m} at={names.get(m.id)} />
      ))}
      <g className="world-centre">
        <circle cx={mid} cy={mid} r={CENTRE_RADIUS} fill={p.from} />
        {src ? (
          <image href={src} x={mid - CENTRE_RADIUS} y={mid - CENTRE_RADIUS} width={CENTRE_RADIUS * 2} height={CENTRE_RADIUS * 2} clipPath="url(#world-clip-centre)" preserveAspectRatio="xMidYMid slice" />
        ) : (
          <text x={mid} y={mid + CENTRE_RADIUS * 0.3} textAnchor="middle" className="world-initials" style={{ fontSize: CENTRE_RADIUS * 0.8, fill: p.ink }}>
            {c.private ? "🔒" : initials(c.name)}
          </text>
        )}
        <circle cx={mid} cy={mid} r={CENTRE_RADIUS} className="world-face-ring" />
      </g>
      {pic.places.map((pl) => (
        <text key={pl.key} className="world-place">
          <textPath href={`#world-edge-${pl.key.replace(/[^A-Za-z0-9_-]/g, "_")}`} startOffset="50%" textAnchor="middle">
            {pl.words}
          </textPath>
        </text>
      ))}
    </svg>
  );
}

/** What someone is to the centre, in words, tie by tie: "best friend · rival (over)". */
function tieWords(ties: readonly TieView[], centre: string): string {
  return ties
    .map((t) => {
      const def = TIE_KINDS[t.kind];
      const words = def?.directed ? endWords(t.kind, t.from === centre) : (def?.words.to ?? t.kind);
      const count = Number(t.detail?.count);
      return `${words}${Number.isFinite(count) && count > 1 ? ` (${count}×)` : ""}${t.status === "ended" ? " (over)" : ""}`;
    })
    .join(" · ");
}

/** One person in the list: who, what they are to the centre, and what made it. */
function Row({ m, centre, seasons }: { m: WorldMember; centre: string; seasons: ReadonlySet<string> }) {
  const shared = m.shared.map((s) => s.words);
  const evidence = evidenceLinks(m.ties.flatMap((t) => t.evidence), { limit: 3, closedSeasons: seasons });
  const dated = m.ties.some((t) => t.kind === "dated");
  return (
    <li id={`with-${m.id}`} className="world-row">
      {m.person ? (
        <span className="world-row-who">
          <span className="world-person-dot" aria-hidden /> {m.name} <span className="muted small">(off-screen)</span>
        </span>
      ) : m.private ? (
        <span className="world-row-who muted">🔒 {m.name}</span>
      ) : (
        <Link className="world-row-who" href={`/graph/world/${encodeURIComponent(m.id)}`}>
          <Avatar seed={m.id} name={m.name} hue={m.hue} portraitSrc={m.portrait} size={28} decorative round /> {m.name}
        </Link>
      )}
      {m.masked ? (
        <span className="muted small">One of them is private: what&apos;s between them stays between them.</span>
      ) : (
        <span className="small">
          {m.odds && <span className="world-odds-mark" aria-label="at odds" title="At odds">⚔️ </span>}
          {[tieWords(m.ties, centre), ...shared].filter(Boolean).join(" · ")}
          {(evidence.length > 0 || dated) && (
            <span className="world-row-links">
              {dated && !m.private && (
                <Link href={`/couples/${[centre, m.id].sort().join("/")}`} className="tap-link">
                  their story
                </Link>
              )}
              {evidence.map((e) =>
                e.href ? (
                  <Link key={`${e.href}`} href={e.href} className="tap-link">
                    {e.label}
                  </Link>
                ) : (
                  <span key={`${e.label}:${e.at}`} className="muted">
                    {e.label}
                  </span>
                ),
              )}
            </span>
          )}
        </span>
      )}
    </li>
  );
}

/**
 * "X's world" (docs/PRDs/social-network.md section 9, Phase 3; SOCIAL_LENSES): one character in the middle of everyone
 * they're tied to, drawn on the server as SVG, so it's shareable and reads without JavaScript. Dunbar's rings
 * (lib/social/world-picture.ts), whoever they're at odds with on a red arc at the foot, their off-screen people as grey
 * dots, the places they belong to round the edge; every face links to its own world and every line to what's between
 * them in the list below. The public record only (lib/social/cache.ts cachedWorld with no viewer): an owner's own
 * ties stay on the character page. A private character's world is its name and the existence of its public ties, as
 * the Constellation shows them; one that isn't listed (deleted, a persona) is a 404, and so is every world with the
 * views switched off.
 */
export default async function WorldPage({ params }: Props) {
  const { id } = await params;
  const w = await load(id);
  if (!w) notFound();
  const pic = worldPicture(w);
  const c = w.centre;
  const first = shortName(c.name);
  const seasons = new Set(closedSeasons().map((s) => s.id));
  const byRing = (ring: Ring) => pic.members.filter((m) => m.ring === ring && !m.masked);
  const masked = pic.members.filter((m) => m.masked);
  const people = pic.members.filter((m) => m.person);
  const odds = pic.members.filter((m) => m.odds).length;
  const total = pic.members.length + pic.before.length + pic.beyond;
  const label = c.private
    ? `${c.name} is private: ${masked.length} public ${masked.length === 1 ? "tie" : "ties"}, nothing more.`
    : `${c.name}'s world: ${total} ${total === 1 ? "person" : "people"}, ${byRing("inner").length} in the inner circle${odds ? `, at odds with ${odds}` : ""}.`;
  return (
    <article className="world-page page-wide">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "The Constellation", path: "/graph" },
          { name: c.name, path: `/characters/${id}` },
          { name: `${c.name}'s world`, path: `/graph/world/${id}` },
        ])}
      />
      <ShowTabs active="/graph" />
      <header className="world-header">
        <p className="kicker">
          <Link href="/graph">The Constellation</Link> · Their world
        </p>
        <h1>
          {c.private && "🔒 "}
          {c.name}&apos;s world
        </h1>
        <p className="lede">
          {c.private
            ? "Private: their creator keeps them to themselves. The sky shows who they're tied to, and nothing more."
            : total === 0
              ? `Nobody in ${first}'s world yet. Dates, friendships, family, coworkers, rivals and the house's gossip put people here as the show records them.`
              : `Everyone ${first} is tied to, closest in the middle: ${total} ${total === 1 ? "person" : "people"}${odds ? `, ${odds} of them at odds with ${first} (on the red arc)` : ""}. Tap a face for their world, a line for what's between them.`}
        </p>
        <p className="world-links small">
          {!c.private && <Link href={`/characters/${encodeURIComponent(id)}`}>{first}&apos;s card →</Link>}{" "}
          <Link href={`/graph?focus=${encodeURIComponent(id)}`}>See {first} on the sky →</Link>
        </p>
      </header>
      {(pic.members.length > 0 || pic.places.length > 0) && (
        <figure className="world-figure">
          <Picture pic={pic} label={label} />
          <figcaption className="muted small">
            Rings from the middle: the inner circle, close, friends, everyone else · a red arc holds whoever they&apos;re at odds with · grey dots are people off the show
            {pic.places.length ? " · round the edge, where they belong" : ""}
          </figcaption>
        </figure>
      )}
      {(["inner", "close", "friends", "acquaintances"] as const).map((ring) => {
        const list = byRing(ring).filter((m) => !m.person);
        if (!list.length) return null;
        return (
          <section key={ring} className="card world-ring-list" aria-labelledby={`ring-${ring}`}>
            <h2 id={`ring-${ring}`}>
              {RING_TITLE[ring]} <span className="muted small">({list.length})</span>
            </h2>
            <p className="muted small">{RING_HINT[ring]}</p>
            <ul className="list">
              {list.map((m) => (
                <Row key={m.id} m={m} centre={id} seasons={seasons} />
              ))}
            </ul>
          </section>
        );
      })}
      {people.length > 0 && (
        <section className="card world-ring-list" aria-labelledby="ring-people">
          <h2 id="ring-people">Off the show</h2>
          <p className="muted small">People in {first}&apos;s life who aren&apos;t characters on the show.</p>
          <ul className="list">
            {people.map((m) => (
              <Row key={m.id} m={m} centre={id} seasons={seasons} />
            ))}
          </ul>
        </section>
      )}
      {masked.length > 0 && (
        <section className="card world-ring-list" aria-labelledby="ring-private">
          <h2 id="ring-private">Private</h2>
          <ul className="list">
            {masked.map((m) => (
              <Row key={m.id} m={m} centre={id} seasons={seasons} />
            ))}
          </ul>
        </section>
      )}
      {pic.before.length > 0 && (
        <section className="card world-ring-list" aria-labelledby="ring-before">
          <h2 id="ring-before">Before</h2>
          <p className="muted small">Ties that are over: a feud that cleared the air, a friendship that ended.</p>
          <ul className="list">
            {pic.before.map((m) => (
              <Row key={m.id} m={m} centre={id} seasons={seasons} />
            ))}
          </ul>
        </section>
      )}
      {w.memberships.length > 0 && (
        <section className="card world-ring-list" aria-labelledby="ring-places">
          <h2 id="ring-places">Places</h2>
          <ul className="list">
            {w.memberships.map((m) => {
              const place = w.places.find((p) => p.id === m.place_id);
              if (!place) return null;
              const others = w.shared.filter((s) => s.place_id === m.place_id && s.role === m.role).length;
              return (
                <li key={`${m.place_id}:${m.role}`}>
                  {ROLE_WORDS[m.role](place.name)}
                  {m.ended_at ? " (before)" : ""}
                  {others > 0 && <span className="muted small"> · with {others} more on the show</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {pic.beyond > 0 && <p className="muted small">And {pic.beyond} more past the 150 the rings hold.</p>}
    </article>
  );
}
