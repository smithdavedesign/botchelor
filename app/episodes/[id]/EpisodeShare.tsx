import ShareButton from "@/app/ShareButton";
import { blueskyShareUrl, redditShareUrl, SHARE_QUESTION, sharedEpisodePath } from "@/lib/episode-share";

/**
 * Sharing an episode (GROWTH.md, 2026-10-21): Reddit and Bluesky open with the link and words filled in, and Copy link
 * is for Discord and everywhere else. Every one carries ?ref=share, so RepoHQ's beacon counts the visits it brings
 * apart from "direct" (app/funnel.ts). `base` is the site's address (lib/site), so a share never names a preview host.
 */
export default function EpisodeShare({ path, base, names, dateNumber }: { path: string; base: string; names: [string, string]; dateNumber?: number | null }) {
  const shared = sharedEpisodePath(path);
  const url = `${base}${shared}`;
  // One button (2026-10-31 UX audit, D3): the share sheet on a phone, else Copy link, Reddit and Bluesky in a popover.
  return (
    <p className="episode-share">
      <ShareButton
        path={shared}
        title={`${names[0]} × ${names[1]} on Botchelor`}
        label="🔗 Share this date"
        field="Episode link"
        targets={[
          { label: "Reddit", href: redditShareUrl(url, names) },
          { label: "Bluesky", href: blueskyShareUrl(url, names, dateNumber) },
        ]}
        note={`The link shows a card asking “${SHARE_QUESTION}”`}
      />
    </p>
  );
}
