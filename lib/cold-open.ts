/**
 * The cold open (2026-11-19, the first-minute plan): a card in the theater before the first line that says who these
 * two are, what each of them wants and what's at stake, so someone who has never met either knows why to keep
 * watching. When the date has a voiced cut (lib/home-clip.ts episodeCut), the card offers that too, as the quick way
 * in. Real viewers left at the first line and the third of twelve (Nov 12–19): the lines started before anyone knew
 * who was talking.
 *
 * Built only from what the page already shows before anyone reads the date (the setting, the goals and the
 * "previously on" line, lib/previously-on.ts), so it spoils nothing. COLD_OPEN=0 turns it off. Pure.
 */
import { withoutLeadName } from "@/app/episodes/[id]/lead-name";
import { dateLabel } from "./rules";

/** COLD_OPEN=0 turns the card off; unset, or anything else, leaves it on. */
export function coldOpenOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.COLD_OPEN?.trim() !== "0";
}

export type ColdOpenWant = {
  character_id: string;
  /** The goal without the name it opens with, for the card to put the face and name in front; null when it doesn't. */
  rest: string | null;
  goal: string;
};

export type ColdOpen = {
  /** Which date, and where: "Their second date at the night market · Speed round". */
  kicker: string;
  /** The setting as the page tells it (the teaser), or null. */
  setting: string | null;
  /** "Previously on": the pair's last aired date in one line, or null on a first date. */
  previously: string | null;
  /** The roleplay both sides agreed to ("🎭 The heist"), or null. */
  roleplay: string | null;
  /** What each of them wants, in the order they sit. */
  wants: ColdOpenWant[];
  /** The question the date answers: "Will there be a second date?" */
  stakes: string;
};

export type ColdOpenInput = {
  characters: { id: string; name: string }[];
  goals: { character_id: string; goal: string }[];
  /** Which date this is for the couple (lib/rules.ts dateNumberOf); null or 1 reads as a first date. */
  dateNumber: number | null;
  /** The venue as a phrase ("the night market", lib/venues.ts venuePhrase), or null. */
  venue: string | null;
  /** The format's label when it isn't the usual date (lib/formats.ts formatLabel), or null. */
  format: string | null;
  roleplay: { icon: string; title: string } | null;
  setting: string | null;
  previously: string | null;
};

/** The card for one date, or null when there's nothing to set up (no setting and no goals). */
export function coldOpenOf(input: ColdOpenInput): ColdOpen | null {
  const n = input.dateNumber && input.dateNumber > 1 ? Math.floor(input.dateNumber) : 1;
  const setting = clean(input.setting);
  const wants: ColdOpenWant[] = [];
  for (const c of input.characters) {
    const g = input.goals.find((x) => x.character_id === c.id);
    const goal = clean(g?.goal);
    if (!goal) continue;
    wants.push({ character_id: c.id, rest: withoutLeadName(goal, c.name), goal });
  }
  if (!setting && wants.length === 0) return null;
  const which = n > 1 ? `Their ${dateLabel(n).toLowerCase()}` : "A first date";
  const venue = clean(input.venue);
  const format = clean(input.format);
  return {
    kicker: [venue ? `${which} at ${venue}` : which, format].filter(Boolean).join(" · "),
    setting,
    previously: clean(input.previously),
    roleplay: input.roleplay ? `${input.roleplay.icon} ${input.roleplay.title}`.trim() : null,
    wants,
    stakes: `Will there be a ${dateLabel(n + 1).toLowerCase()}?`,
  };
}

/** "1:05": a cut's length the way a video player shows it. */
export function clipLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "about 3 minutes": how long the whole date plays in the theater, from its pacing (app/useReplay.ts). */
export function playLength(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
}

function clean(s: string | null | undefined): string | null {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t : null;
}
