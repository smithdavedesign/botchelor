/**
 * The social network's shared types (docs/PRDs/social-network.md). Types and constant vocabularies only: no values that
 * reach the database or the app, so any module, client components included, can import from here.
 *
 * The model in one paragraph: a **tie** is one typed edge, from a character to another character or to one of its
 * off-screen **people**, one row a pair a kind (`social_ties`). A symmetric tie is stored from the lower id; a directed
 * tie reads "to is from's <kind>" (a `parent` tie from A to B: B is A's parent), and a tie to a person always starts at
 * its holder ("Mum is Ada's parent"). Every change is an event (`social_tie_events`). **Places** are the shared world
 * (`social_places`), and characters belong to them by role (`social_place_members`); who shares a place is worked out
 * when read, never stored.
 */
import type { TieKindId } from "./kinds";

export type { TieKindId };

/** The layers of the multiplex graph: every kind is on one (PRD section 5.1). */
export const LAYERS = ["kin", "romance", "friendship", "work", "place", "conflict", "acquaintance", "communication"] as const;
export type Layer = (typeof LAYERS)[number];
export const isLayer = (x: unknown): x is Layer => typeof x === "string" && (LAYERS as readonly string[]).includes(x);

/** How a tie feels, signed: -2 (hostile) .. 2 (devoted). 0 is neutral (exes, people who just met). */
export type Valence = -2 | -1 | 0 | 1 | 2;
export const clampValence = (n: number): Valence => Math.max(-2, Math.min(2, Math.round(n))) as Valence;

/** A tie's state. `proposed` waits for the other owner's yes; `declined` is a no, or a proposal that lapsed. */
export const TIE_STATUSES = ["proposed", "active", "ended", "declined"] as const;
export type TieStatus = (typeof TIE_STATUSES)[number];

/**
 * Who may see a row. `public`: anyone (derived rows always are: they come from what aired). `owner`: the owners of either
 * end. `private`: the engine and the holder's own prompts, never a page.
 */
export const VISIBILITIES = ["public", "owner", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/**
 * Who made a row. `owner` (a person, about their own characters), `agent` (an AI agent through MCP), `house` (the
 * show's generator), `derived` (what aired made it: lib/social/derive.ts), `admin`, `import`. Declared, derived and
 * inferred are never mixed up: a suggestion is not a tie until someone accepts it, so it has no source here.
 */
export const SOURCES = ["owner", "agent", "house", "derived", "admin", "import"] as const;
export type Source = (typeof SOURCES)[number];
/** Who may declare a kind (kinds.ts `declarable`): every source except `derived` and `import`. */
export type Declarer = "owner" | "agent" | "house" | "admin";

/** What a social_tie_events row records. */
export const TIE_EVENTS = ["created", "proposed", "accepted", "declined", "changed", "ended", "revived", "contact", "decayed"] as const;
export type TieEvent = (typeof TIE_EVENTS)[number];

/** The Dunbar rings of "X's world" (PRD section 7), innermost first. */
export const RINGS = ["inner", "close", "friends", "acquaintances"] as const;
export type Ring = (typeof RINGS)[number];
/** How many people each ring holds, counted from the centre: 5 inner, 15 with the close ones, 50, then 150. */
export const RING_CAPS: Record<Ring, number> = { inner: 5, close: 15, friends: 50, acquaintances: 150 };

/**
 * Where a tie's evidence came from, as `<what>:<id>`: `episode:<id>` (an aired date), `scene:<id>` (a house scene),
 * `night:<id>` (a group night), `beat:<id>` (a story beat), `link:<lo>:<hi>` (a character_links row), `season:<id>` (a
 * season's cast). A declaration needs none. Never a person's id: evidence, `detail` and an event's `changes` are jsonb
 * that deleting an account can't reach, so who did something lives only in the person columns (created_by,
 * answered_by, actor), which it can.
 */
export type EvidenceRef = string;
/** One piece of evidence on a tie: what it came from and when (ISO). A tie keeps the newest 20. */
export type Evidence = { ref: EvidenceRef; at: string };
export const EVIDENCE_KEPT = 20;
/** Evidence as a write gives it: when it happened (now, if not given). */
export type EvidenceIn = { ref: EvidenceRef; at?: string | Date };

/** One tie, as stored (timestamps as ISO strings). */
export type Tie = {
  id: string;
  from_id: string;
  /** A character, or null when the tie is to an off-screen person (`to_person_id`). */
  to_id: string | null;
  to_person_id: string | null;
  kind: TieKindId;
  layer: Layer;
  directed: boolean;
  valence: Valence;
  /** Strength as of `last_contact_at`, 0..1 (Phase 4 moves it with contact and decays it by the kind's half-life). */
  closeness: number;
  status: TieStatus;
  visibility: Visibility;
  source: Source;
  source_ref: string | null;
  /** Newest first, at most EVIDENCE_KEPT. */
  evidence: Evidence[];
  /**
   * Kind-specific: `{stage, shown_stage, dates, second_dates}` on `dated`, `{nights}` on `met_at_group_night`, `{count}`
   * on `talked_about` and `told`, `{seasons}` on `housemate`, `{outcome}` on a scene's `feud`.
   */
  detail: Record<string, unknown>;
  story: string | null;
  since_text: string | null;
  /** Set when a model wrote any part of it: a dataset filters by writer (closed models' terms). */
  origin_model: string | null;
  prompt_version: string | null;
  confidence: number;
  /** Person ids (lib/person-columns.ts): who declared it, and the other owner who answered its proposal. Server-only. */
  created_by: string | null;
  answered_by: string | null;
  started_at: string | null;
  ended_at: string | null;
  last_contact_at: string | null;
  created_at: string;
  updated_at: string;
};

/** A tie's identity: from a character to a character (`to`) or to an off-screen person (`toPerson`), and its kind. */
export type TieKeyInput = { from: string; kind: TieKindId } & ({ to: string; toPerson?: undefined } | { toPerson: string; to?: undefined });
/** The stored form of a key: a symmetric pair ordered, the columns named as in the table. */
export type TieKey = { from_id: string; to_id: string | null; to_person_id: string | null; kind: TieKindId };

/**
 * What a write gives (lib/social/ties.ts upsertTie). Only `source` is needed to create; everything else falls back to
 * the kind's defaults. On an update, given fields are set and the rest kept, except that a derived write never rewrites
 * what someone declared (it adds its evidence and contact only).
 */
export type TieInput = TieKeyInput & {
  source: Source;
  /**
   * The evidence this write brings, one or several: each ref appended once (the same ref twice is a no-op), and the
   * newest one's `at` is a contact. A new tie starts at the earliest unless `started_at` says otherwise.
   */
  evidence?: EvidenceIn | readonly EvidenceIn[];
  /**
   * The evidence given is the record's whole (its newest EVIDENCE_KEPT), not news: on a derived row a derived write
   * then replaces what is stored, so a ref the record no longer has (a date made private, a line reported away) goes.
   * lib/social/derive.ts sets it; a declared row only ever gains evidence.
   */
  wholeEvidence?: boolean;
  valence?: Valence;
  closeness?: number;
  status?: TieStatus;
  visibility?: Visibility;
  /** Merged over the stored detail, key by key. */
  detail?: Record<string, unknown>;
  story?: string | null;
  since_text?: string | null;
  origin_model?: string | null;
  prompt_version?: string | null;
  confidence?: number;
  started_at?: string | Date | null;
  ended_at?: string | Date | null;
  /** `dated` only: the layer its stage puts it on (kinds.ts layerOfDated). Every other kind's layer is its registry's. */
  layer?: Layer;
  created_by?: string | null;
  /** Who did it, for the event log: a person's id, or "system" (the default). */
  actor?: string;
};

/** What a tie write did. `event` is the one event it logged, or null when nothing changed (the write was a repeat). */
export type TieWrite =
  | { ok: true; tie: Tie; event: TieEvent | null }
  | { ok: false; reason: TieRefusal };
/** Why a tie write was refused. */
export type TieRefusal = "off" | "unknown_kind" | "self" | "exclusive" | "not_found" | "too_long" | "unsafe";

/** One social_tie_events row. */
export type TieEventRow = {
  id: number;
  tie_id: string;
  event: TieEvent;
  /** `{field: [from, to]}`, a detail key as `detail.<key>`. Never the person columns: `actor` says who. */
  changes: Record<string, [unknown, unknown]>;
  source: Source | null;
  source_ref: string | null;
  /** A person's id or "system". Server-only. */
  actor: string | null;
  at: string;
};

/** An off-screen person (social_people). The relation is the tie from the holder to them. */
export type SocialPerson = {
  id: string;
  holder_id: string;
  name: string;
  pronouns: string | null;
  note: string | null;
  deceased: boolean;
  visibility: Visibility;
  source: Source;
  origin_model: string | null;
  prompt_version: string | null;
  created_by: string | null;
  /** The character this person became, once promoted. */
  promoted_to: string | null;
  created_at: string;
  updated_at: string;
};
/** The most off-screen people a character can have. */
export const PEOPLE_CAP = 12;

/** The kinds of place in the shared world. */
export const PLACE_KINDS = ["city", "neighbourhood", "workplace", "venue", "school", "club", "hangout", "house", "hometown"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** A place in the shared world (social_places). */
export type SocialPlace = {
  id: string;
  /** Unique and normalised: `venue:dive_bar`, `house:kitchen`, `hometown:leeds`, `neighbourhood:the-front`. */
  key: string;
  kind: PlaceKind;
  name: string;
  parent_id: string | null;
  /** A date venue's id (lib/venues.ts) when the place is one. */
  venue_id: string | null;
  description: string | null;
  visibility: Visibility;
  source: Source;
  origin_model: string | null;
  created_by: string | null;
  created_at: string;
};

/** What a place write gives (lib/social/places.ts ensurePlace). The id is a hash of the key, the same everywhere. */
export type PlaceInput = {
  key: string;
  kind: PlaceKind;
  name: string;
  /** The place it's in, by key (a venue's neighbourhood, a neighbourhood's city, a room's house). */
  parentKey?: string | null;
  venue_id?: string | null;
  description?: string | null;
  visibility?: Visibility;
  source: Source;
  origin_model?: string | null;
  created_by?: string | null;
};

/** How a character belongs to a place. Three `visited`s of a venue make a `regular`. */
export const PLACE_ROLES = ["lives", "works", "regular", "studied", "from", "visited"] as const;
export type PlaceRole = (typeof PLACE_ROLES)[number];

/** A character's membership of a place (social_place_members). */
export type PlaceMembership = {
  place_id: string;
  character_id: string;
  role: PlaceRole;
  since_text: string | null;
  started_at: string | null;
  ended_at: string | null;
  source: Source;
  visibility: Visibility;
  /** `{visits}` on a venue's `visited` and `regular`, `{seasons}` on the house. */
  detail: Record<string, unknown>;
  origin_model: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** What a membership write gives (lib/social/places.ts setMembership). */
export type MembershipInput = {
  placeId: string;
  characterId: string;
  role: PlaceRole;
  source: Source;
  visibility?: Visibility;
  since_text?: string | null;
  started_at?: string | Date | null;
  ended_at?: string | Date | null;
  /** Merged over the stored detail, key by key. */
  detail?: Record<string, unknown>;
  origin_model?: string | null;
  created_by?: string | null;
};
