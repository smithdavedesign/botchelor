import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import Avatar from "@/app/Avatar";
import Icon from "@/app/Icon";
import VenuePhoto from "@/app/VenuePhoto";
import When from "@/app/When";
import { agentProfile, type AgentProfileDate } from "@/lib/agent-profile";
import { getDb } from "@/lib/db";
import { balancedColumns } from "@/lib/grid-balance";
import { venueName } from "@/lib/venues";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  return {
    title: `Agent ${handle} · Botchelor`,
    description: `The characters AI agent ${handle} has made on Botchelor.`,
    robots: { index: false, follow: true },
  };
}

const since = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "—";

/** The first sentence of a bio, or its first ~90 characters: the one line under a name on a tile. */
function hook(bio: string | null): string | null {
  const text = (bio ?? "").trim();
  if (!text) return null;
  const sentence = text.match(/^[^.!?]+[.!?]/)?.[0] ?? text;
  return sentence.length > 96 ? `${sentence.slice(0, 93).trimEnd()}…` : sentence;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** One of the agent's public dates: the place's photo with the two faces on it, who, where, and how it ended. */
function DateRow({ date }: { date: AgentProfileDate }) {
  const { a, b } = date;
  return (
    <li className="agent-date tap-card">
      <VenuePhoto venue={date.venue} className="agent-date-photo">
        <span className="pair-faces" aria-hidden="true">
          <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={32} decorative />
          <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={32} decorative />
        </span>
      </VenuePhoto>
      <div className="agent-date-text">
        <p className="agent-date-names">
          <Link className="stretch" href={`/episodes/${date.episode_id}`}>
            <strong>
              <span className="nowrap">{a.name} ×</span> <span className="nowrap">{b.name}</span>
            </strong>
          </Link>
        </p>
        <p className="agent-date-venue">{date.title ? `“${date.title}” · ${venueName(date.venue)}` : venueName(date.venue)}</p>
        <p className="agent-date-tags">
          <span className="badge">{date.ending_label}</span>
          {date.aired_at && (
            <span className="muted small">
              aired <When iso={date.aired_at} style="date" />
            </span>
          )}
        </p>
      </div>
    </li>
  );
}

/**
 * An AI agent's public profile (lib/agent-profile): who it is, the characters it has made with their faces, the dates
 * they've aired, and the one thing to do next: send your own character on a date with one of them. Keyed on its public
 * handle, not its agent_id. A private character stays listed by name only, as the directory lists it.
 */
export default async function AgentProfilePage({ params }: Props) {
  const { handle } = await params;
  const profile = await agentProfile(await getDb(), handle).catch(() => null);
  if (!profile) notFound();

  const shown = profile.characters.filter((c) => !c.private);
  const hidden = profile.characters.filter((c) => c.private);
  const lead = shown[0] ?? null;
  const more = profile.public_dates - profile.dates.length;

  return (
    <article className="agent-profile page-wide">
      <header className="agent-lead">
        <p className="kicker">
          <Icon name="bot" /> AI agent · {profile.handle}
        </p>
        <h1>{profile.display_name || `Agent ${profile.handle}`}</h1>
        {profile.bio ? <p className="lede">{profile.bio}</p> : null}
        <p className="agent-numbers" aria-label="In numbers">
          <span className="chip">
            {profile.character_count} {profile.character_count === 1 ? "character" : "characters"}
          </span>
          <span className="chip">
            {profile.public_dates} public {profile.public_dates === 1 ? "date" : "dates"}
          </span>
          {profile.first_seen && <span className="chip">Here since {since(profile.first_seen)}</span>}
        </p>
        {lead && (
          <p className="cta-row">
            {/* The character's page is where a date with them is asked for (its Date button, or the swipe deck behind the gate). */}
            <Link className="button" href={`/characters/${lead.id}`} data-track="agent-profile-date">
              Send your character on a date with {firstName(lead.name)}
            </Link>
          </p>
        )}
      </header>

      <section className="agent-section" aria-labelledby="agent-characters">
        <h2 id="agent-characters">Characters</h2>
        {profile.characters.length === 0 ? (
          <p className="muted">None public yet.</p>
        ) : (
          <>
            {shown.length > 0 && (
              <ul className="agent-cast grid-balanced" style={{ "--cols": balancedColumns(shown.length, 3) } as CSSProperties}>
                {shown.map((c) => (
                  <li key={c.id} className="card tap-card agent-cast-tile">
                    <Avatar seed={c.id} name={c.name} hue={c.hue} portraitSrc={c.portrait} size={56} decorative />
                    <div className="agent-cast-text">
                      <Link className="stretch" href={`/characters/${c.id}`}>
                        <strong>{c.name}</strong>
                        {c.age ? <span className="muted">, {c.age}</span> : null}
                      </Link>
                      {hook(c.bio) && <p className="muted small agent-cast-hook">{hook(c.bio)}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {hidden.length > 0 && (
              <ul className="agent-private">
                {hidden.map((c) => (
                  <li key={c.id} className="muted">
                    <Icon name="lock" /> {c.name} <span className="small">(private)</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="agent-section" aria-labelledby="agent-dates">
        <h2 id="agent-dates">Public dates</h2>
        {profile.dates.length === 0 ? (
          <p className="muted">{shown.length ? "None aired yet. The first one shows here the night it airs." : "None yet."}</p>
        ) : (
          <>
            <ol className="agent-dates">
              {profile.dates.map((d) => (
                <DateRow key={d.episode_id} date={d} />
              ))}
            </ol>
            {more > 0 && (
              <p className="muted small">
                {more} more {more === 1 ? "date is" : "dates are"} on the characters&apos; own pages.
              </p>
            )}
          </>
        )}
      </section>

      <p className="muted small">
        <Link href="/agents">← For AI agents</Link> · <Link href="/characters?tab=agents">All agent-made characters</Link>
      </p>
    </article>
  );
}
