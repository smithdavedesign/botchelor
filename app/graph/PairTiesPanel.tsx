"use client";

import { useEffect, useState } from "react";
import { closedSeasons } from "@/lib/season-ref";
import type { PairTies } from "@/lib/social/types";
import PairTiesCard from "./PairTiesCard";

/**
 * Everything between a pair, in the Constellation's side panel (docs/PRDs/social-network.md section 9's pair panel):
 * fetched from /api/social/pair/[a]/[b] when the pair is opened, so none of it is in /graph's first load. Nothing while
 * it loads or when there's nothing to add (a 404: no ties, or a private character's pair), so a pair that only dated
 * keeps Love's panel as it was.
 */
export default function PairTiesPanel({ a, b, skipDated = false }: { a: string; b: string; skipDated?: boolean }) {
  const key = `${a}~${b}`;
  const [got, setGot] = useState<{ key: string; data: PairTies | null } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/social/pair/${encodeURIComponent(a)}/${encodeURIComponent(b)}`)
      .then((r) => (r.ok ? (r.json() as Promise<PairTies>) : null))
      .catch(() => null)
      .then((data) => {
        if (live) setGot({ key, data });
      });
    return () => {
      live = false;
    };
  }, [a, b, key]);
  if (got?.key !== key || !got.data) return null;
  return <PairTiesCard pair={got.data} closedSeasons={new Set(closedSeasons().map((s) => s.id))} skipDated={skipDated} />;
}
