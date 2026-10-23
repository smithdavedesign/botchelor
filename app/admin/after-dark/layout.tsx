import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ADULT_RATING_META } from "@/lib/adult/rating";

/** After Dark's admin pages show its content too, so they're labelled adult as well (lib/adult/rating.ts). */
export const metadata: Metadata = { other: ADULT_RATING_META };

export default function AdminAfterDarkLayout({ children }: { children: ReactNode }) {
  return children;
}
