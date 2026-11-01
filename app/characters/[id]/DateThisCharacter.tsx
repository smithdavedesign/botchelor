"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/app/request";
import RoleplayPicker, { choiceReady, roleplayFields, type RoleplayChoice } from "@/app/RoleplayPicker";
import type { DateCta } from "@/lib/date-cta";
import { shortName } from "@/lib/names";
import { takenNote } from "@/lib/partners-shared";

/**
 * "Date this character", right under the contestant header (lib/date-cta.ts says which version shows). Sending one of
 * yours books it like any date (POST /api/episodes, 1 token) and opens it as it's filmed; one that has to match first
 * goes to the swipe deck instead. `roleplays`: a house character, so a roleplay can be added and plays at once
 * (lib/date-roleplays.ts); with anyone else's, the two creators agree one on the couple page first.
 */
export default function DateThisCharacter({
  cta,
  targetId,
  first,
  roleplays = false,
  signedIn = false,
}: {
  cta: DateCta;
  targetId: string;
  first: string;
  roleplays?: boolean;
  /** For the roleplay picker's ✨ Yours (the Create library, accounts only). */
  signedIn?: boolean;
}) {
  const router = useRouter();
  const mine = cta.kind === "send" ? cta.mine : [];
  // One that's free to go first (a taken one, with someone else and wanting only them, is listed but can't go).
  const [pick, setPick] = useState((mine.find((m) => !m.taken) ?? mine[0])?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; shop?: boolean } | null>(null);
  // David, 2026-10-23: the booker may say where the date happens (else a texted plan, else the show picks).
  const [place, setPlace] = useState("");
  const [roleplay, setRoleplay] = useState<RoleplayChoice | null>(null);
  // The picker mounts once it's opened, not in every character page's HTML.
  const [roleplayOpen, setRoleplayOpen] = useState(false);

  if (cta.kind === "none") return null;
  if (cta.kind === "closed") {
    return (
      <p className="date-cta date-cta-closed muted" role="note">
        💤 {cta.reason} <Link href="/characters">See everyone on the show →</Link>
      </p>
    );
  }
  if (cta.kind === "make") {
    return (
      <div className="date-cta">
        <Link href={cta.href} className="button">
          💌 {cta.label}
        </Link>
      </div>
    );
  }

  const chosen = mine.find((m) => m.id === pick) ?? mine[0];
  async function book() {
    setBusy(true);
    setMessage(null);
    const res = await requestJson("/api/episodes", { character_id: chosen.id, partner_id: targetId, ...(place.trim() ? { place: place.trim() } : {}), ...roleplayFields(roleplay) }).catch(() => null);
    setBusy(false);
    if (!res) return setMessage({ text: "Network error. Try again." });
    if (res.ok && typeof res.data.id === "string") return router.push(`/episodes/${res.data.id}?play=1`);
    setMessage({ text: res.message, shop: res.status === 402 || res.status === 429 });
  }

  return (
    <div className="date-cta">
      {mine.length > 1 && (
        <label className="date-cta-pick">
          <span className="muted small">Who goes</span>
          <select value={chosen.id} onChange={(e) => setPick(e.target.value)}>
            {mine.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.taken ? ` · 💍 with ${shortName(m.taken)}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {chosen.taken && (
        // With someone else and wanting only them: the tag, why, and where to change it, instead of a booking that fails.
        <p className="taken-note small" role="note">
          <span className="badge taken-tag">💍 With {shortName(chosen.taken)}</span> {takenNote(shortName(chosen.name), chosen.taken)}{" "}
          <Link href={`/characters/${chosen.id}#partners-${chosen.id}`}>Change it on {shortName(chosen.name)}&apos;s page</Link>
        </p>
      )}
      {chosen.mode === "book" && !chosen.taken && (
        <label className="date-cta-pick">
          <span className="muted small">Where? (optional)</span>
          <input type="text" name="place" maxLength={80} value={place} placeholder="the night market, my place…" onChange={(e) => setPlace(e.target.value)} />
        </label>
      )}
      {roleplays && chosen.mode === "book" && !chosen.taken && (
        <details className="date-cta-roleplay" onToggle={(e) => setRoleplayOpen(e.currentTarget.open)}>
          <summary>
            🎭 Add a roleplay <span className="muted small">(optional)</span>
          </summary>
          {roleplayOpen && <RoleplayPicker me={chosen.name} them={first} value={roleplay} onChange={setRoleplay} signedIn={signedIn} />}
        </details>
      )}
      {chosen.taken ? null : chosen.mode === "book" ? (
        <button type="button" className="primary" onClick={() => void book()} disabled={busy || (roleplay !== null && !choiceReady(roleplay))}>
          {busy ? "Booking…" : `💌 ${cta.label}`}
        </button>
      ) : (
        <Link href={`/swipe?character=${encodeURIComponent(chosen.id)}`} className="button">
          💌 {cta.label}
        </Link>
      )}
      <p className="muted small date-cta-note" hidden={Boolean(chosen.taken)}>
        {chosen.mode === "book"
          ? `${shortName(chosen.name)} goes. 1 token, like any date.`
          : `A first date with someone else's character starts with a match: swipe for ${first} as ${shortName(chosen.name)}.`}
      </p>
      {message && (
        <p className="error small" role="alert">
          {message.text} {message.shop && <Link href="/shop">Get more tokens</Link>}
        </p>
      )}
    </div>
  );
}
