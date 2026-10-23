import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ADULT_RATING_META } from "@/lib/adult/rating";

/** Every After Dark page is labelled adult (lib/adult/rating.ts). Google Analytics stays off here (lib/ga-guard.ts). */
export const metadata: Metadata = { other: ADULT_RATING_META };

export default function AfterDarkLayout({ children }: { children: ReactNode }) {
  return children;
}
