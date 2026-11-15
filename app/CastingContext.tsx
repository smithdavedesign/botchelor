"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Open casting for client components (lib/casting.ts castingLead): who a new character's first date goes to right now,
 * handed down from the page that read it, so the builder's send card needs no prop of its own. Null (the default)
 * whenever casting is closed, and everything reads as it did before.
 */
export type CastingForClient = {
  phase: "season" | "preseason";
  /** "this season's Botchelor" or "December's Botchelor" (lib/casting.ts leadBilling). */
  billing: string;
  lead: { id: string; name: string; hue: number | null; portrait: string | null };
  /** The hour (UTC) Sunday's roses are handed out. */
  hour: number;
};

const CastingContext = createContext<CastingForClient | null>(null);

export function CastingProvider({ value, children }: { value: CastingForClient | null; children: ReactNode }) {
  return <CastingContext.Provider value={value}>{children}</CastingContext.Provider>;
}

export const useCasting = (): CastingForClient | null => useContext(CastingContext);
