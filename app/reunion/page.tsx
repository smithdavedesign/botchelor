import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The Reunion moved into the feed (Episodes & leagues), where it sits with the season's episodes and league
 * boards. This route stays as a permanent (308) redirect so old links and share cards still land somewhere real.
 */
export default function ReunionPage(): never {
  permanentRedirect("/feed");
}
