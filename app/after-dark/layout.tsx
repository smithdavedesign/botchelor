import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { afterDarkMetadata } from "@/lib/adult/discreet";
import AfterDarkFrame from "./Frame";
import Unavailable from "./Unavailable";
import { currentHere, currentView } from "./view";
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
  if (here.mode === "blocked") {
    if (!here.entitled.ok) notFound();
    return <Unavailable reason={here.reason} />;
  }
  return (
    <AfterDarkFrame view={await currentView()}>
      {here.mode === "text_only" && (
        <p className="muted small ad-text-only" data-text-only-notice>
          {here.reason}
        </p>
      )}
      {children}
    </AfterDarkFrame>
  );
}
