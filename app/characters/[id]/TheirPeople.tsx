"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import Avatar from "@/app/Avatar";
import Sheet from "@/app/Sheet";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import { shortName } from "@/lib/names";
import type { WorldMenu } from "@/lib/social/circles";
import type { PeopleOne, PeoplePlace, PeopleTie, TheirPeople as View } from "@/lib/social/declare";
import { LAYER_WORDS, NEW_PLACE_FOR, personChoices, ROLE_WORDS, tieChoices, type DeclaredRole, type TieChoice } from "@/lib/social/relations";
import { LAYERS } from "@/lib/social/types";
import MightKnow, { type Suggestion } from "./MightKnow";
import { okJson } from "@/lib/ok-json";

/** A character the tie form can pick: one of yours, or someone else's public one. */
type Candidate = { id: string; name: string; portrait: string | null; hue: number | null; mine: boolean };

/** Which sheet is open: a person, a tie or a place, new (null) or one to change. */
type Open = { what: "person"; person: PeopleOne | null } | { what: "tie"; tie: PeopleTie | null; pick: Candidate | null } | { what: "place"; place: PeoplePlace | null } | null;

/** The roles the place form offers, in its order. */
const ROLES: DeclaredRole[] = ["lives", "works", "regular", "studied"];
const NEW_PLACE = "__new";

const str = (f: FormData, k: string): string => String(f.get(k) ?? "").trim();

/**
 * "Their people" (docs/PRDs/social-network.md sections 6.2 and 9), the People tab of a character page: who's in their
 * life off the show, their ties to other characters by layer, and where they live, work and go. Everyone sees what's
 * public; the owner also sees what's theirs (owner-only items, proposals), and changes it in a sheet: an off-screen
 * person, a tie (live at once between two of theirs; a proposal the other owner answers otherwise), a place. A
 * proposal to their character waits at the top with Yes and No. "Might know" (lib/social/suggest.ts) sits at the foot
 * for the owner, each one a tie away.
 */
export default function TheirPeople({ view, menu, suggest }: { view: View; menu: WorldMenu | null; suggest: boolean }) {
  const [open, setOpen] = useState<Open>(null);
  const first = shortName(view.character.name) || view.character.name;
  const edit = view.character.editable;
  const url = `/api/characters/${encodeURIComponent(view.character.id)}/circle`;
  const close = () => setOpen(null);

  const waiting = view.ties.filter((t) => t.waiting === "on_you");
  const shown = view.ties.filter((t) => t.waiting !== "on_you" && t.layer !== "communication");
  const met = shown.filter((t) => t.layer === "acquaintance");
  const layers = LAYERS.filter((l) => l !== "acquaintance" && l !== "communication").flatMap((layer) => {
    const ties = shown.filter((t) => t.layer === layer);
    return ties.length ? [{ layer, ties }] : [];
  });
  const empty = !view.people.length && !shown.length && !view.places.length && !waiting.length;

  return (
    <section className="card their-people" id="people" aria-labelledby="people-title" data-track-area="their-people">
      <h2 id="people-title">{first}&apos;s people</h2>
      {edit ? (
        <p className="muted small">
          Who&apos;s in {first}&apos;s life off the show: family, friends, work and where they live. What&apos;s public shows here for everyone; &quot;Only you&quot;
          items show only to you.
        </p>
      ) : (
        empty && <p className="muted small">Nobody here yet.</p>
      )}

      {waiting.length > 0 && (
        <div className="people-group people-waiting" aria-labelledby="people-waiting-title">
          <h3 id="people-waiting-title">Waiting on you</h3>
          <ul className="people-list">
            {waiting.map((t) => (
              <WaitingRow key={t.id} url={url} tie={t} first={first} />
            ))}
          </ul>
        </div>
      )}

      {view.people.length > 0 && (
        <div className="people-group">
          <h3>Off the show</h3>
          <ul className="people-list">
            {view.people.map((p) => (
              <li key={p.id} className="people-row">
                <span className="people-who">
                  <span className="people-face" aria-hidden="true">
                    {p.emoji ?? "👤"}
                  </span>
                  <span className="people-text">
                    <strong>
                      {p.name}
                      {p.deceased && <span className="muted"> (late)</span>}
                    </strong>
                    <span className="muted small">
                      {p.line ?? "someone they know"}
                      {p.pronouns ? ` · ${p.pronouns}` : ""}
                      {p.since ? ` · since ${p.since}` : ""}
                    </span>
                    {p.note && <span className="small">{p.note}</span>}
                  </span>
                </span>
                <Tags only={p.visibility !== "public"} />
                {edit && p.declared && (
                  <button type="button" className="link-button people-edit" aria-label={`Change ${p.name}`} onClick={() => setOpen({ what: "person", person: p })}>
                    Edit
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {layers.map(({ layer, ties }) => (
        <div className="people-group" key={layer}>
          <h3>{LAYER_WORDS[layer]}</h3>
          <ul className="people-list">
            {ties.map((t) => (
              <li key={t.id} className="people-row">
                <Link className="people-who" href={`/characters/${t.other.id}`}>
                  <Avatar seed={t.other.id} name={t.other.name} hue={t.other.hue} portraitSrc={t.other.portrait} size={40} round decorative />
                  <span className="people-text">
                    <strong>{t.other.name}</strong>
                    <span className="muted small">
                      {t.emoji} {t.line}
                      {t.since ? ` · since ${t.since}` : ""}
                    </span>
                    {t.story && <span className="small">{t.story}</span>}
                  </span>
                </Link>
                <Tags only={t.visibility !== "public"} ended={t.status === "ended"} asked={t.waiting === "on_them"} />
                {edit && t.declared && (
                  <button type="button" className="link-button people-edit" aria-label={`Change ${t.other.name}`} onClick={() => setOpen({ what: "tie", tie: t, pick: null })}>
                    Edit
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {met.length > 0 && (
        <div className="people-group">
          <h3>{LAYER_WORDS.acquaintance}</h3>
          <p className="people-met small">
            {met.slice(0, 12).map((t, i) => (
              <span key={t.id}>
                {i > 0 && ", "}
                <Link href={`/characters/${t.other.id}`}>{t.other.name}</Link> <span className="muted">({t.line})</span>
              </span>
            ))}
            {met.length > 12 && <span className="muted"> and {met.length - 12} more</span>}
          </p>
        </div>
      )}

      {view.places.length > 0 && (
        <div className="people-group">
          <h3>Places</h3>
          <ul className="people-list">
            {view.places.map((p) => (
              <li key={`${p.place_id}|${p.role}`} className="people-row">
                <span className="people-who">
                  <span className="people-face" aria-hidden="true">
                    📍
                  </span>
                  <span className="people-text">
                    <strong>{p.words}</strong>
                    {(p.since || p.others.length > 0) && (
                      <span className="muted small">
                        {p.since ? `Since ${p.since}` : ""}
                        {p.since && p.others.length ? " · " : ""}
                        {p.others.length > 0 && (
                          <>
                            {p.role === "works" || p.role === "studied" ? "with " : "like "}
                            {p.others.slice(0, 4).map((o, i) => (
                              <span key={o.id}>
                                {i > 0 && ", "}
                                <Link href={`/characters/${o.id}`}>{shortName(o.name) || o.name}</Link>
                              </span>
                            ))}
                            {p.others.length > 4 && ` and ${p.others.length - 4} more`}
                          </>
                        )}
                      </span>
                    )}
                  </span>
                </span>
                <Tags only={p.visibility !== "public"} />
                {edit && p.declared && (
                  <button type="button" className="link-button people-edit" aria-label={`Change ${p.words}`} onClick={() => setOpen({ what: "place", place: p })}>
                    Edit
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {edit && (
        <>
          {empty && <p className="muted">Nobody yet. Start with family or a best friend; a job and a neighbourhood make them neighbours and coworkers of others.</p>}
          <div className="people-add">
            <button type="button" className="secondary small" aria-haspopup="dialog" onClick={() => setOpen({ what: "person", person: null })}>
              + Someone off the show
            </button>
            <button type="button" className="secondary small" aria-haspopup="dialog" onClick={() => setOpen({ what: "tie", tie: null, pick: null })}>
              + Someone on the show
            </button>
            <button type="button" className="secondary small" aria-haspopup="dialog" onClick={() => setOpen({ what: "place", place: null })}>
              + A place
            </button>
          </div>
        </>
      )}

      {edit && suggest && (
        <MightKnow
          characterId={view.character.id}
          name={view.character.name}
          embedded
          onKnow={(s: Suggestion) => setOpen({ what: "tie", tie: null, pick: { id: s.id, name: s.name, portrait: s.portrait, hue: s.hue, mine: s.mine ?? false } })}
        />
      )}

      {open?.what === "person" && <PersonSheet url={url} first={first} person={open.person} onClose={close} />}
      {open?.what === "tie" && <TieSheet url={url} first={first} tie={open.tie} pick={open.pick} onClose={close} />}
      {open?.what === "place" && menu && <PlaceSheet url={url} first={first} menu={menu} place={open.place} onClose={close} />}
    </section>
  );
}

/** The small labels after an item: who sees it, and where it stands. */
function Tags({ only, ended = false, asked = false }: { only: boolean; ended?: boolean; asked?: boolean }) {
  if (!only && !ended && !asked) return null;
  return (
    <span className="people-tags">
      {asked && <span className="people-tag">Asked</span>}
      {ended && <span className="people-tag">Past</span>}
      {only && <span className="people-tag">Only you</span>}
    </span>
  );
}

/** A proposal to this character: "Bo's owner says Bo is Ada's sister", Yes or No. */
function WaitingRow({ url, tie, first }: { url: string; tie: PeopleTie; first: string }) {
  const { busy, error, run } = useAction();
  const them = shortName(tie.other.name) || tie.other.name;
  const answer = (yes: boolean) => run(() => requestJson(url, { action: "answer_tie", tie_id: tie.id, answer: yes ? "yes" : "no" }));
  return (
    <li className="people-row people-row-waiting">
      <Link className="people-who" href={`/characters/${tie.other.id}`}>
        <Avatar seed={tie.other.id} name={tie.other.name} hue={tie.other.hue} portraitSrc={tie.other.portrait} size={40} round decorative />
        <span className="people-text">
          <strong>{tie.other.name}</strong>
          <span className="muted small">
            {them}&apos;s owner says {them} is {first}&apos;s {tie.label}.
          </span>
          {tie.story && <span className="small">{tie.story}</span>}
        </span>
      </Link>
      <span className="people-answer">
        <button type="button" className="small" disabled={busy} onClick={() => void answer(true)}>
          Yes
        </button>
        <button type="button" className="secondary small" disabled={busy} onClick={() => void answer(false)}>
          No
        </button>
      </span>
      {error && (
        <p className="sheet-error people-row-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** The person form: add someone off the show, or change one (and take them off). */
function PersonSheet({ url, first, person, onClose }: { url: string; first: string; person: PeopleOne | null; onClose: () => void }) {
  const { busy, error, run } = useAction();
  const choices = personChoices("owner");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const body = {
      name: str(f, "name"),
      relation: str(f, "relation"),
      pronouns: str(f, "pronouns") || null,
      note: str(f, "note") || null,
      deceased: f.get("deceased") === "on",
      visibility: f.get("visibility") === "owner" ? "owner" : "public",
    };
    void run(async () => {
      const r = await requestJson(url, person ? { action: "edit_person", person_id: person.id, person: body } : { action: "add_person", person: body });
      if (r.ok) onClose();
      return r;
    });
  }
  const remove = () =>
    run(async () => {
      const r = await requestJson(url, { action: "remove_person", person_id: person!.id });
      if (r.ok) onClose();
      return r;
    });
  return (
    <Sheet open onClose={() => !busy && onClose()} title={person ? `Change ${person.name}` : `Someone in ${first}'s life`}>
      <form className="people-form" onSubmit={submit}>
        <label>
          Name
          <input name="name" required maxLength={40} defaultValue={person?.name ?? ""} autoComplete="off" />
        </label>
        <label>
          Who they are to {first}
          <RelationSelect name="relation" choices={choices} defaultValue={person?.kind ?? ""} />
        </label>
        <label>
          Pronouns <span className="muted small">(optional)</span>
          <input name="pronouns" maxLength={20} defaultValue={person?.pronouns ?? ""} placeholder="she/her" autoComplete="off" />
        </label>
        <label>
          A line about them <span className="muted small">(optional)</span>
          <textarea name="note" maxLength={160} rows={2} defaultValue={person?.note ?? ""} placeholder="Runs the bakery and judges everyone's bread." />
        </label>
        <label className="check">
          <input type="checkbox" name="deceased" defaultChecked={person?.deceased ?? false} />
          They&apos;ve died (they&apos;re remembered)
        </label>
        <Visibility value={person?.visibility === "public" || !person ? "public" : "owner"} />
        <div className="sheet-actions">
          {person && (
            <button type="button" className="link-button danger" disabled={busy} onClick={() => void remove()}>
              Take them off
            </button>
          )}
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : person ? "Save" : "Add"}
          </button>
        </div>
        {error && (
          <p className="sheet-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}

/** A relation picker: the kinds by layer, each as it reads ("Sibling", "Mentee", "Has a crush on them"). */
function RelationSelect({ name, choices, defaultValue }: { name: string; choices: TieChoice[]; defaultValue: string }) {
  return (
    <select name={name} required defaultValue={defaultValue}>
      <option value="" disabled>
        Pick one
      </option>
      {LAYERS.flatMap((layer) => {
        const here = choices.filter((c) => c.layer === layer);
        return here.length
          ? [
              <optgroup key={layer} label={LAYER_WORDS[layer]}>
                {here.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.label}
                  </option>
                ))}
              </optgroup>,
            ]
          : [];
      })}
    </select>
  );
}

/** Who sees an item: everyone, or only the owner. */
function Visibility({ value }: { value: "public" | "owner" }) {
  return (
    <fieldset className="people-visibility">
      <legend>Who sees this</legend>
      <label className="check">
        <input type="radio" name="visibility" value="public" defaultChecked={value === "public"} />
        Everyone
      </label>
      <label className="check">
        <input type="radio" name="visibility" value="owner" defaultChecked={value === "owner"} />
        Only you
      </label>
    </fieldset>
  );
}

/**
 * The tie form. New: find a character (yours first), pick how they know each other, and add it (two of yours) or ask
 * the other owner (someone else's: warm kinds only). An existing one: its story, who sees it, and ending it.
 */
function TieSheet({ url, first, tie, pick, onClose }: { url: string; first: string; tie: PeopleTie | null; pick: Candidate | null; onClose: () => void }) {
  const { busy, error, run } = useAction();
  const [who, setWho] = useState<Candidate | null>(pick);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Candidate[] | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (tie || who || query.length < 2) {
      setFound(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      fetch(`${url}?q=${encodeURIComponent(query)}`)
        .then(okJson)
        .then((data: { candidates?: Candidate[] } | null) => {
          if (live) setFound(Array.isArray(data?.candidates) ? data.candidates : []);
        })
        .catch(() => live && setFound([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, url, tie, who]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const visibility = f.get("visibility") === "owner" ? "owner" : "public";
    const story = str(f, "story") || null;
    const since = str(f, "since") || null;
    void run(async () => {
      if (tie) {
        // Only what changed: the story is the words of the owner who declared it.
        const patch: Record<string, unknown> = {};
        if (visibility !== tie.visibility) patch.visibility = visibility;
        if ((story ?? null) !== (tie.story ?? null)) patch.story = story;
        if ((since ?? null) !== (tie.since ?? null)) patch.since = since;
        if (!Object.keys(patch).length) {
          onClose();
          return null;
        }
        const r = await requestJson(url, { action: "edit_tie", tie_id: tie.id, ...patch });
        if (r.ok) onClose();
        return r;
      }
      if (!who) return "Pick who first.";
      const r = await requestJson(url, { action: "declare_tie", with: who.id, relation: str(f, "relation"), story, since, visibility });
      if (r.ok) onClose();
      return r;
    });
  }
  const end = () =>
    run(async () => {
      const r = await requestJson(url, { action: "end_tie", tie_id: tie!.id });
      if (r.ok) onClose();
      return r;
    });

  const them = who ? shortName(who.name) || who.name : tie ? shortName(tie.other.name) || tie.other.name : "";
  const endWords = !tie ? "" : tie.waiting === "on_them" ? "Withdraw the ask" : tie.layer === "kin" ? "Take it off" : tie.status === "ended" ? "" : "End it";
  return (
    <Sheet open onClose={() => !busy && onClose()} title={tie ? `${first} and ${them}` : `Someone ${first} knows on the show`}>
      <form className="people-form" onSubmit={submit}>
        {tie ? (
          <p>
            {them} is {first}&apos;s {tie.label}
            {tie.waiting === "on_them" ? `, if ${them}'s owner says yes.` : tie.status === "ended" ? ", in the past." : "."}
          </p>
        ) : who ? (
          <div className="people-picked">
            <Avatar seed={who.id} name={who.name} hue={who.hue} portraitSrc={who.portrait} size={40} round decorative />
            <strong>{who.name}</strong>
            {!pick && (
              <button type="button" className="link-button" onClick={() => setWho(null)}>
                Change
              </button>
            )}
          </div>
        ) : (
          <>
            <label>
              Who
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a character by name" autoComplete="off" autoFocus />
            </label>
            {found && (
              <ul className="people-found" aria-label="Characters">
                {found.length ? (
                  found.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="people-found-pick" onClick={() => setWho(c)}>
                        <Avatar seed={c.id} name={c.name} hue={c.hue} portraitSrc={c.portrait} size={32} round decorative />
                        <span>{c.name}</span>
                        {c.mine && <span className="people-tag">Yours</span>}
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="muted small">No one by that name. The show&apos;s own characters take their ties from the show.</li>
                )}
              </ul>
            )}
          </>
        )}
        {!tie && who && (
          <>
            <label>
              {them} is {first}&apos;s
              <RelationSelect name="relation" choices={tieChoices("owner", { own: who.mine })} defaultValue="" />
            </label>
            {!who.mine && (
              <p className="muted small">
                {them} is someone else&apos;s character: their owner says yes or no, and it shows once they do. Only warm ties go to someone else&apos;s character; rivalries
                come from what airs.
              </p>
            )}
          </>
        )}
        {(tie || who) && (
          <>
            <label>
              How it goes <span className="muted small">(optional)</span>
              <textarea name="story" maxLength={240} rows={2} defaultValue={tie?.story ?? ""} placeholder="They shared a flat through university and still split a newspaper." />
            </label>
            <label>
              Since <span className="muted small">(optional)</span>
              <input name="since" maxLength={40} defaultValue={tie?.since ?? ""} placeholder="school, 2019, forever" autoComplete="off" />
            </label>
            <Visibility value={tie && tie.visibility !== "public" ? "owner" : "public"} />
          </>
        )}
        <div className="sheet-actions">
          {tie && endWords && (
            <button type="button" className="link-button danger" disabled={busy} onClick={() => void end()}>
              {endWords}
            </button>
          )}
          {(tie || who) && (
            <button type="submit" disabled={busy}>
              {busy ? "Saving…" : tie ? "Save" : who?.mine ? "Add" : "Ask their owner"}
            </button>
          )}
        </div>
        {error && (
          <p className="sheet-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}

/** The place form: where they live, work, are a regular or studied; a new workplace or school can be named. */
function PlaceSheet({ url, first, menu, place, onClose }: { url: string; first: string; menu: WorldMenu; place: PeoplePlace | null; onClose: () => void }) {
  const { busy, error, run } = useAction();
  const [role, setRole] = useState<DeclaredRole>("lives");
  const [pickKey, setPickKey] = useState("");
  const options = placeOptions(menu, role);
  const naming = pickKey === NEW_PLACE;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    void run(async () => {
      const body = naming
        ? { action: "set_place", role, name: str(f, "name"), neighbourhood: str(f, "neighbourhood") || null }
        : { action: "set_place", role, place: str(f, "place") };
      const r = await requestJson(url, { ...body, since: str(f, "since") || null, visibility: f.get("visibility") === "owner" ? "owner" : "public" });
      if (r.ok) onClose();
      return r;
    });
  }
  const leave = () =>
    run(async () => {
      const r = await requestJson(url, { action: "leave_place", place_id: place!.place_id, role: place!.role });
      if (r.ok) onClose();
      return r;
    });

  if (place) {
    return (
      <Sheet open onClose={() => !busy && onClose()} title={place.words} fit>
        <p>
          {first}: {place.words.charAt(0).toLowerCase() + place.words.slice(1)}
          {place.since ? `, since ${place.since}` : ""}.
        </p>
        <div className="sheet-actions">
          <button type="button" className="link-button danger" disabled={busy} onClick={() => void leave()}>
            Take them out of here
          </button>
        </div>
        {error && (
          <p className="sheet-error" role="alert">
            {error}
          </p>
        )}
      </Sheet>
    );
  }
  return (
    <Sheet open onClose={() => !busy && onClose()} title={`A place in ${first}'s life`}>
      <form className="people-form" onSubmit={submit}>
        <label>
          {first}…
          <select
            name="role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value as DeclaredRole);
              setPickKey("");
            }}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_WORDS[r].toLowerCase()}…
              </option>
            ))}
          </select>
        </label>
        <label>
          Where
          <select name="place" required value={pickKey} onChange={(e) => setPickKey(e.target.value)}>
            <option value="" disabled>
              Pick one
            </option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
            {NEW_PLACE_FOR[role] && <option value={NEW_PLACE}>Somewhere new…</option>}
          </select>
        </label>
        {naming && (
          <>
            <label>
              Its name
              <input name="name" required maxLength={60} placeholder={role === "studied" ? "Heartsease Sixth Form" : "The Salt Lantern"} autoComplete="off" />
            </label>
            <label>
              In
              <select name="neighbourhood" defaultValue="">
                <option value="">Somewhere in {menu.city.name}</option>
                {menu.neighbourhoods.map((n) => (
                  <option key={n.key} value={n.key}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label>
          Since <span className="muted small">(optional)</span>
          <input name="since" maxLength={40} placeholder="two winters, 2021" autoComplete="off" />
        </label>
        <Visibility value="public" />
        <div className="sheet-actions">
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Add"}
          </button>
        </div>
        {error && (
          <p className="sheet-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}

/** The places a role can be at, from the world's menu: neighbourhoods to live in, workplaces and hangouts to work at. */
function placeOptions(menu: WorldMenu, role: DeclaredRole): { key: string; label: string }[] {
  const hood = (n: string | null) => (n ? ` (${n})` : "");
  const work = menu.workplaces.filter((w) => (role === "studied" ? w.kind === "school" : role === "works")).map((w) => ({ key: w.key, label: `${w.name}${hood(w.neighbourhood)}` }));
  const hangouts = menu.hangouts.map((h) => ({ key: h.key, label: `${h.name}${hood(h.neighbourhood)}` }));
  switch (role) {
    case "lives":
      return menu.neighbourhoods.map((n) => ({ key: n.key, label: n.name }));
    case "works":
      return [...work, ...hangouts];
    case "regular":
      return hangouts;
    case "studied":
      return work;
  }
}
