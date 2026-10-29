"use client";

import Link from "next/link";
import { useState } from "react";
import { requestJson } from "@/app/request";
import type { Media } from "@/lib/adult/media";

/**
 * 👕 SFW twin (lib/adult/sfw-twin.ts): this picture made again safe for work, the same people, place and light, for a
 * public post. A picture of their own character alone lands in the PG Studio's gallery (said, with the way there); one
 * of two stays here, rated pg, and joins the gallery.
 */
export default function SfwTwin({ id, price, onAdded }: { id: string; price?: string; onAdded?: (m: Media) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ pg: string | null } | null>(null);

  async function make() {
    setBusy(true);
    setError(null);
    const res = await requestJson("/api/admin/after-dark/sfw-twin", { media_id: id }, "POST", { timeoutMs: 290_000 }).catch(() => null);
    setBusy(false);
    if (!res) return setError("That didn't reach the server. Try again.");
    if (!res.ok) return setError(res.message);
    if (res.data.where === "pg") return setDone({ pg: String(res.data.character_id) });
    onAdded?.(res.data.picture as Media);
    setDone({ pg: null });
  }

  if (done) {
    return (
      <p className="small" role="status">
        👕 Its SFW twin is made{done.pg ? (
          <>
            : it&apos;s in the <Link href={`/characters/${done.pg}/studio`}>PG Studio</Link>, ready to post or use as a profile picture.
          </>
        ) : (
          ", rated PG, in the gallery."
        )}
      </p>
    );
  }
  return (
    <div className="ad-fix">
      <button type="button" className="button-ghost small" disabled={busy} onClick={() => void make()} title="The same picture, safe for work: everyone dressed, an everyday pose">
        {busy ? "Dressing them… about a minute" : `👕 SFW twin${price ? ` · ${price}` : ""}`}
      </button>
      {error && (
        <p className="error small" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
