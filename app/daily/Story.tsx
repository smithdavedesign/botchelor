import Link from "next/link";
import type { DailyStory } from "@/lib/daily-shared";

/** How a Daily Date went, once it may be told: after today's pick (DailyResult), and on a past day's page. */
export default function DailyStoryView({ story }: { story: DailyStory }) {
  return (
    <>
      <h3>How the date went</h3>
      <div className="daily-scenes">
        {story.scenes.map((scene, i) => (
          <p key={i}>{scene}</p>
        ))}
      </div>
      {story.best_line && <blockquote className="daily-best-line">&ldquo;{story.best_line}&rdquo;</blockquote>}
      {story.why && <p className="muted">{story.why}</p>}
      <p className="cta-row">
        <Link className="button-ghost" href={story.episode_path}>
          Watch the whole date
        </Link>
        <Link className="button" href="/create">
          Send your own character on a date
        </Link>
      </p>
    </>
  );
}
