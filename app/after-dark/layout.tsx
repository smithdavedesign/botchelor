import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { afterDarkMetadata } from "@/lib/adult/discreet";
import AfterDarkFrame from "./Frame";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { tasteLeft } from "@/lib/adult/taste";
import { ageCheckOffer } from "@/lib/adult/age-check";
import Unavailable from "./Unavailable";
import VerifyAge from "./VerifyAge";
import { currentHere, currentView } from "./view";
import Threshold from "@/app/Threshold";
import { adRollout } from "@/lib/adult/door";
import { rolloutOn } from "@/lib/adult/rollout";
import "./discreet.css";

/**
 * Every After Dark page is labelled adult (lib/adult/rating.ts), and while discreet mode's neutral title is on, every tab
 * under it reads "Botchelor" (lib/adult/discreet.ts). Google Analytics stays off here (lib/ga-guard.ts).
 */
export async function generateMetadata(): Promise<Metadata> {
  return afterDarkMetadata((await currentView()).neutralTitle);
}

/**
 * The PIN prompt for a locked device, else the pages inside discreet mode's blur hook (app/after-dark/Frame.tsx). Where
 * After Dark isn't offered (lib/jurisdiction.ts) every page under it is the same notice instead, for everyone but admins;
 * where it's text only, a line says so above the page.
 */
export default async function AfterDarkLayout({ children }: { children: ReactNode }) {
  const here = await currentHere();
  // Someone it isn't open to gets the same not-found as anywhere else (nothing says After Dark exists); someone it is
  // open to is told why it won't open here.
  // Where an age check would open it (lib/adult/age-check.ts, off until Didit is set up), the notice offers one, also to
  // a signed-in person who isn't in yet but could start a taste, ask for an invite or subscribe once it opens.
  const verify = here.mode === "open" ? null : await ageCheckOffer(await getDb(), here);
  if (here.mode === "blocked") {
    if (!here.entitled.ok && !verify) notFound();
    return <Unavailable reason={here.reason} verify={verify} />;
  }
  // A free taste (lib/adult/taste.ts) says what's left of it on every page, and where to carry on.
  const taste = here.entitled.ok && here.entitled.why === "taste" && here.userId ? await tasteLeft(await getDb(), here.userId) : null;
  // The arrival screen, once a session (app/Threshold.tsx): admins while the public door is on admins only, then everyone.
  const threshold = rolloutOn(await adRollout(), "public_door", here.admin);
  return (
    <AfterDarkFrame view={await currentView()}>
      {threshold && <Threshold side="after-dark" />}
      {taste && (
        <p className="muted small ad-text-only" data-taste-notice>
          Free taste: {taste.steps} scene step{taste.steps === 1 ? "" : "s"} left, until{" "}
          {taste.ends.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" })}.
          Pictures, video and voice come with the <Link href="/after-dark/subscribe">subscription</Link>.
        </p>
      )}
      {here.mode === "text_only" && (
        <p className="muted small ad-text-only" data-text-only-notice>
          {here.reason}
        </p>
      )}
      {here.mode === "text_only" && verify && <VerifyAge failed={verify === "failed"} opens="media" />}
      {children}
    </AfterDarkFrame>
  );
}
