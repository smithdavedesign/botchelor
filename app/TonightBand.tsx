import Link from "next/link";
import Avatar from "./Avatar";
import { showCrowd } from "@/lib/crowd-threshold";
import type { AiringSoon, EpisodeView } from "@/lib/game";
import type { CeremonyBoard } from "@/lib/ceremony";
import type { SituationBoard } from "@/lib/situations";
import type { RevealBoard } from "@/lib/weekly-reveal";
import type { LobbyEntry } from "@/lib/watch";
import type { NextPremiere } from "@/lib/premiere-clock";
import { houseLine, type HouseSceneView } from "@/lib/house-scenes";
import { english, type T } from "@/lib/i18n/translate";

/** "in 2h 10m", "in 4 min": server-rendered relative time (the page is dynamic; no ticking JS). */
function inWords(iso: string | null, now: number, t: T): string {
  if (!iso) return t("soon");
  const mins = Math.max(1, Math.round((new Date(iso).getTime() - now) / 60_000));
  return mins >= 60 ? t("in {h}h {m}m", { h: Math.floor(mins / 60), m: mins % 60 }) : t("in {m} min", { m: mins });
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
  ceremony = null,
  latest,
  house = null,
  now,
  insider = false,
  story = null,
  premiere = null,
  t = english,
}: {
  rooms: LobbyEntry[];
  airing: AiringSoon[];
  situation: SituationBoard | null;
  /** Sunday's reveal (lib/weekly-reveal.ts): a slot while its vote is open, the week's one appointment. */
  reveal?: RevealBoard | null;
  /** The rose ceremony (lib/ceremony.ts, a Botchelor season): a slot while its vote is open. */
  ceremony?: CeremonyBoard | null;
  latest: EpisodeView | null;
  /** The newest scene in the show's house (lib/house-scenes.ts): the band's house line, under the slots. */
  house?: HouseSceneView | null;
  now: number;
  /** The viewer has a character (lib/crowd-threshold.ts): "N watching" from 1; a stranger sees a count only for a crowd. */
  insider?: boolean;
  /** Today's story from the producer (lib/producer.ts storyToday): its "Tonight:" line joins the facts under the slots. */
  story?: { tonight: string; previously?: string } | null;
  /**
   * The Sunday premiere (lib/sunday-premiere.ts nextPremiere): a slot on its day until its room opens, the pass the hour
   * before; from then the room is an upcoming one in `rooms` and takes the premiere slot below.
   */
  premiere?: NextPremiere | null;
  /** The page's translator (docs/i18n.md); English when none is passed. */
  t?: T;
}) {
  const live = rooms.find((r) => r.status === "live") ?? null;
  const upcoming = rooms.find((r) => r.status === "upcoming") ?? null;
  const soon = airing[0] ?? null;
  const slots: Slot[] = [];
  if (live) {
    slots.push({
      key: "live",
      label: t("Live now"),
      live: true,
      faces: live.characters,
      names: `${live.characters[0].name} × ${live.characters[1].name}`,
      line: showCrowd(live.watching, { insider }) ? t("{n} watching — tap in", { n: live.watching ?? 0 }) : t("On the air — tap in"),
      href: live.room_path,
    });
  }
  if (soon) {
    slots.push({
      key: "airing",
      label: t("Airing soon"),
      faces: soon.characters,
      names: `${soon.characters[0].name} × ${soon.characters[1].name}`,
      line: soon.my_pick ? t("Airs {when} — your call is in", { when: inWords(soon.airs_at, now, t) }) : t("Airs {when} — call the ending first", { when: inWords(soon.airs_at, now, t) }),
      href: soon.share_path,
    });
  }
  if (!live && upcoming) {
    slots.push({
      key: "premiere",
      label: t("Tonight's premiere"),
      faces: upcoming.characters,
      names: `${upcoming.characters[0].name} × ${upcoming.characters[1].name}`,
      line: t("Starts {when}", { when: inWords(upcoming.starts_at, now, t) }),
      href: upcoming.room_path,
    });
  } else if (!live && premiere?.state === "scheduled" && premiere.sunday === new Date(now).toISOString().slice(0, 10)) {
    const pilot = premiere.kind === "pilot";
    slots.push({
      key: "premiere",
      label: pilot ? t("Tonight's pilot") : t("Tonight's premiere"),
      faces: [premiere.lead],
      names: pilot ? t("Meet {name}", { name: premiere.lead.name }) : premiere.finale ? t("{name}'s last date before the final rose", { name: premiere.lead.name }) : t("{name}'s last-chance date", { name: premiere.lead.name }),
      line: `${t("Starts {when}", { when: inWords(premiere.at, now, t) })} · ${premiere.time_words}`,
      href: pilot ? "/watch#on-now" : "/watch#rose-ceremony",
    });
  }
  if (reveal && reveal.state === "open" && reveal.choices.length >= 2) {
    slots.push({
      key: "reveal",
      label: t("Sunday's reveal"),
      faces: reveal.choices.map((c) => ({ id: c.id, name: c.name, hue: c.hue, house: true, portrait: c.portrait })),
      names: t("Whose secret comes out?"),
      line: reveal.my_pick ? t("Your vote is in — closes {when}", { when: inWords(reveal.closes_at, now, t) }) : t("Vote — closes {when}", { when: inWords(reveal.closes_at, now, t) }),
      href: "/watch#sunday-reveal",
    });
  }
  if (ceremony?.vote && ceremony.vote.choices.length >= 2) {
    slots.push({
      key: "ceremony",
      label: t("The rose ceremony"),
      faces: [ceremony.lead, ...ceremony.vote.choices.map((c) => ceremony.suitors.find((s) => s.id === c.id) ?? { id: c.id, name: c.name })].slice(0, 2),
      names: t("Who goes home on Sunday?"),
      line: ceremony.vote.my_pick ? t("Your vote is in — the ceremony {when}", { when: inWords(ceremony.vote.closes_at, now, t) }) : t("Vote — the ceremony {when}", { when: inWords(ceremony.vote.closes_at, now, t) }),
      href: "/watch#rose-ceremony",
    });
  }
  if (situation) {
    const mins = Math.max(0, Math.round((Date.parse(situation.closes_at) - now) / 60_000));
    const closes = mins >= 60 ? `${Math.floor(mins / 60)}h` : `${mins}m`;
    slots.push({
      key: "vote",
      label: t("Tonight's vote"),
      faces: situation.cast,
      // A producer's beat (lib/producer.ts): the twists name their own people, so the slot says what the vote decides.
      names: situation.headline ?? `${situation.cast[0].name} × ${situation.cast[1].name}`,
      line: situation.my_pick ? t("Your pick is in — closes in {time}", { time: closes }) : situation.headline ? t("Vote — closes in {time}", { time: closes }) : t("You pick their date — closes in {time}", { time: closes }),
      href: "#situation",
    });
  }
  if (latest) {
    slots.push({
      key: "aired",
      label: t("Just aired"),
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
  const facts: { key: string; text: string; live?: boolean; href?: string }[] = [];
  if (filming.length) {
    facts.push({ key: "filming", live: true, text: `${filming.length === 1 ? t("1 date filming") : t("{n} dates filming", { n: filming.length })}${showCrowd(watching, { insider }) ? ` · ${t("{n} watching", { n: watching })}` : ""}` });
  }
  if (airing.length > 1) facts.push({ key: "airing", text: t("{n} dates airing soon", { n: airing.length }) });
  if (reveal && reveal.state === "closed") facts.push({ key: "secret", live: true, text: t("Sunday's secret comes out {when}", { when: inWords(reveal.airs_at, now, t) }) });
  // The producer's line for the day (lib/producer.ts): what tonight is about. A fact like the others, never a new section.
  // When the vote's slot above already says the same sentence (its headline is the "Tonight:" line without the label),
  // the fact is what led to it instead: the band said "You pick who gets the date with Juniper." twice, one over the other.
  const said = (line: string) => line.replace(/^Tonight: /, "").trim().toLowerCase();
  const repeats = Boolean(story?.tonight && situation?.headline && said(story.tonight) === said(situation.headline));
  const storyLine = repeats ? story?.previously : story?.tonight;
  if (storyLine) facts.push({ key: "story", text: storyLine });
  // The house line (lib/house-scenes.ts): who is talking in the house, and about whose date. A link, never a slot.
  if (house) facts.push({ key: "house", text: t("In the house: {line}", { line: houseLine(house) }), href: `/house#scene-${house.id}` });
  return (
    <section className="tonight-band" aria-label={t("Tonight on Botchelor")}>
      <p className="tonight-band-eyebrow">
        <span className="tonight-dot" aria-hidden="true" /> {t("Tonight on Botchelor")}
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
        <ul className="tonight-live" aria-label={t("Live now")}>
          {facts.map((f) => (
            <li key={f.key}>
              {f.live && <span className="tonight-live-dot" aria-hidden="true" />}
              {f.href ? (
                <Link href={f.href} data-track="house-scene" data-track-where="tonight">
                  {f.text} →
                </Link>
              ) : (
                f.text
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
