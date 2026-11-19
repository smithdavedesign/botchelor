"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { trackConversion } from "@/app/conversion";
import DateConfirm from "@/app/DateConfirm";
import { requestJson, watchLinkOf } from "@/app/request";
import RoleplayPicker, { choiceReady, roleplayFields, type RoleplayChoice } from "@/app/RoleplayPicker";
import { openingField, type OpeningChoice } from "@/lib/scene-opening";
import type { DateCta } from "@/lib/date-cta";
import { shortName } from "@/lib/names";
import { takenNote } from "@/lib/partners-shared";

/**
 * "Date this character", right under the contestant header (lib/date-cta.ts says which version shows). Sending one of
 * yours books it like any date (POST /api/episodes, 1 date), after a confirm sheet that holds where and a roleplay
 * (2026-10-31 UX audit, B5), and opens it as it's filmed; one that has to match first
 * goes to the swipe deck instead. `roleplays`: a house character, so a roleplay can be added and plays at once
 * (lib/date-roleplays.ts); with anyone else's, the two creators agree one on the couple page first.
 */
export default function DateThisCharacter({
  cta,
  targetId,
  first,
  roleplays = false,
  signedIn = false,
  startWith = null,
  preferred = null,
}: {
  cta: DateCta;
  targetId: string;
  first: string;
  roleplays?: boolean;
  /** For the roleplay picker's ✨ Yours (the Create library, accounts only). */
  signedIn?: boolean;
  /**
   * A card's "Send {mine} on a date with {them}" (lib/character-verb.ts) lands here with ?send=<mine>: that one is
   * picked, and when it can book, the confirm sheet is already open. Nothing is spent until they press Send.
   */
  startWith?: string | null;
  /** The one they're working with (the header's face, lib/current-character.ts): picked first when it's free; no sheet opens. */
  preferred?: string | null;
}) {
  const router = useRouter();
  const mine = cta.kind === "send" ? cta.mine : [];
  // One that's free to go first (a taken one, with someone else and wanting only them, is listed but can't go).
  const asked = startWith ? mine.find((m) => m.id === startWith) : undefined;
  const [pick, setPick] = useState((asked ?? mine.find((m) => m.id === preferred && !m.taken) ?? mine.find((m) => !m.taken) ?? mine[0])?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; shop?: boolean; link?: { href: string; label: string } } | null>(null);
  // David, 2026-10-23: the booker may say where the date happens (else a texted plan, else the show picks).
  const [place, setPlace] = useState("");
  const [roleplay, setRoleplay] = useState<RoleplayChoice | null>(null);
  // How the roleplay opens, when they chose (the picker's last step; lib/scene-opening.ts).
  const [opens, setOpens] = useState<OpeningChoice | null>(null);
  // The picker mounts once it's opened, not in every character page's HTML.
  const [roleplayOpen, setRoleplayOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  // Sent here by a card with the sender named: the sheet opens once the page is in the browser (it's drawn into
  // <body>, so never on the server), and only for one that can book.
  const openOnArrival = Boolean(asked && asked.mode === "book" && !asked.taken);
  useEffect(() => {
    if (openOnArrival) setAsking(true);
  }, [openOnArrival]);

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
        <Link href={cta.href} className="button" data-track="verb-make" data-track-from="character">
          💌 {cta.label}
        </Link>
      </div>
    );
  }

  const chosen = mine.find((m) => m.id === pick) ?? mine[0];
  async function book() {
    setBusy(true);
    setMessage(null);
    const res = await requestJson("/api/episodes", { character_id: chosen.id, partner_id: targetId, ...(place.trim() ? { place: place.trim() } : {}), ...roleplayFields(roleplay), ...(roleplay ? openingField(opens) : {}) }).catch(() => null);
    setBusy(false);
    if (!res) return setMessage({ text: "Network error. Try again." });
    if (res.ok && typeof res.data.id === "string") {
      // A date started from here counts like one from /create, RepoHQ's activation included (app/conversion.ts).
      trackConversion("date_started", { mode: "partner" });
      return router.push(`/episodes/${res.data.id}?play=1`);
    }
    setMessage({ text: res.message, shop: res.status === 402 || res.status === 429, link: watchLinkOf(res.data) });
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
      {chosen.taken ? null : chosen.mode === "book" ? (
        <button
          type="button"
          className="primary"
          data-track="verb-send"
          data-track-from="character"
          onClick={() => {
            setMessage(null);
            setAsking(true);
          }}
        >
          {/* It names who goes (the picker above switches them), as the cards do. */}
          💌 Send {shortName(chosen.name)} on a date with {first}
        </button>
      ) : (
        <Link href={`/swipe?character=${encodeURIComponent(chosen.id)}`} className="button" data-track="verb-match" data-track-from="character">
          💘 Match {shortName(chosen.name)} with {first}
        </Link>
      )}
      <p className="muted small date-cta-note" hidden={Boolean(chosen.taken)}>
        {chosen.mode === "book"
          ? `${shortName(chosen.name)} goes.`
          : `A first date with someone else's character starts with a match: swipe for ${first} as ${shortName(chosen.name)}.`}
      </p>
      <DateConfirm
        open={asking}
        onClose={() => {
          if (!busy) setAsking(false);
        }}
        title={`Send ${shortName(chosen.name)} on a date with ${first}?`}
        lede={
          <>
            <strong>{shortName(chosen.name)}</strong> meets <strong>{first}</strong>. The show films it and decides how it ends: you can&apos;t steer it.
          </>
        }
        sendLabel={`Send ${shortName(chosen.name)} on the date`}
        busyLabel="Booking…"
        busy={busy}
        disabled={roleplay !== null && !choiceReady(roleplay)}
        error={message}
        onSend={() => void book()}
      >
        <label className="date-cta-pick">
          <span className="muted small">Where? (optional)</span>
          <input type="text" name="place" maxLength={80} value={place} placeholder="the night market, my place…" onChange={(e) => setPlace(e.target.value)} />
        </label>
        {roleplays && (
          <details className="ux-fold date-cta-roleplay" onToggle={(e) => setRoleplayOpen(e.currentTarget.open)}>
            <summary>
              🎭 Add a roleplay <span className="muted small">(optional)</span>
            </summary>
            {roleplayOpen && <RoleplayPicker me={chosen.name} them={first} value={roleplay} onChange={setRoleplay} signedIn={signedIn} opening={opens} onOpening={setOpens} />}
          </details>
        )}
      </DateConfirm>
    </div>
  );
}
