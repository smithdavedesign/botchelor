/**
 * The show's shared world (docs/PRDs/social-network.md section 5.4): one city, written once by hand, its neighbourhoods,
 * the house and its rooms (lib/house-scenes.ts HOUSE_PLACES) and every date venue (lib/venues.ts DATE_VENUES, as
 * hangouts, each in the neighbourhood it would be in). Free-text hometowns and jobs can't make neighbours or coworkers;
 * a world that's given can.
 *
 * Seeded on first use (`ensureWorld`, once a process per database), idempotently: the code is the source of these rows,
 * so a renamed neighbourhood or a new venue is written over the old on the next start. Place ids are hashes of their
 * keys, the same in every database.
 */
import type { Db } from "../db";
import { DATE_VENUES } from "../venues";
import { ensurePlaces, houseKey, venueKey } from "./places";
import { socialTiesOn } from "./switch";
import type { PlaceInput } from "./types";

type Env = Record<string, string | undefined>;

/** The show's city. */
export const WORLD_CITY = {
  key: "city:heartsease-on-sea",
  name: "Heartsease-on-Sea",
  description: "The show's city: a seaside town that is mostly pier and partly gossip. The house is up on the Heights; everyone else is somewhere below, pretending not to watch.",
} as const;

/** A neighbourhood of the city, and the date venues that are in it. */
export type Neighbourhood = { key: string; name: string; description: string; venues: readonly string[] };

/** The city's neighbourhoods. A venue not listed in one is out of town (a skydive, a safari, a gothic manor). */
export const NEIGHBOURHOODS: readonly Neighbourhood[] = [
  {
    key: "neighbourhood:the-front",
    name: "The Front",
    description: "The seafront: the pier, the cold beach, the surf school and a rooftop bar that charges extra for the sunset.",
    venues: ["pier_at_night", "night_beach", "surf_lesson", "rooftop_bar"],
  },
  {
    key: "neighbourhood:old-town",
    name: "Old Town",
    description: "Cobbled lanes where every café closes in an hour, the cinema has one screen and the bookshop stays open late out of spite.",
    venues: ["corner_cafe", "late_bookshop", "old_cinema", "jazz_bar", "museum_night", "haunted_house", "murder_mystery", "tasting_menu", "pottery_class"],
  },
  {
    key: "neighbourhood:neon-mile",
    name: "Neon Mile",
    description: "One long street of arcades, karaoke booths, trivia nights and a diner open till four. Loud on purpose.",
    venues: ["retro_arcade", "karaoke_booth", "nightclub", "silent_disco", "comedy_club", "dive_bar", "bowling_alley", "late_night_diner", "laundromat"],
  },
  {
    key: "neighbourhood:the-docks",
    name: "The Docks",
    description: "Old warehouses turned into a night market, a climbing wall, a furniture maze and an escape room with one clue that never works.",
    venues: ["night_market", "climbing_wall", "escape_room", "flat_pack", "paintball", "cooking_class"],
  },
  {
    key: "neighbourhood:gardenside",
    name: "Gardenside",
    description: "The botanic park, the boating lake and its swan pedalos, an ice rink in winter and goats doing yoga in summer.",
    venues: ["botanic_park", "swan_pedalo", "goat_yoga", "ice_rink", "ballroom_lesson"],
  },
  {
    key: "neighbourhood:the-heights",
    name: "The Heights",
    description: "The hill above town: big old houses, the best view of the stars, and the show's house, where the cast lives and the gossip starts.",
    venues: ["stargazing_hill"],
  },
];

/** The show's house, where this season's cast lives. */
export const HOUSE_PLACE = {
  key: houseKey("the-house"),
  name: "The house",
  description: "Where this season's cast lives, and where every story gets told twice.",
  parentKey: "neighbourhood:the-heights",
} as const;

/** The neighbourhood a date venue is in, or null when it's out of town. */
export function neighbourhoodOfVenue(venueId: string): Neighbourhood | null {
  return NEIGHBOURHOODS.find((n) => n.venues.includes(venueId)) ?? null;
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** At most `max` characters, cut at a word with an ellipsis. */
const upTo = (s: string, max: number): string => {
  if (s.length <= max) return s;
  const space = s.lastIndexOf(" ", max - 1);
  return `${s.slice(0, space > 0 ? space : max - 1)}…`;
};

/** Every seeded place, parents before the places in them: the city, its neighbourhoods, the house, its rooms, the venues. */
export async function worldPlaces(): Promise<PlaceInput[]> {
  // The house's rooms live with the house scenes; read when the world is built, so this module stays light.
  const { HOUSE_PLACES } = await import("../house-scenes");
  const src = "house" as const;
  return [
    { key: WORLD_CITY.key, kind: "city", name: WORLD_CITY.name, description: WORLD_CITY.description, source: src },
    ...NEIGHBOURHOODS.map((n): PlaceInput => ({ key: n.key, kind: "neighbourhood", name: n.name, description: n.description, parentKey: WORLD_CITY.key, source: src })),
    { key: HOUSE_PLACE.key, kind: "house", name: HOUSE_PLACE.name, description: HOUSE_PLACE.description, parentKey: HOUSE_PLACE.parentKey, source: src },
    ...HOUSE_PLACES.map((p): PlaceInput => ({ key: houseKey(p.id), kind: "house", name: capital(p.label), description: capital(`${p.at}, ${p.when}.`), parentKey: HOUSE_PLACE.key, source: src })),
    ...DATE_VENUES.map(
      (v): PlaceInput => ({
        key: venueKey(v.id),
        kind: "hangout",
        name: v.name,
        venue_id: v.id,
        description: upTo(capital(v.prompt), 200),
        parentKey: neighbourhoodOfVenue(v.id)?.key ?? null,
        source: src,
      }),
    ),
  ];
}

const seeded = new WeakMap<Db, Promise<number>>();

/**
 * Seeds the world into this database, once a process (a failed seed is tried again on the next call). Returns how many
 * places it wrote (0 when every one was already as the code says). Off with SOCIAL_TIES.
 */
export function ensureWorld(db: Db, env: Env = process.env): Promise<number> {
  if (!socialTiesOn(env)) return Promise.resolve(0);
  let run = seeded.get(db);
  if (!run) {
    run = worldPlaces().then((places) => ensurePlaces(db, places, { refresh: true }));
    run.catch(() => seeded.delete(db));
    seeded.set(db, run);
  }
  return run;
}
