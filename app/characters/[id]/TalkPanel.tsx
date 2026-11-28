import Link from "next/link";
import type { ReactNode } from "react";
import Avatar from "@/app/Avatar";
import type { CharacterTalk } from "@/lib/character-talk";
import { fillNodes } from "@/app/fillNodes";
import { english, type T } from "@/lib/i18n/translate";

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
  /** The page's language (docs/i18n.md). */
  t?: T;
};

/**
 * Talk of the house (lib/character-talk.ts): what was said about them, who they fell out with and who is after them,
 * each row linking to the scene, the couple or the line behind it. Only what /house, the producer's daily line and the
 * public graph already show a stranger; it renders in one pass from what the page read (no reads of its own).
 */
export default function TalkPanel({ name, talk, verb, children, t = english }: Props) {
  return (
    <>
      <section className="card character-talk" id="talk" aria-labelledby="talk-title" data-track-area="character-talk">
        <h2 id="talk-title">{t("Talk of the house")}</h2>
        {talk.empty ? (
          <div className="talk-empty">
            <p className="muted">{t("Nobody in the house is talking about {name} yet; that starts when one of their dates airs.", { name })}</p>
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
                <h3>{t("Said about {name}", { name })}</h3>
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
                            {t("See the scene")}
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
                <h3>{t("Friction")}</h3>
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
                          {f.kind === "bad_blood" || f.kind === "breakup" ? t("See them together") : f.kind === "story" ? t("In the house") : t("See the scene")}
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {talk.after.length > 0 && (
              <div className="talk-part">
                <h3>{t("Who's after whom")}</h3>
                <ul className="list talk-list">
                  {talk.after.map((a) => (
                    <li key={a.key} className="row-2line">
                      <span className="row-2line-head">
                        <span aria-hidden="true">{a.direction === "both" ? "💞" : "👀"}</span>
                        {a.direction === "them" ? (
                          <span>
                            {fillNodes(t("{other} is after {name}", { name }), { other: <Link href={`/characters/${a.other.id}`}>{a.other.name}</Link> })}
                          </span>
                        ) : a.direction === "theirs" ? (
                          <span>
                            {fillNodes(t("{name} is after {other}", { name }), { other: <Link href={`/characters/${a.other.id}`}>{a.other.name}</Link> })}
                          </span>
                        ) : (
                          <span>
                            {fillNodes(t("With {other}"), { other: <Link href={`/characters/${a.other.id}`}>{a.other.name}</Link> })}
                          </span>
                        )}
                      </span>
                      <span className="muted row-2line-meta">
                        {a.text} {a.day && <>{dayWords(a.day)} · </>}
                        <Link href={a.href} data-track="character-talk" data-track-where={a.direction === "both" ? "couple" : "line"}>
                          {a.direction === "both" ? t("See them together") : t("In the house")}
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
          {t("From the house's public scenes, the show's daily line and aired dates.")} <Link href="/house">{t("The house")} →</Link>
        </p>
      </section>
      {children}
    </>
  );
}
