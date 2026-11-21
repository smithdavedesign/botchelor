/**
 * A character's circle over MCP (2.47.0; docs/PRDs/social-network.md section 6.2, Phase 2b): what an owner does on
 * their character page's People tab, through the same functions (lib/social/declare.ts), so the rules are one set.
 *
 *  - get_circle: a character's people, ties and places, as the caller may see them (a stranger the public; the owner
 *    theirs too, with proposals waiting on them), and the world's places to pick from on request.
 *  - add_person: someone in YOUR character's life off the show (a name, a relation, a line), live at once.
 *  - propose_tie: YOUR character and another. Two of yours: any kind, live at once. Someone else's: a warm kind only,
 *    as a proposal its owner says yes or no to (they're told); no answer in 14 days and it lapses.
 *  - answer_tie: yes or no to a proposal made to one of yours.
 *  - end_tie: a friendship that's over (it stays, as past), family taken off, or a proposal of yours withdrawn.
 *  - set_place: where YOUR character lives, works, is a regular or studied; or `leave` it.
 *
 * Every write is the agent's (`source` agent, `created_by` its id). SOCIAL_DECLARE=0 refuses the writes and get_circle.
 */
import type { Db } from "../db";
import { siteUrl } from "../site";
import {
  addPersonFor,
  answerTie,
  declareTie,
  endTieFor,
  leavePlaceFor,
  placeMenu,
  setPlaceFor,
  theirPeople,
  type DeclareBy,
  type DeclaredVisibility,
  type Refusal,
} from "../social/declare";
import { getPlaceByKey } from "../social/places";
import { tieChoices, personChoices } from "../social/relations";
import { socialDeclareOn } from "../social/switch";
import { CIRCLE_VISIBILITIES, TIE_ANSWERS } from "./tool-defs";

export const CIRCLE_TOOL_NAMES = ["get_circle", "add_person", "propose_tie", "answer_tie", "end_tie", "set_place"] as const;
export type CircleToolName = (typeof CIRCLE_TOOL_NAMES)[number];

type Outcome = { data: Record<string, unknown> } | { error: string; code?: string };
type Args = Record<string, unknown>;

const OFF: Outcome = { error: "Characters' people and ties can't be changed right now.", code: "not_available" };
const refused = (r: Refusal): Outcome => ({ error: r.message, code: r.error });
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const opt = (v: unknown): string | null | undefined => (v === undefined ? undefined : v === null ? null : String(v));
/** CIRCLE_VISIBILITIES (and the page's own word, owner) as the store's; absent is the default (public). */
const visibilityOf = (v: unknown): DeclaredVisibility | undefined => (v === "only_you" || v === "owner" ? "owner" : v === "public" ? "public" : undefined);
/** A visibility that isn't one of them ("private", "friends") is refused, never written as public. */
const badVisibility = (v: unknown): Outcome | null =>
  v === undefined || v === null || visibilityOf(v) ? null : { error: `visibility is ${CIRCLE_VISIBILITIES.join(" or ")}.`, code: "invalid_visibility" };
const by = (agentId: string): DeclareBy => ({ userId: agentId, source: "agent" });

/** get_circle: their people, ties by layer and places, as the caller may see them; `world` adds the places to pick from. */
export async function getCircleTool(db: Db, agentId: string | null, args: Args): Promise<Outcome> {
  if (!socialDeclareOn()) return OFF;
  const id = str(args.character_id);
  const view = id ? await theirPeople(db, id, agentId) : null;
  if (!view) return { error: "No character with that id (or it's private). list_cast and my_status list characters.", code: "not_found" };
  const c = view.character;
  return {
    data: {
      character_id: c.id,
      name: c.name,
      yours: c.mine,
      // Their owner (and agent) changes it; the show's own characters take their circle from the show.
      can_change: c.editable,
      ...(c.show ? { note: "One of the show's own characters: the show writes their people, and nobody declares a tie to them." } : {}),
      people: view.people.map((p) => ({
        person_id: p.id,
        name: p.name,
        relation: p.label,
        ...(p.pronouns ? { pronouns: p.pronouns } : {}),
        ...(p.note ? { note: p.note } : {}),
        ...(p.deceased ? { late: true } : {}),
        ...(p.since ? { since: p.since } : {}),
        ...(c.mine ? { visibility: p.visibility === "public" ? "public" : "only_you" } : {}),
      })),
      ties: view.ties
        .filter((t) => t.layer !== "communication")
        .map((t) => ({
          tie_id: t.id,
          with: { character_id: t.other.id, name: t.other.name },
          // "<them> is <name>'s <relation>"
          relation: t.label,
          kind: t.kind,
          layer: t.layer,
          status: t.status,
          ...(t.story ? { story: t.story } : {}),
          ...(t.since ? { since: t.since } : {}),
          ...(t.waiting === "on_you" ? { waiting_on_you: "A proposal to your character: answer_tie yes or no." } : t.waiting === "on_them" ? { waiting_on_them: true } : {}),
          ...(c.mine ? { visibility: t.visibility === "public" ? "public" : "only_you", declared: t.declared } : {}),
        })),
      places: view.places.map((p) => ({
        place_key: p.key,
        name: p.name,
        role: p.role,
        ...(p.since ? { since: p.since } : {}),
        ...(p.others.length ? { with: p.others.slice(0, 8).map((o) => ({ character_id: o.id, name: o.name })) } : {}),
      })),
      ...(c.editable && args.world === true ? { world: await worldOut(db, agentId!) } : {}),
      ...(c.editable
        ? {
            relations: {
              people: personChoices("agent").map((x) => x.id),
              ties_to_yours: tieChoices("agent", { own: true }).map((x) => x.id),
              ties_to_someone_elses: tieChoices("agent", { own: false }).map((x) => x.id),
            },
          }
        : {}),
      page: `${siteUrl()}/characters/${encodeURIComponent(c.id)}#people`,
    },
  };
}

/** At most this many of the workplaces and schools named so far in get_circle's world (the newest the caller named last). */
export const WORLD_WORKPLACES_LISTED = 60;

/** The places set_place takes, by key: the neighbourhoods, the hangouts, and the workplaces and schools named so far. */
async function worldOut(db: Db, agentId: string): Promise<Record<string, unknown>> {
  const m = await placeMenu(db, agentId);
  // The caller's own come last in the menu: keep those, then the show's newest.
  const work = m.workplaces.slice(-WORLD_WORKPLACES_LISTED);
  return {
    city: m.city.name,
    neighbourhoods: m.neighbourhoods.map((n) => ({ place_key: n.key, name: n.name })),
    hangouts: m.hangouts.map((h) => ({ place_key: h.key, name: h.name, neighbourhood: h.neighbourhood })),
    workplaces: work.map((w) => ({ place_key: w.key, name: w.name, kind: w.kind, ...(w.neighbourhood ? { neighbourhood: w.neighbourhood } : {}) })),
    ...(m.workplaces.length > work.length ? { more_workplaces: m.workplaces.length - work.length } : {}),
  };
}

/** add_person: someone in your character's life off the show. */
export async function addPersonTool(db: Db, agentId: string, args: Args): Promise<Outcome> {
  if (!socialDeclareOn()) return OFF;
  const bad = badVisibility(args.visibility);
  if (bad) return bad;
  const r = await addPersonFor(db, by(agentId), str(args.character_id), {
    name: str(args.name),
    relation: str(args.relation),
    pronouns: opt(args.pronouns),
    note: opt(args.note),
    deceased: args.late === true,
    visibility: visibilityOf(args.visibility),
    story: opt(args.story),
    since: opt(args.since),
  });
  if (!r.ok) return refused(r);
  return { data: { person_id: r.person.id, name: r.person.name, relation: r.tie.kind, tie_id: r.tie.id, note: "Added. get_circle shows their people." } };
}

/** propose_tie: your character and another; live at once between two of yours, a proposal to someone else's. */
export async function proposeTieTool(db: Db, agentId: string, args: Args): Promise<Outcome> {
  if (!socialDeclareOn()) return OFF;
  const bad = badVisibility(args.visibility);
  if (bad) return bad;
  const r = await declareTie(db, by(agentId), str(args.character_id), {
    with: str(args.with),
    relation: str(args.relation),
    story: opt(args.story),
    since: opt(args.since),
    visibility: visibilityOf(args.visibility),
  });
  if (!r.ok) return refused(r);
  return {
    data: {
      tie_id: r.tie.id,
      kind: r.tie.kind,
      status: r.status,
      ...(r.news ? {} : { already: true }),
      note:
        r.status === "proposed"
          ? "Proposed: their owner is told and says yes or no; with no answer in 14 days it lapses. end_tie withdraws it."
          : "Live: it's on both their pages.",
    },
  };
}

/** answer_tie: yes or no to a proposal made to one of yours. */
export async function answerTieTool(db: Db, agentId: string, args: Args): Promise<Outcome> {
  if (!socialDeclareOn()) return OFF;
  const answer = str(args.answer).trim().toLowerCase();
  if (!(TIE_ANSWERS as readonly string[]).includes(answer)) return { error: `answer is ${TIE_ANSWERS.join(" or ")}.`, code: "invalid_answer" };
  const r = await answerTie(db, by(agentId), str(args.tie_id), answer === "yes");
  if (!r.ok) return refused(r);
  return { data: { tie_id: r.tie.id, status: r.tie.status, note: answer === "yes" ? "Yes: it's on both their pages." : "No: it's gone, and it isn't asked again for 30 days." } };
}

/** end_tie: a friendship that's over (kept, as past), family taken off, or your own proposal withdrawn. */
export async function endTieTool(db: Db, agentId: string, args: Args): Promise<Outcome> {
  if (!socialDeclareOn()) return OFF;
  const r = await endTieFor(db, by(agentId), str(args.tie_id));
  if (!r.ok) return refused(r);
  return { data: { tie_id: str(args.tie_id), ended: r.ended, note: r.ended === "ended" ? "Ended: it stays in their history, as past." : "Taken off." } };
}

/** set_place: where your character lives, works, is a regular or studied (a place's key, or a new workplace's name); `leave` takes them out. */
export async function setPlaceTool(db: Db, agentId: string, args: Args): Promise<Outcome> {
  if (!socialDeclareOn()) return OFF;
  const characterId = str(args.character_id);
  const role = str(args.role);
  const bad = badVisibility(args.visibility);
  if (bad) return bad;
  if (args.leave === true) {
    const place = await getPlaceByKey(db, str(args.place).trim().toLowerCase());
    if (!place) return { error: "No place with that key: get_circle lists theirs.", code: "place_not_found" };
    const r = await leavePlaceFor(db, by(agentId), characterId, place.id, role);
    return r.ok ? { data: { place_key: place.key, role, left: true } } : refused(r);
  }
  const r = await setPlaceFor(db, by(agentId), characterId, {
    role,
    place: opt(args.place),
    name: opt(args.name),
    neighbourhood: opt(args.neighbourhood),
    since: opt(args.since),
    visibility: visibilityOf(args.visibility),
  });
  if (!r.ok) return refused(r);
  return { data: { place_key: r.place.key, name: r.place.name, role: r.role, note: "Set. Others there are their neighbours, coworkers or fellow regulars." } };
}
