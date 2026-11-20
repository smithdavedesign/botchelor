/**
 * Who made them, as the Characters tabs split it and the Constellation's filter reads it (lib/origin.ts): the show's own
 * cast (its Botchelor originals with it), people's characters, and agents' (the house-run bots count with the agents, as on the Agents tab). Plus "yours",
 * the viewer's own characters (the Yours tab), which goes by id since an origin can't say whose. Its own module, with
 * nothing but a type import, so the Constellation's client filter (app/graph/filter.ts) can use it without pulling
 * lib/graph.ts's server code into the browser.
 */
import type { Origin } from "./origin";

export type OriginGroup = "cast" | "person" | "agent";
/** A group the sky can open on: who made them, or the viewer's own. */
export type SkyGroup = OriginGroup | "yours";
export const SKY_GROUPS: readonly SkyGroup[] = ["yours", "cast", "person", "agent"];

/** `?origin=` on /graph: a group, or null for everyone. */
export const parseSkyGroup = (v: unknown): SkyGroup | null =>
  typeof v === "string" && (SKY_GROUPS as readonly string[]).includes(v) ? (v as SkyGroup) : null;

/** Whether a character's (public) origin puts it in `group`. A private character's is masked, so it's in none. */
export const inOriginGroup = (origin: Origin | null, group: OriginGroup): boolean =>
  group === "agent" ? origin === "agent" || origin === "house_bot" : group === "cast" ? origin === "cast" || origin === "original" : origin === group;

const NONE: ReadonlySet<string> = new Set();

/**
 * Who's in `group`: by public origin, or for "yours" by id among `mine` (the viewer's own; a private one of theirs keeps
 * its id on the sky, so it counts too).
 */
export const groupMember =
  (group: SkyGroup, mine: ReadonlySet<string> = NONE) =>
  (n: { id: string; origin: Origin | null }): boolean =>
    group === "yours" ? mine.has(n.id) : inOriginGroup(n.origin, group);
