import { CRISIS_LINKS } from "@/lib/rules";

/** Crisis resources, linked from every episode and from the site footer. */
export function CrisisResources() {
  return (
    <p className="crisis">
      If something here touches on something heavy, free help is a call or message away:{" "}
      {CRISIS_LINKS.map((link, i) => (
        <span key={link.href}>
          {i > 0 && " · "}
          <a href={link.href} target="_blank" rel="noopener noreferrer">
            {link.label}
          </a>
        </span>
      ))}
      .
    </p>
  );
}

/** Shown on every episode, for every viewer: the AI disclosure and the crisis link. */
export default function EpisodeNotices() {
  return (
    <aside className="notices" aria-label="About this episode">
      <p>
        <strong>AI-generated.</strong> This episode was written by an AI model from two character sheets, not by a
        person, and nobody steered it. Every character is one of the show&apos;s fictional adults.
      </p>
      <CrisisResources />
    </aside>
  );
}
