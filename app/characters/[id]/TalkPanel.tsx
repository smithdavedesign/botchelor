import Link from "next/link";
import type { ReactNode } from "react";
import Avatar from "@/app/Avatar";
import type { CharacterTalk } from "@/lib/character-talk";

/** "2026-11-14" as "Nov 14": the day a line was said or a scene played. */
const dayWords = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

type Props = {
  /** The character's first name. */
  name: string;
  talk: CharacterTalk;
  /** The page's own verb (lib/character-verb.ts), repeated under the empty line so a quiet page still has something to do. */
  verb?: { label: string; href: string; track: string } | null;
  /** The reviews fold, under the talk. */
  children?: ReactNode;
};

/**
 * Talk of the house (lib/character-talk.ts): what was said about them, who they fell out with and who is after them,
 * each row linking to the scene, the couple or the line behind it. Only what /house, the producer's daily line and the
 * public graph already show a stranger; it renders in one pass from what the page read (no reads of its own).
 */
export default function TalkPanel({ name, talk, verb, children }: Props) {
  return (
    <>
      <section className="card character-talk" id="talk" aria-labelledby="talk-title" data-track-area="character-talk">
        <h2 id="talk-title">Talk of the house</h2>
        {talk.empty ? (
          <div className="talk-empty">
            <p className="muted">Nobody in the house is talking about {name} yet; that starts when one of their dates airs.</p>
            {verb && (
              <p>
                <Link className="button secondary" href={verb.href} data-track={verb.track} data-track-from="character-talk">
                  {verb.label}
                </Link>
              </p>
            )}
          </div>
        ) : (
          <>
            {talk.said.length > 0 && (
              <div className="talk-part">
                <h3>Said about {name}</h3>
                <ol className="cast-chat-thread talk-said">
                  {talk.said.map((l) => (
                    <li key={l.key} className="cast-chat-line">
                      <Link href={`/characters/${l.speaker.id}`} className="cast-chat-face" aria-label={l.speaker.name}>
                        <Avatar seed={l.speaker.id} name={l.speaker.name} hue={l.speaker.hue} house={l.speaker.house} size={36} portraitSrc={l.speaker.portrait} decorative />
                      </Link>
                      <div className="cast-chat-bubble">
                        <span className="cast-chat-name">{l.speaker.name}</span>
                        <span>{l.text}</span>
                        <span className="muted small talk-where">
                          {l.where.charAt(0).toUpperCase() + l.where.slice(1)} · {dayWords(l.day)} ·{" "}
                          <Link href={l.href} data-track="character-talk" data-track-where="scene">
                            See the scene
                          </Link>
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {talk.friction.length > 0 && (
              <div className="talk-part">
                <h3>Friction</h3>
                <ul className="list talk-list">
                  {talk.friction.map((f) => (
                    <li key={f.key} className="row-2line">
                      <span className="row-2line-head">
                        <span aria-hidden="true">{f.kind === "challenge" ? "🏆" : f.kind === "bad_blood" ? "🔥" : f.kind === "breakup" ? "💔" : "⚡"}</span>
                        <span>
                          {f.text}
                          {f.result && <strong> {f.result}</strong>}
                        </span>
                      </span>
                      <span className="muted row-2line-meta">
                        {f.day && <>{dayWords(f.day)} · </>}
                        <Link href={f.href} data-track="character-talk" data-track-where={f.kind}>
                          {f.kind === "bad_blood" || f.kind === "breakup" ? "See them together" : f.kind === "story" ? "In the house" : "See the scene"}
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {talk.after.length > 0 && (
              <div className="talk-part">
                <h3>Who&apos;s after whom</h3>
                <ul className="list talk-list">
                  {talk.after.map((a) => (
                    <li key={a.key} className="row-2line">
                      <span className="row-2line-head">
                        <span aria-hidden="true">{a.direction === "both" ? "💞" : "👀"}</span>
                        {a.direction === "them" ? (
                          <span>
                            <Link href={`/characters/${a.other.id}`}>{a.other.name}</Link> is after {name}
                          </span>
                        ) : a.direction === "theirs" ? (
                          <span>
                            {name} is after <Link href={`/characters/${a.other.id}`}>{a.other.name}</Link>
                          </span>
                        ) : (
                          <span>
                            With <Link href={`/characters/${a.other.id}`}>{a.other.name}</Link>
                          </span>
                        )}
                      </span>
                      <span className="muted row-2line-meta">
                        {a.text} {a.day && <>{dayWords(a.day)} · </>}
                        <Link href={a.href} data-track="character-talk" data-track-where={a.direction === "both" ? "couple" : "line"}>
                          {a.direction === "both" ? "See them together" : "In the house"}
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        <p className="muted small talk-foot">
          From the house&apos;s public scenes, the show&apos;s daily line and aired dates. <Link href="/house">The house →</Link>
        </p>
      </section>
      {children}
    </>
  );
}
