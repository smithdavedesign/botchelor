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
import { useT } from "@/app/I18nProvider";

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
  const t = useT();
  const first = shortName(view.character.name) || view.character.name;
  const edit = view.character.editable;
  const url = `/api/characters/${encodeURIComponent(view.character.id)}/circle`;
  const close = () => setOpen(null);

  const waiting = view.ties.filter((tie) => tie.waiting === "on_you");
  const shown = view.ties.filter((tie) => tie.waiting !== "on_you" && tie.layer !== "communication");
  const met = shown.filter((tie) => tie.layer === "acquaintance");
  const layers = LAYERS.filter((l) => l !== "acquaintance" && l !== "communication").flatMap((layer) => {
    const ties = shown.filter((tie) => tie.layer === layer);
    return ties.length ? [{ layer, ties }] : [];
  });
  const empty = !view.people.length && !shown.length && !view.places.length && !waiting.length;

  return (
    <section className="card their-people" id="people" aria-labelledby="people-title" data-track-area="their-people">
      <h2 id="people-title">{t("{name}'s people", { name: first })}</h2>
      {edit ? (
        <p className="muted small">
          {t("Who's in {name}'s life off the show: family, friends, work and where they live. What's public shows here for everyone; \"Only you\" items show only to you.", { name: first })}
        </p>
      ) : (
        empty && <p className="muted small">{t("Nobody here yet.")}</p>
      )}

      {waiting.length > 0 && (
        <div className="people-group people-waiting" aria-labelledby="people-waiting-title">
          <h3 id="people-waiting-title">{t("Waiting on you")}</h3>
          <ul className="people-list">
            {waiting.map((tie) => (
              <WaitingRow key={tie.id} url={url} tie={tie} first={first} />
            ))}
          </ul>
        </div>
      )}

      {view.people.length > 0 && (
        <div className="people-group">
          <h3>{t("Off the show")}</h3>
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
                      {p.deceased && <span className="muted"> {t("(late)")}</span>}
                    </strong>
                    <span className="muted small">
                      {p.line ?? t("someone they know")}
                      {p.pronouns ? ` · ${p.pronouns}` : ""}
                      {p.since ? ` · ${t("since {when}", { when: p.since })}` : ""}
                    </span>
                    {p.note && <span className="small">{p.note}</span>}
                  </span>
                </span>
                <Tags only={p.visibility !== "public"} />
                {edit && p.declared && (
                  <button type="button" className="link-button people-edit" aria-label={t("Change {name}", { name: p.name })} onClick={() => setOpen({ what: "person", person: p })}>
                    {t("Edit")}
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
            {ties.map((tie) => (
              <li key={tie.id} className="people-row">
                <Link className="people-who" href={`/characters/${tie.other.id}`}>
                  <Avatar seed={tie.other.id} name={tie.other.name} hue={tie.other.hue} portraitSrc={tie.other.portrait} size={40} round decorative />
                  <span className="people-text">
                    <strong>{tie.other.name}</strong>
                    <span className="muted small">
                      {tie.emoji} {tie.line}
                      {tie.since ? ` · ${t("since {when}", { when: tie.since })}` : ""}
                    </span>
                    {tie.story && <span className="small">{tie.story}</span>}
                  </span>
                </Link>
                <Tags only={tie.visibility !== "public"} ended={tie.status === "ended"} asked={tie.waiting === "on_them"} />
                {edit && tie.declared && (
                  <button type="button" className="link-button people-edit" aria-label={t("Change {name}", { name: tie.other.name })} onClick={() => setOpen({ what: "tie", tie, pick: null })}>
                    {t("Edit")}
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
            {met.slice(0, 12).map((tie, i) => (
              <span key={tie.id}>
                {i > 0 && ", "}
                <Link href={`/characters/${tie.other.id}`}>{tie.other.name}</Link> <span className="muted">({tie.line})</span>
              </span>
            ))}
            {met.length > 12 && <span className="muted"> {t("and {n} more", { n: met.length - 12 })}</span>}
          </p>
        </div>
      )}

      {view.places.length > 0 && (
        <div className="people-group">
          <h3>{t("Places")}</h3>
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
                        {p.since ? t("Since {when}", { when: p.since }) : ""}
                        {p.since && p.others.length ? " · " : ""}
                        {p.others.length > 0 && (
                          <>
                            {p.role === "works" || p.role === "studied" ? `${t("with")} ` : `${t("like")} `}
                            {p.others.slice(0, 4).map((o, i) => (
                              <span key={o.id}>
                                {i > 0 && ", "}
                                <Link href={`/characters/${o.id}`}>{shortName(o.name) || o.name}</Link>
                              </span>
                            ))}
                            {p.others.length > 4 && ` ${t("and {n} more", { n: p.others.length - 4 })}`}
                          </>
                        )}
                      </span>
                    )}
                  </span>
                </span>
                <Tags only={p.visibility !== "public"} />
                {edit && p.declared && (
                  <button type="button" className="link-button people-edit" aria-label={t("Change {name}", { name: p.words })} onClick={() => setOpen({ what: "place", place: p })}>
                    {t("Edit")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {edit && (
        <>
          {empty && <p className="muted">{t("Nobody yet. Start with family or a best friend; a job and a neighbourhood make them neighbours and coworkers of others.")}</p>}
          <div className="people-add">
            <button type="button" className="secondary small" aria-haspopup="dialog" onClick={() => setOpen({ what: "person", person: null })}>
              + {t("Someone off the show")}
            </button>
            <button type="button" className="secondary small" aria-haspopup="dialog" onClick={() => setOpen({ what: "tie", tie: null, pick: null })}>
              + {t("Someone on the show")}
            </button>
            <button type="button" className="secondary small" aria-haspopup="dialog" onClick={() => setOpen({ what: "place", place: null })}>
              + {t("A place")}
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
  const t = useT();
  if (!only && !ended && !asked) return null;
  return (
    <span className="people-tags">
      {asked && <span className="people-tag">{t("Asked")}</span>}
      {ended && <span className="people-tag">{t("Past")}</span>}
      {only && <span className="people-tag">{t("Only you")}</span>}
    </span>
  );
}

/** A proposal to this character: "Bo's owner says Bo is Ada's sister", Yes or No. */
function WaitingRow({ url, tie, first }: { url: string; tie: PeopleTie; first: string }) {
  const { busy, error, run } = useAction();
  const t = useT();
  const them = shortName(tie.other.name) || tie.other.name;
  const answer = (yes: boolean) => run(() => requestJson(url, { action: "answer_tie", tie_id: tie.id, answer: yes ? "yes" : "no" }));
  return (
    <li className="people-row people-row-waiting">
      <Link className="people-who" href={`/characters/${tie.other.id}`}>
        <Avatar seed={tie.other.id} name={tie.other.name} hue={tie.other.hue} portraitSrc={tie.other.portrait} size={40} round decorative />
        <span className="people-text">
          <strong>{tie.other.name}</strong>
          <span className="muted small">
            {t("{them}'s owner says {them} is {name}'s {relation}.", { them, name: first, relation: tie.label })}
          </span>
          {tie.story && <span className="small">{tie.story}</span>}
        </span>
      </Link>
      <span className="people-answer">
        <button type="button" className="small" disabled={busy} onClick={() => void answer(true)}>
          {t("Yes")}
        </button>
        <button type="button" className="secondary small" disabled={busy} onClick={() => void answer(false)}>
          {t("No")}
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
  const t = useT();
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
    <Sheet open onClose={() => !busy && onClose()} title={person ? t("Change {name}", { name: person.name }) : t("Someone in {name}'s life", { name: first })}>
      <form className="people-form" onSubmit={submit}>
        <label>
          {t("Name")}
          <input name="name" required maxLength={40} defaultValue={person?.name ?? ""} autoComplete="off" />
        </label>
        <label>
          {t("Who they are to {name}", { name: first })}
          <RelationSelect name="relation" choices={choices} defaultValue={person?.kind ?? ""} />
        </label>
        <label>
          {t("Pronouns")} <span className="muted small">{t("(optional)")}</span>
          <input name="pronouns" maxLength={20} defaultValue={person?.pronouns ?? ""} placeholder={t("she/her")} autoComplete="off" />
        </label>
        <label>
          {t("A line about them")} <span className="muted small">{t("(optional)")}</span>
          <textarea name="note" maxLength={160} rows={2} defaultValue={person?.note ?? ""} placeholder={t("Runs the bakery and judges everyone's bread.")} />
        </label>
        <label className="check">
          <input type="checkbox" name="deceased" defaultChecked={person?.deceased ?? false} />
          {t("They've died (they're remembered)")}
        </label>
        <Visibility value={person?.visibility === "public" || !person ? "public" : "owner"} />
        <div className="sheet-actions">
          {person && (
            <button type="button" className="link-button danger" disabled={busy} onClick={() => void remove()}>
              {t("Take them off")}
            </button>
          )}
          <button type="submit" disabled={busy}>
            {busy ? t("Saving…") : person ? t("Save") : t("Add")}
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
  const t = useT();
  return (
    <select name={name} required defaultValue={defaultValue}>
      <option value="" disabled>
        {t("Pick one")}
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
  const t = useT();
  return (
    <fieldset className="people-visibility">
      <legend>{t("Who sees this")}</legend>
      <label className="check">
        <input type="radio" name="visibility" value="public" defaultChecked={value === "public"} />
        {t("Everyone")}
      </label>
      <label className="check">
        <input type="radio" name="visibility" value="owner" defaultChecked={value === "owner"} />
        {t("Only you")}
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
  const t = useT();
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
      if (!who) return t("Pick who first.");
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
  const endWords = !tie ? "" : tie.waiting === "on_them" ? t("Withdraw the ask") : tie.layer === "kin" ? t("Take it off") : tie.status === "ended" ? "" : t("End it");
  return (
    <Sheet open onClose={() => !busy && onClose()} title={tie ? t("{name} and {them}", { name: first, them }) : t("Someone {name} knows on the show", { name: first })}>
      <form className="people-form" onSubmit={submit}>
        {tie ? (
          <p>
            {tie.waiting === "on_them"
              ? t("{them} is {name}'s {relation}, if {them}'s owner says yes.", { them, name: first, relation: tie.label })
              : tie.status === "ended"
                ? t("{them} is {name}'s {relation}, in the past.", { them, name: first, relation: tie.label })
                : t("{them} is {name}'s {relation}.", { them, name: first, relation: tie.label })}
          </p>
        ) : who ? (
          <div className="people-picked">
            <Avatar seed={who.id} name={who.name} hue={who.hue} portraitSrc={who.portrait} size={40} round decorative />
            <strong>{who.name}</strong>
            {!pick && (
              <button type="button" className="link-button" onClick={() => setWho(null)}>
                {t("Change")}
              </button>
            )}
          </div>
        ) : (
          <>
            <label>
              {t("Who")}
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Find a character by name")} autoComplete="off" autoFocus />
            </label>
            {found && (
              <ul className="people-found" aria-label={t("Characters")}>
                {found.length ? (
                  found.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="people-found-pick" onClick={() => setWho(c)}>
                        <Avatar seed={c.id} name={c.name} hue={c.hue} portraitSrc={c.portrait} size={32} round decorative />
                        <span>{c.name}</span>
                        {c.mine && <span className="people-tag">{t("Yours")}</span>}
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="muted small">{t("No one by that name. The show's own characters take their ties from the show.")}</li>
                )}
              </ul>
            )}
          </>
        )}
        {!tie && who && (
          <>
            <label>
              {t("{them} is {name}'s", { them, name: first })}
              <RelationSelect name="relation" choices={tieChoices("owner", { own: who.mine })} defaultValue="" />
            </label>
            {!who.mine && (
              <p className="muted small">
                {t("{them} is someone else's character: their owner says yes or no, and it shows once they do. Only warm ties go to someone else's character; rivalries come from what airs.", { them })}
              </p>
            )}
          </>
        )}
        {(tie || who) && (
          <>
            <label>
              {t("How it goes")} <span className="muted small">{t("(optional)")}</span>
              <textarea name="story" maxLength={240} rows={2} defaultValue={tie?.story ?? ""} placeholder={t("They shared a flat through university and still split a newspaper.")} />
            </label>
            <label>
              {t("Since")} <span className="muted small">{t("(optional)")}</span>
              <input name="since" maxLength={40} defaultValue={tie?.since ?? ""} placeholder={t("school, 2019, forever")} autoComplete="off" />
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
              {busy ? t("Saving…") : tie ? t("Save") : who?.mine ? t("Add") : t("Ask their owner")}
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
  const t = useT();
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
          {place.since ? `, ${t("since {when}", { when: place.since })}` : ""}.
        </p>
        <div className="sheet-actions">
          <button type="button" className="link-button danger" disabled={busy} onClick={() => void leave()}>
            {t("Take them out of here")}
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
    <Sheet open onClose={() => !busy && onClose()} title={t("A place in {name}'s life", { name: first })}>
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
          {t("Where")}
          <select name="place" required value={pickKey} onChange={(e) => setPickKey(e.target.value)}>
            <option value="" disabled>
              {t("Pick one")}
            </option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
            {NEW_PLACE_FOR[role] && <option value={NEW_PLACE}>{t("Somewhere new…")}</option>}
          </select>
        </label>
        {naming && (
          <>
            <label>
              {t("Its name")}
              <input name="name" required maxLength={60} placeholder={role === "studied" ? "Heartsease Sixth Form" : "The Salt Lantern"} autoComplete="off" />
            </label>
            <label>
              {t("In")}
              <select name="neighbourhood" defaultValue="">
                <option value="">{t("Somewhere in {place}", { place: menu.city.name })}</option>
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
          {t("Since")} <span className="muted small">{t("(optional)")}</span>
          <input name="since" maxLength={40} placeholder={t("two winters, 2021")} autoComplete="off" />
        </label>
        <Visibility value="public" />
        <div className="sheet-actions">
          <button type="submit" disabled={busy}>
            {busy ? t("Saving…") : t("Add")}
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
