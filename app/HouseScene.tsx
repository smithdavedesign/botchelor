import Link from "next/link";
import Avatar from "./Avatar";
import ReportScene from "./house/ReportScene";
import type { HouseSceneView } from "@/lib/house-scenes";

const dayWords = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * One scene from the show's house (lib/house-scenes.ts), as a transcript with the cast's faces: where it is, who is
 * in it, which aired date they are talking about, and the lines. Only ever about what has aired. A confrontation or
 * a challenge (lib/house-conflict.ts) is headed by who is in it and closes on its result. `lead`: today's
 * scene on /house, with the page's h1 above it, so its heading is an h2 either way; an earlier scene is quieter.
 */
export default function HouseScene({ scene, lead = false, report = true }: { scene: HouseSceneView; lead?: boolean; report?: boolean }) {
  const headId = `scene-head-${scene.id}`;
  // A conversation, not a list (David 2026-11-17): each voice keeps a side, by the order they first speak in: the
  // first on the left, the second on the right, a third (a challenge can have more) back on the left, and so on.
  const voices = [...new Set(scene.lines.map((l) => l.id))];
  return (
    <section id={`scene-${scene.id}`} className={`card house-scene${lead ? " house-scene-lead" : ""}`} aria-labelledby={headId} data-track-area="house-scene">
      <p className="kicker">
        {scene.code ? `${scene.code.replace("S", "Season ").replace(" · ", ", ")} · ` : ""}
        {dayWords(scene.day)}
      </p>
      <h2 id={headId}>
        {scene.result?.kind === "confrontation"
          ? `${scene.result.a} and ${scene.result.b} have it out`
          : scene.result?.kind === "challenge"
            ? scene.result.title
            : capital(scene.place.label)}
      </h2>
      <p className="muted small house-scene-about">
        {scene.result ? `${capital(scene.place.at)}, ${scene.place.when}.` : `${capital(scene.place.when)}.`}{" "}
        {scene.about.length > 0 && (
          <>
            On the table:{" "}
            {scene.about.map((d, i) => (
              <span key={d.episode_id}>
                {i > 0 && " and "}
                <Link href={`/episodes/${d.episode_id}`} data-track="house-scene" data-track-where="date">
                  {d.a.split(/\s+/)[0]} and {d.b.split(/\s+/)[0]}&apos;s date
                </Link>
              </span>
            ))}
            .
          </>
        )}
      </p>
      <ol className="cast-chat-thread house-lines">
        {scene.lines.map((l) => (
          <li key={l.n} className={`cast-chat-line${voices.indexOf(l.id) % 2 === 1 ? " is-right" : ""}`}>
            <Link href={`/characters/${l.id}`} className="cast-chat-face" data-track="house-scene" data-track-where="face" aria-label={l.name}>
              <Avatar seed={l.id} name={l.name} hue={l.hue} house={l.house} size={lead ? 44 : 36} portraitSrc={l.portrait} decorative />
            </Link>
            <div className="cast-chat-bubble">
              <span className="cast-chat-name">{l.name}</span>
              <span>{l.text}</span>
            </div>
          </li>
        ))}
      </ol>
      {/* How it came out (lib/house-conflict.ts): decided by the show's rules before a line was written, never by a vote. */}
      {scene.result?.kind === "confrontation" && (
        <p className="house-result">
          <strong>How it ended:</strong> {scene.result.label.charAt(0).toLowerCase() + scene.result.label.slice(1)}.
        </p>
      )}
      {scene.result?.kind === "challenge" && (
        <p className="house-result">
          <span aria-hidden="true">🏆</span> <Link href={`/characters/${scene.result.winner.id}`}>{scene.result.winner.name}</Link> won. <strong>The prize:</strong> {scene.result.prize}.
        </p>
      )}
      {report && <ReportScene sceneId={scene.id} lines={scene.lines.map((l) => ({ n: l.n, name: l.name, text: l.text }))} />}
    </section>
  );
}
