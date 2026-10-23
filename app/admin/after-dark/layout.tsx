import type { Metadata } from "next";
import type { ReactNode } from "react";
import AfterDarkFrame from "@/app/after-dark/Frame";
import { currentView } from "@/app/after-dark/view";
import { afterDarkMetadata } from "@/lib/adult/discreet";
import "@/app/after-dark/discreet.css";

/**
 * After Dark's admin pages show its content too, so they're labelled adult as well (lib/adult/rating.ts), and take the
 * same discreet mode as After Dark's own pages: the neutral title, the PIN prompt and the blur (app/after-dark/Frame.tsx).
 */
export async function generateMetadata(): Promise<Metadata> {
  return afterDarkMetadata((await currentView()).neutralTitle);
}

export default async function AdminAfterDarkLayout({ children }: { children: ReactNode }) {
  return <AfterDarkFrame view={await currentView()}>{children}</AfterDarkFrame>;
}
