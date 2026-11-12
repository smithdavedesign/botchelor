import ShareButton from "@/app/ShareButton";
import { blueskyShareUrl, ownerBlueskyShareUrl, ownerRedditShareUrl, ownerSharedPath, redditShareUrl, sharedEpisodePath, wentWellTitle } from "@/lib/episode-share";
import { siteUrl } from "@/lib/site";

/**
 * The share at the moment a date goes well (the 2026-11-11 growth plan: shares existed, but never where the feeling
 * is). Two kinds:
 *  - `owner_well`: the owner's, under "they both want a second date". Its words name the good news and its link asks
 *    for the ending card (lib/episode-share.ts ownerSharedPath; David's call: an owner may say so once it has aired).
 *    Tagged ref=owner, so these visitors are the source owner_share.
 *  - `viewer`: anyone's, on the theater's end screen. Spoiler-free as every viewer share is (ref=share).
 * Pure render around ShareButton; the names and date number are what the page already has.
 */
export default function ShareEnding({ episodeId, names, dateNumber, kind }: { episodeId: string; names: [string, string]; dateNumber?: number | null; kind: "owner_well" | "viewer" }) {
  const page = `/episodes/${encodeURIComponent(episodeId)}`;
  const path = kind === "owner_well" ? ownerSharedPath(page) : sharedEpisodePath(page);
  const url = `${siteUrl()}${path}`;
  const targets =
    kind === "owner_well"
      ? [
          { label: "Reddit", href: ownerRedditShareUrl(url, names, dateNumber) },
          { label: "Bluesky", href: ownerBlueskyShareUrl(url, names, dateNumber) },
        ]
      : [
          { label: "Reddit", href: redditShareUrl(url, names) },
          { label: "Bluesky", href: blueskyShareUrl(url, names, dateNumber) },
        ];
  return (
    <p className="share-ending notice" data-share-ending={kind}>
      {kind === "owner_well" ? (
        <>
          <strong>{wentWellTitle(names, dateNumber)}</strong> Tell someone: the link opens on their date, with the good news on its card.{" "}
        </>
      ) : (
        <>Know someone who&apos;d call it differently? </>
      )}
      <ShareButton path={path} title={kind === "owner_well" ? wentWellTitle(names, dateNumber) : `${names[0]} × ${names[1]} on Botchelor`} targets={targets} track="share-ending" label={kind === "owner_well" ? "💘 Share the good news" : "🔗 Share this date"} />
    </p>
  );
}
