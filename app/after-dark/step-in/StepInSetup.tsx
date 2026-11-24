"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import Avatar from "@/app/Avatar";
import CrisisNotice, { crisisFrom } from "@/app/CrisisNotice";
import { oneFaceGroups } from "@/lib/adult/pair-pick";
import { coverInScene, ROLEPLAY_COVERS } from "@/lib/adult/roleplay-covers";
import { ROLEPLAYS, type Roleplay } from "@/lib/adult/roleplays";
import { adultTagById, roleplayGroups } from "@/lib/adult/tags";
import { useAdultTagDemand } from "@/app/after-dark/useAdultTagDemand";
import type { BondMark } from "@/lib/adult/step-in-bond";
import type { StepInCharacter, StepInPlace } from "@/lib/adult/step-in";
import { inlineFaces, ofWhoKind, placeChoices, STORY_KIND_OWN, storyChoices, WHO_KIND_NOUN, whoKinds, type PlaceKind, type WhoKind } from "@/lib/adult/step-in-setup";
import { STORY_PLACE, type StoryPlace } from "@/lib/adult/step-in-shared";
import type { CrisisResources } from "@/lib/crisis";
import { premiseForYou } from "@/lib/roleplays";
import { CARD_OPENING_MAX, cardShownToYou, GENERIC_OPENINGS, premiseShownToYou } from "@/lib/scene-cards";
import { BondMarkTag } from "./[id]/StepInBond";
import PickSheet from "./PickSheet";

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

type Opening = 0 | 1 | 2 | "surprise" | "written";
type Sheet = "who" | "story" | "where";

const NO_RECENT: string[] = [];
const NO_STORY_PLACES: Record<string, StoryPlace> = {};
const NO_OWN: Roleplay[] = [];
const NO_BONDS: Record<string, BondMark> = {};
const NO_PLAYED: Record<string, number> = {};
/** How many of the page's faces a phone shows (three rows of three; app/ux/after-dark.css hides the rest there). */
const PHONE_FACES = 9;
/** A face tile's picture: asked for at this size, drawn as wide as its column. */
const FACE_PX = 240;

/** One of the cast as a tile: their portrait at a size a face can be told by, and their whole name. */
function Face({ c, on, bond, onPick }: { c: StepInCharacter; on: boolean; bond?: BondMark; onPick: (id: string) => void }) {
  return (
    <li>
      <button type="button" className={on ? "ad-si-face on" : "ad-si-face"} aria-pressed={on} title={c.name} onClick={() => onPick(c.id)} data-face={c.id}>
        <span className="ad-si-face-pic">
          <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house ?? false} portraitSrc={c.portrait} size={FACE_PX} decorative fill />
        </span>
        <span className="ad-si-face-name">{c.name}</span>
        <BondMarkTag mark={bond} className="ad-si-face-bond" />
      </button>
    </li>
  );
}

/**
 * Step in's set-up (lib/adult/step-in.ts startStepIn), four steps on one page: who, the story (a roleplay and which
 * side of it you play, or none), where, and how it opens. Everything shown about a roleplay is from the viewer's side
 * (lib/scene-cards.ts cardShownToYou: "you", the verbs agreeing). No prompt box: pictures to pick from and one optional
 * sentence.
 *
 * Each choice is made from pictures (David, 2026-11-24: "The character select should be more full screen so you can see
 * the characters. the role play is a long scroll in the dropdown it's a bad ux"). Who: the faces the viewer is likeliest
 * to want are on the page as tiles (the people from their scenes, then the house cast: lib/adult/step-in-setup.ts
 * inlineFaces), and everyone is in a sheet that takes the screen, with a search (./PickSheet.tsx). The story and the
 * place show what's chosen as one card, and are changed in the same kind of sheet: the stories as their posters by
 * kind, the places as their pictures. Once someone is picked the step shows just them, large, and the way to the rest.
 *
 * `own`: the roleplays the viewer wrote themselves (lib/adult/own-roleplay-card.ts ownRoleplays), first among the
 * stories and a kind of their own ("✨ Yours"). One whose story card is drafted reads like any other (how it starts, its
 * three openings); one that has none yet is told by what they wrote, with the openings a scene without a roleplay has.
 */
export default function StepInSetup({
  cast,
  recent = NO_RECENT,
  places,
  persona,
  personaLeftOut = false,
  personaHref,
  preselect,
  preselectRoleplay,
  preselectYou = 0,
  storyPlaces = NO_STORY_PLACES,
  own = NO_OWN,
  bonds = NO_BONDS,
  played = NO_PLAYED,
  sheetOpen = null,
}: {
  cast: StepInCharacter[];
  /** Who they've had scenes with, the latest first (shown first). */
  recent?: string[];
  places: StepInPlace[];
  /** The name the viewer goes by in scenes (lib/persona.ts), when After Dark's lines let it through. */
  persona: { name: string } | null;
  /** They have a persona and the scene's checks leave it out (lib/adult/step-in.ts stepInPersona). */
  personaLeftOut?: boolean;
  /** Where the persona is edited: the show's account page. */
  personaHref: string;
  /** A character to start on (?with=<id>). */
  preselect?: string | null;
  /** A roleplay to start on (?roleplay=<id>: "Set it up" on one of the shelf's cards). */
  preselectRoleplay?: string | null;
  /** Which side of that roleplay the viewer starts on (?you=1: a card whose cover shows the roleplay's first role). */
  preselectYou?: 0 | 1;
  /** Where each roleplay's own story is set (lib/adult/step-in.ts storyPlaces), by the roleplay's id. */
  storyPlaces?: Record<string, StoryPlace>;
  /** The viewer's own roleplays, the newest first, shaped like the show's. */
  own?: Roleplay[];
  /** How well the viewer knows each of them (lib/adult/step-in-bond-data.ts bondMarks): the level's name under a face. */
  bonds?: Record<string, BondMark>;
  /** The roleplays this viewer has played to their last beat (lib/adult/step-in.ts playedRoleplays). */
  played?: Record<string, number>;
  /** A sheet to start on (the page never passes one: it's how a test reads what a sheet lists). */
  sheetOpen?: Sheet | null;
}) {
  const router = useRouter();
  const [who, setWho] = useState<string | null>(cast.some((c) => c.id === preselect) ? preselect! : null);
  const homeId = places.find((p) => p.id === "venue:home")?.id ?? places[0]?.id ?? "";
  // Every roleplay there is to pick: the viewer's own, then the show's.
  const all: readonly Roleplay[] = useMemo(() => [...own, ...ROLEPLAYS], [own]);
  const [roleplayId, setRoleplayId] = useState(all.some((r) => r.id === preselectRoleplay) ? preselectRoleplay! : "");
  // Where: a roleplay starts where its own story is set (STORY_PLACE), until the viewer picks a place themselves.
  const [placeId, setPlaceId] = useState(roleplayId && storyPlaces[roleplayId] ? STORY_PLACE : homeId);
  const [placePicked, setPlacePicked] = useState(false);
  const [you, setYou] = useState<0 | 1>(all.some((r) => r.id === preselectRoleplay && r.roles) ? preselectYou : 0);
  const [opening, setOpening] = useState<Opening>("surprise");
  const [written, setWritten] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<CrisisResources | null>(null);
  // The sheet that's open, and what's typed in each one's search (the page's own search under "Who" is `query`).
  const [sheet, setSheet] = useState<Sheet | null>(sheetOpen);
  const [query, setQuery] = useState("");
  const [whoQuery, setWhoQuery] = useState("");
  // Women / Men / Non-binary: one choice for the page's faces and the sheet's, so "See all" opens on the same ones.
  const [whoKind, setWhoKind] = useState<WhoKind>("");
  const [storyQuery, setStoryQuery] = useState("");
  const [storyKind, setStoryKind] = useState("");
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeKind, setPlaceKind] = useState<PlaceKind | "">("");

  const character = cast.find((c) => c.id === who) ?? null;
  // Who to pick from: theirs, the house cast and everyone else, or what the search finds (lib/adult/pair-pick.ts, as on
  // the hub's picker). The page shows the first of them; the sheet, all.
  const kindsOfWho = useMemo(() => whoKinds(cast), [cast]);
  const pool = useMemo(() => ofWhoKind(cast, whoKind), [cast, whoKind]);
  const groups = useMemo(() => oneFaceGroups(pool, recent, query), [pool, recent, query]);
  const inline = useMemo(() => inlineFaces(groups), [groups]);
  const sheetGroups = useMemo(() => (sheet === "who" ? oneFaceGroups(pool, recent, whoQuery) : []), [sheet, pool, recent, whoQuery]);
  // Nobody showing: what's narrowing them, said back ("Nobody called “Sam”", "No women called “Sam”").
  const nobody = (q: string) => `${whoKind ? `No ${WHO_KIND_NOUN[whoKind]}` : "Nobody"} called “${q.trim()}”.`;
  const rp = all.find((r) => r.id === roleplayId) ?? null;
  // The roleplay's own place, when it has one: offered first under "Where", and where the scene starts unless they choose.
  const story = rp ? (storyPlaces[rp.id] ?? null) : null;
  const place: Pick<StepInPlace, "id" | "title" | "image" | "public"> | null =
    placeId === STORY_PLACE ? (story ? { id: STORY_PLACE, title: story.title, image: null, public: story.public } : null) : (places.find((p) => p.id === placeId) ?? null);
  const name = character ? first(character.name) : "them";
  const side = you === 1 ? "b" : "a";
  // The roleplay's card as the viewer reads it, and the three openings to pick from (the generic three with no roleplay).
  const card = useMemo(() => (rp?.card ? cardShownToYou(rp.card, side, name) : null), [rp, side, name]);
  // How it starts: the card's, or for one of the viewer's own with no card yet, what they wrote.
  const setup = card ? card.setup : rp ? premiseShownToYou(rp.premise, side, name) : null;
  // (They name who the viewer is with, so they wait for a pick: "when them walks in" reads wrong. Without a card the
  // generic three are read from the side the viewer plays, as the scene's first line will be.)
  const openings = !character ? [] : card ? card.openings : GENERIC_OPENINGS.map((o) => premiseForYou(o, rp ? side : "a", name));
  // Grouped by who they are to each other (each roleplay's first setup tag, lib/adult/tags.ts), most wanted first.
  const demand = useAdultTagDemand();
  const byCategory = useMemo(() => roleplayGroups(ROLEPLAYS, demand ?? undefined), [demand]);
  // The story sheet: the kinds to narrow by, and the stories showing, each told from the viewer's side with whoever
  // they've picked (or "someone", before they have).
  const stories = useMemo(() => (sheet === "story" ? storyChoices(own, byCategory, storyKind, storyQuery) : []), [sheet, own, byCategory, storyKind, storyQuery]);
  const teller = character ? first(character.name) : "someone";
  const told = (r: Roleplay) => (r.card ? cardShownToYou(r.card, "a", teller).setup : premiseShownToYou(r.premise, "a", teller));
  const shownPlaces = useMemo(() => (sheet === "where" ? placeChoices(places, placeQuery, placeKind) : []), [sheet, places, placeQuery, placeKind]);
  const publicPlaces = useMemo(() => places.filter((p) => p.public).length, [places]);
  // The story's poster beside its name, only when it's a picture of this pair as they'd play it (the one on the cover,
  // on the side it shows): anyone else's face beside this name would be a lie.
  const poster = rp && character ? coverInScene(rp.id, character.id, you) : null;

  const close = () => setSheet(null);
  function pickWho(id: string) {
    setWho(id);
    setQuery("");
    setWhoQuery("");
    close();
  }
  function pickStory(next: string) {
    setRoleplayId(next);
    setYou(0);
    if (opening !== "written") setOpening("surprise");
    // The scene follows the story to where it's set, unless they've chosen a place themselves; and a place that was
    // the last story's own goes with it.
    if (storyPlaces[next] && (!placePicked || placeId === STORY_PLACE)) setPlaceId(STORY_PLACE);
    else if (placeId === STORY_PLACE) setPlaceId(homeId);
    close();
  }
  function pickPlace(id: string) {
    setPlaceId(id);
    setPlacePicked(true);
    close();
  }

  async function start() {
    if (!character || !place || busy) return;
    setBusy(true);
    setError(null);
    setCrisis(null);
    try {
      const res = await fetch("/api/admin/after-dark/step-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          character_id: character.id,
          place: place.id,
          roleplay: rp ? { id: rp.id, you } : null,
          opening: opening === "written" ? (written.trim() ? { written } : "surprise") : opening,
        }),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      const help = crisisFrom(data);
      if (help) {
        setCrisis(help);
        return;
      }
      if (!res.ok || !data?.id) {
        setError(data?.message ?? "That didn't start. Try again in a moment.");
        return;
      }
      router.push(`/after-dark/step-in/${data.id}`);
    } catch {
      setError("That didn't start. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const personaLine = persona ? (
    <>
      You go by <strong>{persona.name}</strong> in scenes · <a href={personaHref}>edit who you are</a>
    </>
  ) : personaLeftOut ? (
    <span data-step-in-persona-left-out>
      Who you are in scenes isn&apos;t used here: it mentions something these scenes leave out (anyone&apos;s family, anyone young, school, or someone kept from
      saying no). <a href={personaHref}>Edit it</a>, or play without.
    </span>
  ) : (
    <>
      They don&apos;t know who you are in scenes yet. <a href={personaHref}>Add a name, a look and a line about you</a>, or play without.
    </>
  );
  const matches = (n: number) => `${n} ${n === 1 ? "match" : "matches"}`;

  return (
    <div className="ad-si-setup" data-step-in-build>
      <section className="card ad-si-step" aria-labelledby="ad-si-step-who">
        <header className="ad-si-step-head">
          <h3 id="ad-si-step-who">
            <span className="ad-si-step-n" aria-hidden="true">
              1
            </span>{" "}
            Who
          </h3>
        </header>
        {character ? (
          // Just them, large, and the way to everyone else.
          <div className="ad-si-chosen" data-step-in-who={character.id}>
            <span className="ad-si-chosen-pic ad-si-chosen-face">
              <Avatar seed={character.id} name={character.name} hue={character.hue} house={character.house ?? false} portraitSrc={character.portrait} size={FACE_PX} decorative fill eager />
            </span>
            <div className="ad-si-chosen-body">
              <p className="ad-si-chosen-title">
                <strong>{character.name}</strong>
                <BondMarkTag mark={bonds[character.id]} className="ad-si-face-bond" />
              </p>
              <p className="muted small">{personaLine}</p>
              <p className="ad-si-chosen-go">
                <button type="button" className="button-ghost small" onClick={() => setSheet("who")} data-step-in-pick="who">
                  Pick someone else
                </button>
              </p>
            </div>
          </div>
        ) : (
          <>
            <input
              type="search"
              className="ad-si-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${cast.length} ${cast.length === 1 ? "character" : "characters"} by name`}
              aria-label="Search the cast by name"
              autoComplete="off"
              spellCheck={false}
              data-step-in-search
            />
            {kindsOfWho.length > 0 && (
              <div className="ad-scenes-cats ad-si-kinds" role="radiogroup" aria-label="Show only">
                {kindsOfWho.map((k) => (
                  <button key={k.id || "all"} type="button" role="radio" aria-checked={whoKind === k.id} className={whoKind === k.id ? "on" : undefined} onClick={() => setWhoKind(k.id)} data-step-in-who-kind={k.id || "all"}>
                    {k.label}
                    <span className="ad-scenes-count">{k.count}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="sr-only" aria-live="polite">
              {query.trim() || whoKind ? matches(inline.shown + inline.more) : ""}
            </p>
            <div role="group" aria-label="Who you're in the scene with">
              {inline.shown ? (
                // One run of faces, the likeliest first (the people from their scenes, who carry how well they're
                // known, then the house cast): the sheet has them under their headings.
                <ul className="ad-si-faces ad-si-faces-page">
                  {inline.groups.flatMap((g) => g.faces.map((c) => <Face key={c.id} c={c} on={false} bond={bonds[c.id]} onPick={pickWho} />))}
                </ul>
              ) : (
                <p className="muted small ad-si-none">
                  {nobody(query)}{" "}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setQuery("");
                      setWhoKind("");
                    }}
                  >
                    Show everyone
                  </button>
                </p>
              )}
            </div>
            {/* Everyone, in the sheet. With a cast small enough to fit the page it's still the way to them on a phone,
                which shows the first nine (the stylesheet's). */}
            {inline.shown + inline.more > PHONE_FACES && (
              <p className={inline.more > 0 ? "ad-si-more" : "ad-si-more ad-si-more-phone"}>
                <button
                  type="button"
                  className="button-ghost small"
                  onClick={() => {
                    // What they've typed goes with them: the sheet opens on the same search.
                    setWhoQuery(query);
                    setSheet("who");
                  }}
                  data-step-in-pick="who"
                >
                  {query.trim() ? `See all ${matches(inline.shown + inline.more)}` : whoKind ? `See all ${pool.length} ${WHO_KIND_NOUN[whoKind]}` : `See all ${cast.length} characters`}
                </button>
              </p>
            )}
            <p className="muted small">{personaLine}</p>
          </>
        )}
      </section>

      <section className="card ad-si-step" aria-labelledby="ad-si-step-story">
        <header className="ad-si-step-head">
          <h3 id="ad-si-step-story">
            <span className="ad-si-step-n" aria-hidden="true">
              2
            </span>{" "}
            The story
          </h3>
        </header>
        {rp ? (
          <div className="ad-si-chosen" data-step-in-story={rp.id}>
            <span className="ad-si-chosen-pic">
              {poster ? (
                // The show's own picture (public/cast), so discreet mode leaves it alone like any house portrait.
                // eslint-disable-next-line @next/next/no-img-element -- a small static file
                <img src={poster.src} alt="" width={960} height={720} decoding="async" style={{ objectPosition: `${poster.focus}% center` }} />
              ) : (
                <span className="ad-si-thumb-icon" aria-hidden="true">
                  {rp.icon}
                </span>
              )}
            </span>
            <div className="ad-si-chosen-body">
              <p className="ad-si-chosen-title">
                <strong>{rp.title}</strong>
                {played[rp.id] ? <span className="ad-si-shelf-played">✓ Played</span> : null}
              </p>
              {setup &&
                (character ? (
                  // How it starts, with "you" in it and their name: it waits for a pick, like the openings.
                  <p className="ad-si-card-setup">{setup}</p>
                ) : (
                  <p className="muted small">Pick who you&apos;re with to read how it starts.</p>
                ))}
              {rp.tags && rp.tags.length > 0 && <p className="ad-rp-tags">{rp.tags.map((t) => adultTagById(t)?.label).filter(Boolean).join(" · ")}</p>}
              {rp.roles && (
                <div className="ad-si-roles" role="radiogroup" aria-label="Who plays which role">
                  {([0, 1] as const).map((i) => (
                    <label key={i} className="check">
                      <input type="radio" name="ad-si-you" checked={you === i} onChange={() => setYou(i)} />
                      <span>
                        You play {rp.roles![i]}; {character ? `${name} plays` : "they play"} {rp.roles![i === 0 ? 1 : 0]}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {story && (
                <p className="muted small" data-step-in-story-at>
                  📍 Set at: {story.title}
                  {story.public ? " (out in public)" : ""}
                  {placeId === STORY_PLACE ? "." : ". You've picked somewhere else below; the story plays there."}
                </p>
              )}
              <p className="muted small">The roleplay is the story: its stakes and what each of you wants drive the scene. It ends when you end the scene.</p>
              <p className="ad-si-chosen-go">
                <button type="button" className="button-ghost small" onClick={() => setSheet("story")} data-step-in-pick="story">
                  Pick another story
                </button>
                <button type="button" className="link-button small" onClick={() => pickStory("")} data-step-in-story-none>
                  No roleplay
                </button>
              </p>
            </div>
          </div>
        ) : (
          <div className="ad-si-chosen" data-step-in-story="">
            <span className="ad-si-chosen-pic">
              <span className="ad-si-thumb-icon" aria-hidden="true">
                💬
              </span>
            </span>
            <div className="ad-si-chosen-body">
              <p className="ad-si-chosen-title">
                <strong>A date, as yourselves</strong>
              </p>
              <p className="muted small">No roleplay: the two of you, where you choose. Or play a story, with a goal to play for and an ending.</p>
              <p className="ad-si-chosen-go">
                <button type="button" className="button small" onClick={() => setSheet("story")} data-step-in-pick="story">
                  Pick a roleplay · {all.length}
                </button>
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="card ad-si-step" aria-labelledby="ad-si-step-where">
        <header className="ad-si-step-head">
          <h3 id="ad-si-step-where">
            <span className="ad-si-step-n" aria-hidden="true">
              3
            </span>{" "}
            Where
          </h3>
        </header>
        {place && (
          <div className="ad-si-chosen" data-step-in-place={place.id} {...(place.id === STORY_PLACE ? { "data-step-in-story-place": "" } : {})}>
            {/* The place itself, empty (the show's own backdrop, or a drawn set): a background, so discreet mode's blur
                leaves it alone. A small picture beside its name: under the menu it used to fill the card's whole width. */}
            {place.image ? (
              <span className="ad-si-chosen-pic ad-si-chosen-place" style={{ backgroundImage: `url("${place.image}")` }} aria-hidden="true" data-step-in-place-picture />
            ) : (
              <span className="ad-si-chosen-pic">
                <span className="ad-si-thumb-icon" aria-hidden="true">
                  📍
                </span>
              </span>
            )}
            <div className="ad-si-chosen-body">
              <p className="ad-si-chosen-title">
                <strong>{place.id === STORY_PLACE ? `Where the story is set: ${place.title}` : place.title}</strong>
              </p>
              {place.public && <p className="muted small">Out in public, a scene goes as far as a kiss. It can move somewhere private later, from the scene&apos;s ⋯ menu.</p>}
              <p className="ad-si-chosen-go">
                <button type="button" className="button-ghost small" onClick={() => setSheet("where")} data-step-in-pick="where">
                  Pick another place
                </button>
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="card ad-si-step" aria-labelledby="ad-si-step-opens">
        <header className="ad-si-step-head">
          <h3 id="ad-si-step-opens">
            <span className="ad-si-step-n" aria-hidden="true">
              4
            </span>{" "}
            How it opens
          </h3>
        </header>
        <div className="ad-si-openings" role="radiogroup" aria-label="How the scene opens">
          <label className="check">
            <input type="radio" name="ad-si-opening" checked={opening === "surprise"} onChange={() => setOpening("surprise")} />
            <span>Surprise me</span>
          </label>
          {openings.map((o, i) => (
            <label key={i} className="check">
              <input type="radio" name="ad-si-opening" checked={opening === i} onChange={() => setOpening(i as 0 | 1 | 2)} />
              <span>{o}</span>
            </label>
          ))}
          <label className="check">
            <input type="radio" name="ad-si-opening" checked={opening === "written"} onChange={() => setOpening("written")} />
            <span>One sentence of your own</span>
          </label>
        </div>
        {!character && <p className="muted small">Pick who you&apos;re with, and three ways it can open show here.</p>}
        {opening === "written" && (
          <>
            <label htmlFor="ad-si-written" className="sr-only">
              Your opening
            </label>
            <input id="ad-si-written" value={written} maxLength={CARD_OPENING_MAX} onChange={(e) => setWritten(e.target.value)} placeholder="I'm halfway through a crossword when they sit down." />
            <p className="muted small">One sentence of story: who is where, doing what. Nothing explicit here; the scene decides how far it goes.</p>
          </>
        )}
      </section>

      {crisis && <CrisisNotice resources={crisis} onClose={() => setCrisis(null)} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="ad-si-go ad-si-start">
        {/* With nobody picked it isn't a dead button: it opens the faces. */}
        <button type="button" className="primary" disabled={busy || (Boolean(character) && !place)} onClick={() => (character ? void start() : setSheet("who"))} data-step-in-start>
          {busy ? `${name} is on the way…` : character ? `Step in with ${name}` : "Pick who you're with"}
        </button>
        {character && place && (
          <span className="ad-si-start-what" data-step-in-summary>
            {character.name} · {rp ? rp.title : "A date, as yourselves"} · {place.title}
          </span>
        )}
        <span className="muted small">
          Replies are included (fair use). Both of you can stop at any time. <Link href="/after-dark/account">Your writer and privacy</Link>
        </span>
      </div>

      <PickSheet
        id="who"
        open={sheet === "who"}
        title="Who are you stepping in with?"
        lead={`${cast.length} in your After Dark: the people from your scenes, the house cast, and everyone you've switched in.`}
        onClose={close}
        search={{ value: whoQuery, onChange: setWhoQuery, placeholder: `Search ${cast.length} ${cast.length === 1 ? "character" : "characters"} by name`, label: "Search the cast by name" }}
        kinds={kindsOfWho.length ? { label: "Show only", options: kindsOfWho.map((k) => ({ ...k, id: k.id || "all" })), on: whoKind || "all", onPick: (id) => setWhoKind(id === "all" ? "" : (id as WhoKind)) } : undefined}
        status={whoQuery.trim() || whoKind ? matches(sheetGroups.reduce((n, g) => n + g.faces.length, 0)) : ""}
        grid="faces"
      >
        {sheetGroups.length ? (
          sheetGroups.map((g) => (
            <Fragment key={g.label}>
              <li className="ad-si-sheet-label">
                <h3>{g.label}</h3>
              </li>
              {g.faces.map((c) => (
                <Face key={c.id} c={c} on={c.id === who} bond={bonds[c.id]} onPick={pickWho} />
              ))}
            </Fragment>
          ))
        ) : (
          <li className="ad-si-sheet-label">
            <p className="muted">
              {nobody(whoQuery)}{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setWhoQuery("");
                  setWhoKind("");
                }}
              >
                Show everyone
              </button>
            </p>
          </li>
        )}
      </PickSheet>

      <PickSheet
        id="story"
        open={sheet === "story"}
        title="Pick a story"
        lead={character ? `For you and ${name}. Each has a goal to play for and an ending you're offered.` : "Each has a goal to play for and an ending you're offered."}
        onClose={close}
        search={{ value: storyQuery, onChange: setStoryQuery, placeholder: `Search ${all.length} roleplays`, label: "Search the roleplays" }}
        kinds={{
          label: "Kind of roleplay",
          on: storyKind,
          onPick: setStoryKind,
          options: [
            { id: "", label: "✨ All", count: all.length },
            ...(own.length > 0 ? [{ id: STORY_KIND_OWN, label: "Yours", count: own.length }] : []),
            ...byCategory.map((c) => ({ id: c.id, label: c.label, count: c.roleplays.length })),
          ],
        }}
        status={storyQuery.trim() ? matches(stories.length) : ""}
      >
        {!storyQuery.trim() && !storyKind && (
          <li>
            <button type="button" className={rp ? "ad-si-pick" : "ad-si-pick on"} aria-pressed={!rp} onClick={() => pickStory("")} data-story="">
              <span className="ad-si-pick-pic">
                <span className="ad-si-thumb-icon" aria-hidden="true">
                  💬
                </span>
              </span>
              <span className="ad-si-pick-body">
                <strong>No roleplay</strong>
                <span className="muted small">A date, as yourselves: the two of you, where you choose.</span>
              </span>
            </button>
          </li>
        )}
        {stories.map((r) => {
          const art = ROLEPLAY_COVERS[r.id];
          const at = storyPlaces[r.id];
          return (
            <li key={r.id}>
              <button type="button" className={r.id === roleplayId ? "ad-si-pick on" : "ad-si-pick"} aria-pressed={r.id === roleplayId} onClick={() => pickStory(r.id)} data-story={r.id}>
                <span className="ad-si-pick-pic">
                  {art ? (
                    // The story's poster (public/cast): one of the house cast in the part, whoever is picked.
                    // eslint-disable-next-line @next/next/no-img-element -- a small static file
                    <img src={art.src} alt="" width={960} height={720} loading="lazy" decoding="async" />
                  ) : (
                    <span className="ad-si-thumb-icon" aria-hidden="true">
                      {r.icon}
                    </span>
                  )}
                </span>
                <span className="ad-si-pick-body">
                  <strong>
                    <span aria-hidden="true">{r.icon}</span> {r.title}
                  </strong>
                  {(own.includes(r) || played[r.id]) && (
                    <span className="ad-si-pick-marks">
                      {own.includes(r) && <span className="kicker">Your own</span>}
                      {played[r.id] ? <span className="ad-si-shelf-played">✓ Played</span> : null}
                    </span>
                  )}
                  <span className="muted small ad-scene-premise">{told(r)}</span>
                  {at && (
                    <span className="muted small">
                      📍 {at.title}
                      {at.public ? " · out in public" : ""}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {stories.length === 0 && (
          <li className="ad-si-sheet-label">
            <p className="muted">
              No roleplay matches that.{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setStoryQuery("");
                  setStoryKind("");
                }}
              >
                Show them all
              </button>
            </p>
          </li>
        )}
      </PickSheet>

      <PickSheet
        id="where"
        open={sheet === "where"}
        title="Where"
        lead="Somewhere private goes as far as you take it. Out in public, a scene goes as far as a kiss."
        onClose={close}
        search={{ value: placeQuery, onChange: setPlaceQuery, placeholder: `Search ${places.length} places`, label: "Search the places" }}
        kinds={{
          label: "Private or out in public",
          on: placeKind,
          onPick: (id) => setPlaceKind(id as PlaceKind | ""),
          options: [
            { id: "", label: "✨ All", count: places.length },
            { id: "private", label: "Private", count: places.length - publicPlaces },
            { id: "public", label: "Out in public", count: publicPlaces },
          ],
        }}
        status={placeQuery.trim() ? matches(shownPlaces.length) : ""}
      >
        {story && !placeQuery.trim() && (!placeKind || (placeKind === "public") === story.public) && (
          <li>
            <button type="button" className={placeId === STORY_PLACE ? "ad-si-pick on" : "ad-si-pick"} aria-pressed={placeId === STORY_PLACE} onClick={() => pickPlace(STORY_PLACE)} data-place={STORY_PLACE}>
              <span className="ad-si-pick-pic">
                <span className="ad-si-thumb-icon" aria-hidden="true">
                  📍
                </span>
              </span>
              <span className="ad-si-pick-body">
                <strong>Where the story is set</strong>
                <span className="muted small">
                  {story.title}
                  {story.public ? " · out in public" : ""}
                </span>
              </span>
            </button>
          </li>
        )}
        {shownPlaces.map((p) => (
          <li key={p.id}>
            <button type="button" className={p.id === placeId ? "ad-si-pick on" : "ad-si-pick"} aria-pressed={p.id === placeId} onClick={() => pickPlace(p.id)} data-place={p.id}>
              {/* A background, like the chosen place's: discreet mode's blur is for people, not rooms. */}
              {p.image ? (
                <span className="ad-si-pick-pic" style={{ backgroundImage: `url("${p.image}")` }} aria-hidden="true" />
              ) : (
                <span className="ad-si-pick-pic">
                  <span className="ad-si-thumb-icon" aria-hidden="true">
                    📍
                  </span>
                </span>
              )}
              <span className="ad-si-pick-body">
                <strong>{p.title}</strong>
                {p.public && <span className="muted small">Out in public</span>}
              </span>
            </button>
          </li>
        ))}
        {shownPlaces.length === 0 && (
          <li className="ad-si-sheet-label">
            <p className="muted">
              No place called “{placeQuery.trim()}”.{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setPlaceQuery("");
                  setPlaceKind("");
                }}
              >
                Show them all
              </button>
            </p>
          </li>
        )}
      </PickSheet>
    </div>
  );
}
