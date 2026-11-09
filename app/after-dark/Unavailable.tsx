import Link from "next/link";
import { siteUrl } from "@/lib/site";
import VerifyAge from "./VerifyAge";

/**
 * What After Dark's pages show where it isn't offered (lib/jurisdiction.ts): why, in a sentence, and the way back to the
 * show, which is the same everywhere. No scenes, no subscribing and no teasers here. Where an age check would open it
 * (lib/adult/age-check.ts ageCheckOffer), the way to take one.
 */
export default function Unavailable({ reason, verify = null }: { reason: string | null; verify?: "offer" | "failed" | null }) {
  return (
    <div className="after-dark-mode">
      <article className="after-dark" data-after-dark-unavailable>
        <p className="kicker">🌙 After Dark</p>
        <h1>Not available where you are</h1>
        <p>{reason ?? "After Dark isn't offered where you're connecting from."}</p>
        {verify && <VerifyAge failed={verify === "failed"} opens="all" />}
        <p className="muted small">
          The rules follow the law where you connect from. Getting around them (with a VPN, say) breaks our <Link href={`${siteUrl()}/terms`}>terms</Link>.
        </p>
        <p>
          <Link className="button" href={siteUrl()}>
            Back to the show
          </Link>
        </p>
      </article>
    </div>
  );
}
