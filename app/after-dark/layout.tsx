import type { Metadata } from "next";
import type { ReactNode } from "react";
import { afterDarkMetadata } from "@/lib/adult/discreet";
import AfterDarkFrame from "./Frame";
import { currentView } from "./view";
import "./discreet.css";

/**
 * Every After Dark page is labelled adult (lib/adult/rating.ts), and while discreet mode's neutral title is on, every tab
 * under it reads "Botchelor" (lib/adult/discreet.ts). Google Analytics stays off here (lib/ga-guard.ts).
 */
export async function generateMetadata(): Promise<Metadata> {
  return afterDarkMetadata((await currentView()).neutralTitle);
}

/** The PIN prompt for a locked device, else the pages inside discreet mode's blur hook (app/after-dark/Frame.tsx). */
export default async function AfterDarkLayout({ children }: { children: ReactNode }) {
  return <AfterDarkFrame view={await currentView()}>{children}</AfterDarkFrame>;
}
