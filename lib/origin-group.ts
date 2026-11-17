/**
 * Who made them, as the Characters tabs split it and the Constellation's filter reads it (lib/origin.ts): the show's own
 * cast, people's characters, and agents' (the house-run bots count with the agents, as on the Agents tab). Its own module,
 * with nothing but a type import, so the Constellation's client filter (app/graph/filter.ts) can use it without pulling
 * lib/graph.ts's server code into the browser.
 */
import type { Origin } from "./origin";

export type OriginGroup = "cast" | "person" | "agent";
export const ORIGIN_GROUPS: readonly OriginGroup[] = ["cast", "person", "agent"];

/** `?origin=` on /graph: a group, or null for everyone. */
export const parseOriginGroup = (v: unknown): OriginGroup | null =>
  typeof v === "string" && (ORIGIN_GROUPS as readonly string[]).includes(v) ? (v as OriginGroup) : null;

/** Whether a character's (public) origin puts it in `group`. A private character's is masked, so it's in none. */
export const inOriginGroup = (origin: Origin | null, group: OriginGroup): boolean =>
  group === "agent" ? origin === "agent" || origin === "house_bot" : origin === group;
