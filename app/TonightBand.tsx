import Link from "next/link";
import Avatar from "./Avatar";
import type { AiringSoon, EpisodeView } from "@/lib/game";
import type { SituationBoard } from "@/lib/situations";
import type { RevealBoard } from "@/lib/weekly-reveal";
import type { LobbyEntry } from "@/lib/watch";

/** "in 2h 10m", "in 4 min": server-rendered relative time (the page is dynamic; no ticking JS). */
function inWords(iso: string | null, now: number): string {
  if (!iso) return "soon";
  const mins = Math.max(1, Math.round((new Date(iso).getTime() - now) / 60_000));
  return mins >= 60 ? `in ${Math.floor(mins / 60)}h ${mins % 60}m` : `in ${mins} min`;
}

type Slot = {
  key: string;
  label: string;
  /** The live dot pulses only for something on the air right now. */
  live?: boolean;
  faces: { id: string; name: string; hue?: number | null; house?: boolean; portrait?: string | null }[];
  names: string;
  line: string;
  href: string;
};

/**
 * The tonight band (docs/show-style.md: "lead with tonight"): the show on the air right now, as one dark strip at the
 * top of home — what's live, what's about to air, tonight's vote, what just ended. Up to three slots, in that order of
 * urgency; nothing on at all renders nothing. All server-rendered from data the page already loads.
 */
export default function TonightBand({
  rooms,
  airing,
  situation,
  reveal = null,
  latest,
  now,
}: {
  rooms: LobbyEntry[];
  airing: AiringSoon[];
  situation: SituationBoard | null;
  /** Sunday's reveal (lib/weekly-reveal.ts): a slot while its vote is open, the week's one appointment. */
  reveal?: RevealBoard | null;
  latest: EpisodeView | null;
  now: number;
}) {
  const live = rooms.find((r) => r.status === "live") ?? null;
  const premiere = rooms.find((r) => r.status === "upcoming") ?? null;
  const soon = airing[0] ?? null;
  const slots: Slot[] = [];
  if (live) {
    slots.push({
      key: "live",
      label: "Live now",
      live: true,
      faces: live.characters,
      names: `${live.characters[0].name} × ${live.characters[1].name}`,
      line: live.watching > 0 ? `${live.watching} watching — tap in` : "On the air — tap in",
      href: live.room_path,
    });
  }
  if (soon) {
    slots.push({
      key: "airing",
      label: "Airing soon",
      faces: soon.characters,
      names: `${soon.characters[0].name} × ${soon.characters[1].name}`,
      line: soon.my_pick ? `Airs ${inWords(soon.airs_at, now)} — your call is in` : `Airs ${inWords(soon.airs_at, now)} — call the ending first`,
      href: soon.share_path,
    });
  }
  if (!live && premiere) {
    slots.push({
      key: "premiere",
      label: "Tonight's premiere",
      faces: premiere.characters,
      names: `${premiere.characters[0].name} × ${premiere.characters[1].name}`,
      line: `Starts ${inWords(premiere.starts_at, now)}`,
      href: premiere.room_path,
    });
  }
  if (reveal && reveal.state === "open" && reveal.choices.length >= 2) {
    slots.push({
      key: "reveal",
      label: "Sunday's reveal",
      faces: reveal.choices.map((c) => ({ id: c.id, name: c.name, hue: c.hue, house: true, portrait: c.portrait })),
      names: "Whose secret comes out?",
      line: reveal.my_pick ? `Your vote is in — closes ${inWords(reveal.closes_at, now)}` : `Vote — closes ${inWords(reveal.closes_at, now)}`,
      href: "/watch#sunday-reveal",
    });
  }
  if (situation) {
    const mins = Math.max(0, Math.round((Date.parse(situation.closes_at) - now) / 60_000));
    const closes = mins >= 60 ? `${Math.floor(mins / 60)}h` : `${mins}m`;
    slots.push({
      key: "vote",
      label: "Tonight's vote",
      faces: situation.cast,
      names: `${situation.cast[0].name} × ${situation.cast[1].name}`,
      line: situation.my_pick ? `Your pick is in — closes in ${closes}` : `You pick their date — closes in ${closes}`,
      href: "#situation",
    });
  }
  if (latest) {
    slots.push({
      key: "aired",
      label: "Just aired",
      faces: latest.characters,
      names: `${latest.characters[0].name} × ${latest.characters[1].name}`,
      line: latest.title ? `“${latest.title}”` : latest.setting,
      // Straight into the theater, playing (2026-11-07 audit item 4).
      href: latest.revealed ? `${latest.share_path}?play=1` : latest.share_path,
    });
  }
  if (!slots.length) return null;
  // Live now (the design system, 2026-11-11): what's happening on the show right now, as facts under the slots. Never
  // pressure: a count of rooms filming and people watching, how many dates are about to air, when Sunday's secret
  // comes out once the vote is in. Only facts the page already has.
  const filming = rooms.filter((r) => r.status === "live");
  const watching = filming.reduce((n, r) => n + (r.watching ?? 0), 0);
  const facts: { key: string; text: string; live?: boolean }[] = [];
  if (filming.length) {
    facts.push({ key: "filming", live: true, text: `${filming.length} ${filming.length === 1 ? "date" : "dates"} filming${watching > 0 ? ` · ${watching} watching` : ""}` });
  }
  if (airing.length > 1) facts.push({ key: "airing", text: `${airing.length} dates airing soon` });
  if (reveal && reveal.state === "closed") facts.push({ key: "secret", live: true, text: `Sunday's secret comes out ${inWords(reveal.airs_at, now)}` });
  return (
    <section className="tonight-band" aria-label="Tonight on Botchelor">
      <p className="tonight-band-eyebrow">
        <span className="tonight-dot" aria-hidden="true" /> Tonight on Botchelor
      </p>
      <ul className="tonight-slots">
        {slots.slice(0, 3).map((s) => (
          <li key={s.key} className={`tonight-slot${s.live ? " is-live" : ""}`}>
            <Link href={s.href} className="tonight-slot-link">
              <span className="tonight-slot-label">
                {s.live && <span className="tonight-live-dot" aria-hidden="true" />}
                {s.label}
              </span>
              <span className="tonight-slot-faces" aria-hidden="true">
                {s.faces.slice(0, 2).map((c) => (
                  <Avatar key={c.id} seed={c.id} name={c.name} hue={c.hue ?? null} house={c.house ?? true} portraitSrc={c.portrait ?? null} size={40} decorative />
                ))}
              </span>
              <span className="tonight-slot-names">{s.names}</span>
              <span className="tonight-slot-line">{s.line}</span>
            </Link>
          </li>
        ))}
      </ul>
      {facts.length > 0 && (
        <ul className="tonight-live" aria-label="Live now">
          {facts.map((f) => (
            <li key={f.key}>
              {f.live && <span className="tonight-live-dot" aria-hidden="true" />}
              {f.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
