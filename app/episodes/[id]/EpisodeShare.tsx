import ShareLink from "@/app/ShareLink";
import { blueskyShareUrl, redditShareUrl, SHARE_QUESTION, sharedEpisodePath } from "@/lib/episode-share";

/**
 * Sharing an episode (GROWTH.md, 2026-10-21): Reddit and Bluesky open with the link and words filled in, and Copy link
 * is for Discord and everywhere else. Every one carries ?ref=share, so RepoHQ's beacon counts the visits it brings
 * apart from "direct" (app/funnel.ts). `base` is the site's address (lib/site), so a share never names a preview host.
 */
export default function EpisodeShare({ path, base, names, dateNumber }: { path: string; base: string; names: [string, string]; dateNumber?: number | null }) {
  const shared = sharedEpisodePath(path);
  const url = `${base}${shared}`;
  return (
    <div className="episode-share">
      <ShareLink path={shared} label="Episode link" />
      <p className="share-targets">
        <a className="button-ghost small" href={redditShareUrl(url, names)} target="_blank" rel="noopener noreferrer">
          Share on Reddit
        </a>
        <a className="button-ghost small" href={blueskyShareUrl(url, names, dateNumber)} target="_blank" rel="noopener noreferrer">
          Share on Bluesky
        </a>
      </p>
      <p className="muted small">{`On Reddit, Bluesky or Discord, the link shows a card asking “${SHARE_QUESTION}”`}</p>
    </div>
  );
}
