import Link from "next/link";
import Avatar from "@/app/Avatar";
import FaceLoop from "@/app/FaceLoop";

type Lead = { id: string; name: string; hue: number | null; house: boolean; portrait: string | null };

/**
 * The lead of a season, large, beside the words on a season's hero (app/seasons/page.tsx, SeasonLive.tsx): their
 * portrait at a poster's size, a line that says whose season it is, and their name, which links to their page. The
 * picture is decorative (the link names them); it loads lazily, so the set behind stays the hero's one eager picture.
 */
export default function SeasonLeadFace({ lead, kicker }: { lead: Lead; kicker: string }) {
  return (
    <figure className="season-lead-face">
      {/* Their face, moving while on screen where they have a loop (app/FaceLoop.tsx; the tall cut, the portrait's frame). */}
      <FaceLoop id={lead.id} fill shape="tall">
        <Avatar seed={lead.id} name={lead.name} hue={lead.hue} house={lead.house} portraitSrc={lead.portrait} size={480} fill decorative />
      </FaceLoop>
      <figcaption>
        <span className="kicker">{kicker}</span>
        <Link href={`/characters/${lead.id}`} data-track="season-lead-face">
          {lead.name}
        </Link>
      </figcaption>
    </figure>
  );
}
