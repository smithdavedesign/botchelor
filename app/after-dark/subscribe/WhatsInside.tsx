import Link from "next/link";
import CastPreview from "@/app/CastPreview";
import { ROLEPLAYS } from "@/lib/adult/roleplays";
import { venueBackdrop } from "@/lib/portraits";
import { DATE_VENUES } from "@/lib/venues";

/** A few of the places a night can be set, with their backdrops (the show's own PG sets). */
const PLACES = ["jazz_bar", "night_beach", "rooftop_bar", "late_bookshop"] as const;
/** A few of the roleplays a chapter can play. */
const PLAYS = ["vampire", "bodyguard", "hotel-mixup", "rivals", "strangers-bar", "photo-shoot"] as const;

/**
 * What After Dark has in it, for someone deciding whether to join (the audit, 2026-10-29: the page was a waitlist whose
 * only taste was a link to Shorts, and there were none, so every visitor met an empty page). Only what's safe to show
 * anyone: the season's cast as the show draws them, the places' empty backdrops, the roleplays' titles, what you get and
 * the privacy it keeps. Never a line of anyone's scene, and never an After Dark picture.
 */
export default function WhatsInside({ shorts, price }: { shorts: number; price: string | null }) {
  const places = PLACES.map((id) => DATE_VENUES.find((v) => v.id === id)).filter((v) => v !== undefined);
  const plays = PLAYS.map((id) => ROLEPLAYS.find((r) => r.id === id)).filter((r) => r !== undefined);
  return (
    <section className="ad-inside" aria-label="What's inside">
      <h2>What&apos;s inside</h2>
      <CastPreview line="This season's cast, and any of your own characters you bring." />
      <h3 className="ad-hub-sub">Set it anywhere, play it any way</h3>
      <ul className="ad-inside-places">
        {places.map((v) => {
          const src = venueBackdrop(v.id);
          return (
            <li key={v.id}>
              {src && (
                // eslint-disable-next-line @next/next/no-img-element -- the show's own reviewed backdrops
                <img src={src} alt="" loading="lazy" />
              )}
              <span className="small">{v.name}</span>
            </li>
          );
        })}
      </ul>
      <p className="ad-inside-plays">
        {plays.map((r) => (
          <span key={r.id} className="chip">
            {r.icon} {r.title}
          </span>
        ))}
        <span className="muted small"> and {ROLEPLAYS.length - plays.length} more, or your own.</span>
      </p>
      <ul className="ad-inside-list">
        <li>
          <strong>Nights that remember.</strong> Pick two of them, set the place and a roleplay, and watch it play out line by line: steer it,
          whisper to one of them, or let it run. Chapters pick up where the last one stopped.
        </li>
        <li>
          <strong>Pictures, video and voices</strong> of the moments you choose, drawn from the faces you set up for them.
        </li>
        <li>
          <strong>The Studio:</strong> private photo shoots of your own characters.
        </li>
        <li>
          <strong>Private by design.</strong> Nothing here is ever shown in the show. Pictures stay blurred until you tap them, the tab can say
          just &ldquo;Botchelor&rdquo;, and a PIN can lock it on your devices.
        </li>
        <li>
          <strong>Two lines that never move:</strong> everyone is a fictional adult, and no real people.
        </li>
      </ul>
      {price && <p className="ad-inside-price">{price} a month when it opens. Cancel any time.</p>}
      {shorts > 0 && (
        <p className="muted small">
          A taste, blurred: <Link href="/after-dark/shorts">the Shorts</Link>, the house cast&apos;s nights as episodes.
        </p>
      )}
    </section>
  );
}
