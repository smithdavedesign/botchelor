"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Avatar from "@/app/Avatar";
import EmptyState from "@/app/EmptyState";
import When from "@/app/When";
import type { CompanionListItem, CompanionSource } from "@/lib/companion";
import TalkButton from "./TalkButton";

const first = (name: string) => name.split(/\s+/)[0] || name;

/** The "who" chips: every one but All narrows the list; a chip with nobody in it isn't shown. */
const WHO = [
  { id: "all", label: "Everyone" },
  { id: "on_show", label: "On the show now" },
  { id: "house", label: "House cast" },
  { id: "agent", label: "Made by agents" },
  { id: "community", label: "Creators'" },
  { id: "yours", label: "Yours" },
] as const;
type Who = (typeof WHO)[number]["id"];

const PRONOUNS = [
  { id: "any", label: "Any pronouns" },
  { id: "she/her", label: "She/her" },
  { id: "he/him", label: "He/him" },
  { id: "they/them", label: "They/them" },
] as const;
type Pronouns = (typeof PRONOUNS)[number]["id"];

const SORTS = [
  { id: "suggested", label: "Suggested" },
  { id: "az", label: "A to Z" },
  { id: "newest", label: "Newest" },
  { id: "youngest", label: "Youngest" },
  { id: "oldest", label: "Oldest" },
] as const;
type Sort = (typeof SORTS)[number]["id"];

const SOURCE_LABEL: Record<CompanionSource, string> = { yours: "Yours", house: "House cast", agent: "Made by agents", community: "A creator's" };

export const matchesWho = (c: CompanionListItem, who: Who) => who === "all" || (who === "on_show" ? c.on_show : c.source === who);

/** Search reads the name, the bio and the traits, every word of the query somewhere in them. */
export function matchesQuery(c: CompanionListItem, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${c.name} ${c.bio} ${c.traits.join(" ")}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function sorted(list: CompanionListItem[], sort: Sort): CompanionListItem[] {
  if (sort === "suggested") return list;
  const out = [...list];
  if (sort === "az") out.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "newest") out.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  if (sort === "youngest") out.sort((a, b) => (a.age ?? 99) - (b.age ?? 99));
  if (sort === "oldest") out.sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
  return out;
}

function Action({ c, signIn }: { c: CompanionListItem; signIn: boolean }) {
  if (signIn)
    return (
      <Link className="button secondary small" href="/account?next=%2Fcompanion">
        Sign in to talk
      </Link>
    );
  if (c.thread_id)
    return (
      <Link className="button secondary small" href={`/companion/${c.thread_id}`}>
        Open
      </Link>
    );
  return <TalkButton characterId={c.id} name={first(c.name)} label={`Talk to ${first(c.name)}`} className="button secondary small" />;
}

/** A conversation you've started: who, their last line, and when. */
function ThreadRow({ c }: { c: CompanionListItem }) {
  return (
    <li className="companion-card companion-thread tap-card">
      <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={52} />
      <div className="companion-card-body">
        <span className="companion-thread-top">
          <Link className="stretch" href={`/companion/${c.thread_id}`}>
            <strong>{c.name}</strong>
          </Link>
          {c.last_at && (
            <span className="muted small">
              <When iso={c.last_at} />
            </span>
          )}
        </span>
        <p className="muted small companion-card-line">{c.last ?? c.bio}</p>
      </div>
    </li>
  );
}

/** Someone you could talk with: a face, who they are, a few traits, and the button. */
function Tile({ c, signIn }: { c: CompanionListItem; signIn: boolean }) {
  return (
    <li className="companion-tile">
      <div className="companion-tile-head">
        <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={64} />
        <div className="companion-tile-who">
          <strong>{c.name}</strong>
          <span className="muted small">{[c.age, c.pronouns].filter(Boolean).join(" · ")}</span>
          <span className="companion-tile-badges">
            {c.on_show && <span className="chip">📺 On the show</span>}
            <span className="chip chip-quiet">{SOURCE_LABEL[c.source]}</span>
          </span>
        </div>
      </div>
      <p className="companion-tile-bio small">{c.bio}</p>
      {c.traits.length > 0 && (
        <ul className="chips companion-tile-traits" aria-label="Traits">
          {c.traits.map((t) => (
            <li key={t} className="chip chip-quiet">
              {t}
            </li>
          ))}
        </ul>
      )}
      <div className="companion-tile-action">
        <Action c={c} signIn={signIn} />
      </div>
    </li>
  );
}

/**
 * The companions list (app/companion/page.tsx), filterable on the page: a search, who they are (on the show now, house
 * cast, agent-made, a creator's, yours), pronouns, and a sort. Your conversations stay on top, unfiltered unless you
 * search. Everything is client-side: the page sends at most ~170 people.
 */
export type CompanionFilters = { q?: string; who?: string; pronouns?: string; sort?: string };

const oneOf = <T extends string>(list: readonly { id: T }[], v: string | undefined, fallback: T): T => list.find((x) => x.id === v)?.id ?? fallback;

export default function CompanionBrowser({
  threads,
  others,
  signIn = false,
  initial = {},
}: {
  threads: CompanionListItem[];
  others: CompanionListItem[];
  signIn?: boolean;
  /** The filters from the URL (?q=&who=&pronouns=&sort=), so Back and a shared link keep them. */
  initial?: CompanionFilters;
}) {
  const [q, setQ] = useState(initial.q ?? "");
  const [who, setWho] = useState<Who>(oneOf(WHO, initial.who, "all"));
  const [pronouns, setPronouns] = useState<Pronouns>(oneOf(PRONOUNS, initial.pronouns, "any"));
  const [sort, setSort] = useState<Sort>(oneOf(SORTS, initial.sort, "suggested"));

  // The filters live in the URL (replaceState: no history entry a keystroke), so Back to this page keeps them.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const set = (k: string, v: string, def: string) => (v && v !== def ? params.set(k, v) : params.delete(k));
    set("q", q.trim(), "");
    set("who", who, "all");
    set("pronouns", pronouns, "any");
    set("sort", sort, "suggested");
    const next = `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next);
  }, [q, who, pronouns, sort]);

  const counts = useMemo(() => new Map(WHO.map((w) => [w.id, others.filter((c) => matchesWho(c, w.id)).length])), [others]);
  const shown = useMemo(
    () => sorted(others.filter((c) => matchesWho(c, who) && (pronouns === "any" || c.pronouns === pronouns) && matchesQuery(c, q)), sort),
    [others, who, pronouns, q, sort],
  );
  const shownThreads = useMemo(() => threads.filter((c) => matchesQuery(c, q)), [threads, q]);
  const filtered = q.trim() !== "" || who !== "all" || pronouns !== "any";
  const clear = () => {
    setQ("");
    setWho("all");
    setPronouns("any");
  };

  return (
    <>
      <div className="companion-filters" role="search">
        <label className="companion-search">
          <span className="sr-only">Search companions</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name, a trait, anything in their bio" />
        </label>
        <div className="filter-pills" role="group" aria-label="Who">
          {WHO.filter((w) => w.id === "all" || (counts.get(w.id) ?? 0) > 0).map((w) => (
            <button key={w.id} type="button" aria-pressed={who === w.id} onClick={() => setWho(w.id)}>
              {w.label} <span className="filter-n">{counts.get(w.id)}</span>
            </button>
          ))}
        </div>
        <div className="companion-selects">
          <label>
            <span className="sr-only">Pronouns</span>
            <select value={pronouns} onChange={(e) => setPronouns(e.target.value as Pronouns)}>
              {PRONOUNS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  Sort: {s.label}
                </option>
              ))}
            </select>
          </label>
          {filtered && (
            <button type="button" className="button-ghost small" onClick={clear}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {shownThreads.length > 0 && (
        <section aria-labelledby="companion-threads">
          <h2 id="companion-threads">Your conversations</h2>
          <ul className="companion-list">
            {shownThreads.map((c) => (
              <ThreadRow key={c.id} c={c} />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="companion-cast">
        <h2 id="companion-cast">{threads.length ? "Someone new" : "Who you could talk with"}</h2>
        <p className="muted small" aria-live="polite">
          {filtered ? `${shown.length} of ${others.length}` : `${others.length} to choose from`}
        </p>
        {shown.length ? (
          <ul className="companion-grid">
            {shown.map((c) => (
              <Tile key={c.id} c={c} signIn={signIn} />
            ))}
          </ul>
        ) : (
          <EmptyState
            emoji="🔎"
            title={others.length ? "Nobody matches that" : "Nobody to talk with just now"}
            action={
              others.length ? (
                <button type="button" className="button small" onClick={clear}>
                  Clear filters
                </button>
              ) : undefined
            }
            secondary={{ href: "/watch", label: "Watch the show" }}
          />
        )}
      </section>
    </>
  );
}
