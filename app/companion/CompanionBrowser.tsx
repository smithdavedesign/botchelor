"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Avatar from "@/app/Avatar";
import FaceLoop from "@/app/FaceLoop";
import Tilt from "@/app/motion/Tilt";
import Icon from "@/app/Icon";
import EmptyState from "@/app/EmptyState";
import When from "@/app/When";
import { ART_STYLE_LABEL, ART_STYLES } from "@/lib/art-style";
import type { CompanionListItem, CompanionSource } from "@/lib/companion";
import { byDemand, STATUSES, tagById, tagsIn } from "@/lib/tags";
import { useTagDemand } from "@/app/useTagDemand";
import { queueEvent } from "@/app/engagement";
import { useT } from "@/app/I18nProvider";
import { clientMsg } from "@/lib/i18n/translate";
import TalkButton from "./TalkButton";

const first = (name: string) => name.split(/\s+/)[0] || name;

/** The "who" chips: every one but All narrows the list; a chip with nobody in it isn't shown. */
const WHO = [
  { id: "all", label: clientMsg("Everyone") },
  { id: "on_show", label: clientMsg("On the show now") },
  { id: "house", label: clientMsg("House cast") },
  { id: "agent", label: clientMsg("Made by agents") },
  { id: "community", label: clientMsg("Creators'") },
  { id: "yours", label: clientMsg("Yours") },
] as const;
type Who = (typeof WHO)[number]["id"];

const PRONOUNS = [
  { id: "any", label: clientMsg("Any pronouns") },
  { id: "she/her", label: clientMsg("She/her") },
  { id: "he/him", label: clientMsg("He/him") },
  { id: "they/them", label: clientMsg("They/them") },
] as const;
type Pronouns = (typeof PRONOUNS)[number]["id"];

/** How they're drawn (lib/art-style.ts): shown once anyone listed is drawn rather than photographed (the show's anime cast, 2026-11-08; 2.5D, 2026-11-17). */
const STYLES = [{ id: "any", label: clientMsg("Any style") }, ...ART_STYLES.map((id) => ({ id, label: ART_STYLE_LABEL[id] }))] as const;
type Style = (typeof STYLES)[number]["id"];
export const matchesStyle = (c: CompanionListItem, style: Style) => style === "any" || c.style === style;

/** What kind of person (lib/character-tags.ts): the type tags, most wanted first (ours, lib/tag-demand.ts, else the census). */
const typesBy = (demand?: Record<string, number>) => [{ id: "any", label: clientMsg("Any type"), icon: "" }, ...byDemand(tagsIn("type"), "sfw", demand)];
const TYPES = typesBy();
/** Their love life, from the relationship graph's public layer: a private date never counts. */
const LOVE = [{ id: "any", label: clientMsg("Any love life"), icon: "" }, ...STATUSES];
export const matchesType = (c: CompanionListItem, type: string) => type === "any" || c.tags.includes(type as never);
export const matchesLove = (c: CompanionListItem, love: string) => love === "any" || c.status === love;

const SORTS = [
  { id: "suggested", label: clientMsg("Suggested") },
  { id: "az", label: clientMsg("A to Z") },
  { id: "newest", label: clientMsg("Newest") },
  { id: "youngest", label: clientMsg("Youngest") },
  { id: "oldest", label: clientMsg("Oldest") },
] as const;
type Sort = (typeof SORTS)[number]["id"];

/**
 * How many tiles show before "Show more" (2026-11-08 UI audit, item 4: all 173 at once ran 58 phone screens and ~11,700
 * words). Each press shows this many more; a new search or filter starts again from the first page.
 */
export const COMPANIONS_PAGE = 24;

const SOURCE_LABEL: Record<CompanionSource, string> = { yours: clientMsg("Yours"), house: clientMsg("House cast"), agent: clientMsg("Made by agents"), community: clientMsg("A creator's") };

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
  const t = useT();
  if (signIn)
    return (
      <Link className="button secondary small" href="/account?next=%2Fcompanion">
        {t("Sign in to talk")}
      </Link>
    );
  if (c.thread_id)
    return (
      <Link className="button secondary small" href={`/companion/${c.thread_id}`}>
        {t("Open")}
      </Link>
    );
  return <TalkButton characterId={c.id} name={first(c.name)} label={t("Talk to {name}", { name: first(c.name) })} className="button secondary small" />;
}

/** A conversation you've started: who, their last line, and when. */
function ThreadRow({ c }: { c: CompanionListItem }) {
  return (
    // Not .companion-thread: that's the chat page's message list, and its padding: 0 wiped this card's (2026-11-08).
    <li className="companion-card companion-thread-row tap-card">
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

/** A tile's face, in px. */
export const TILE_FACE = 96;

/** Someone you could talk with: a face, who they are, a few traits, and the button. */
function Tile({ c, signIn }: { c: CompanionListItem; signIn: boolean }) {
  const t = useT();
  // The card leans toward a mouse (the motion kit's tilt, the visual pop audit's "portrait cards").
  return (
    <Tilt as="li" className="companion-tile" max={4}>
      <div className="companion-tile-head">
        {/* A face you can read at a glance (the visual pop audit: past 64 px), moving for the cast with a loop. */}
        <FaceLoop id={c.id} radius={TILE_FACE * 0.28}>
          <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={TILE_FACE} />
        </FaceLoop>
        <div className="companion-tile-who">
          <strong>{c.name}</strong>
          <span className="muted small">{[c.age, c.pronouns].filter(Boolean).join(" · ")}</span>
          <span className="companion-tile-badges">
            {c.on_show && (
              <span className="chip">
                <Icon name="tv" /> {t("On the show")}
              </span>
            )}
            <span className="chip chip-quiet">{t(SOURCE_LABEL[c.source])}</span>
          </span>
        </div>
      </div>
      <p className="companion-tile-bio small">{c.bio}</p>
      {c.tags.length > 0 && (
        <p className="muted small companion-tile-tags">
          {c.tags
            .map((id) => tagById(id))
            .filter(Boolean)
            .map((tag) => `${tag!.icon} ${t(tag!.label)}`)
            .join(" · ")}
        </p>
      )}
      {c.traits.length > 0 && (
        <ul className="chips companion-tile-traits" aria-label={t("Traits")}>
          {c.traits.map((trait) => (
            <li key={trait} className="chip chip-quiet">
              {trait}
            </li>
          ))}
        </ul>
      )}
      <div className="companion-tile-action">
        <Action c={c} signIn={signIn} />
      </div>
    </Tilt>
  );
}

/**
 * The companions list (app/companion/(list)/page.tsx), filterable on the page: a search, who they are (on the show now, house
 * cast, agent-made, a creator's, yours), pronouns, how they're drawn (realistic or anime), what kind of person and their
 * love life (docs/tags.md), and a sort. Your conversations stay on top, above the filters, and the filters never touch them.
 * Everything is client-side: the page sends at most ~170 people.
 */
export type CompanionFilters = { q?: string; who?: string; pronouns?: string; style?: string; type?: string; love?: string; sort?: string };

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
  /** The filters from the URL (?q=&who=&pronouns=&style=&type=&love=&sort=), so Back and a shared link keep them. */
  initial?: CompanionFilters;
}) {
  const t = useT();
  const [q, setQ] = useState(initial.q ?? "");
  const [who, setWho] = useState<Who>(oneOf(WHO, initial.who, "all"));
  const [pronouns, setPronouns] = useState<Pronouns>(oneOf(PRONOUNS, initial.pronouns, "any"));
  const [style, setStyle] = useState<Style>(oneOf(STYLES, initial.style, "any"));
  const [type, setType] = useState<string>(oneOf(TYPES, initial.type, "any"));
  const [love, setLove] = useState<string>(oneOf(LOVE, initial.love, "any"));
  const [sort, setSort] = useState<Sort>(oneOf(SORTS, initial.sort, "suggested"));
  // How far down "Show more" has gone, for these filters: a new search, filter or sort starts from the first page again.
  const filterKey = `${q.trim()}|${who}|${pronouns}|${style}|${type}|${love}|${sort}`;
  const [paging, setPaging] = useState({ key: filterKey, limit: COMPANIONS_PAGE });
  const limit = paging.key === filterKey ? paging.limit : COMPANIONS_PAGE;

  // The filters live in the URL (replaceState: no history entry a keystroke), so Back to this page keeps them.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const set = (k: string, v: string, def: string) => (v && v !== def ? params.set(k, v) : params.delete(k));
    set("q", q.trim(), "");
    set("who", who, "all");
    set("pronouns", pronouns, "any");
    set("style", style, "any");
    set("type", type, "any");
    set("love", love, "any");
    set("sort", sort, "suggested");
    const next = `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next);
  }, [q, who, pronouns, style, type, love, sort]);

  const counts = useMemo(() => new Map(WHO.map((w) => [w.id, others.filter((c) => matchesWho(c, w.id)).length])), [others]);
  const shown = useMemo(
    () => sorted(others.filter((c) => matchesWho(c, who) && (pronouns === "any" || c.pronouns === pronouns) && matchesStyle(c, style) && matchesType(c, type) && matchesLove(c, love) && matchesQuery(c, q)), sort),
    [others, who, pronouns, style, type, love, q, sort],
  );
  const anyDrawn = useMemo(() => others.some((c) => c.style !== "realistic"), [others]);
  const filtered = q.trim() !== "" || who !== "all" || pronouns !== "any" || style !== "any" || type !== "any" || love !== "any";
  // Only the types and love lives someone listed has: a menu entry with nobody behind it is a dead end.
  const typeDemand = useTagDemand()?.types;
  const typesShown = useMemo(() => typesBy(typeDemand).filter((tag) => tag.id === "any" || tag.id === type || others.some((c) => c.tags.includes(tag.id as never))), [others, type, typeDemand]);
  const lovesShown = useMemo(() => LOVE.filter((l) => l.id === "any" || l.id === love || others.some((c) => c.status === l.id)), [others, love]);
  const clear = () => {
    setQ("");
    setWho("all");
    setPronouns("any");
    setStyle("any");
    setType("any");
    setLove("any");
  };

  return (
    <>
      {threads.length > 0 && (
        <section aria-labelledby="companion-threads">
          <h2 id="companion-threads">{t("Your conversations")}</h2>
          <ul className="companion-list">
            {threads.map((c) => (
              <ThreadRow key={c.id} c={c} />
            ))}
          </ul>
        </section>
      )}

      <div className="companion-filters" role="search">
        <label className="companion-search">
          <span className="sr-only">{t("Search companions")}</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search a name, a trait, anything in their bio")} />
        </label>
        <div className="filter-pills" role="group" aria-label={t("Who")}>
          {WHO.filter((w) => w.id === "all" || w.id === who || (counts.get(w.id) ?? 0) > 0).map((w) => (
            <button key={w.id} type="button" aria-pressed={who === w.id} onClick={() => setWho(w.id)}>
              {t(w.label)} <span className="filter-n">{counts.get(w.id)}</span>
            </button>
          ))}
        </div>
        <div className="companion-selects">
          <label>
            <span className="sr-only">{t("Pronouns")}</span>
            <select
              value={pronouns}
              onChange={(e) => {
                setPronouns(e.target.value as Pronouns);
                // Who people look for (lib/tag-demand.ts lineupDemand): the pick, never anything typed.
                if (e.target.value !== "any") queueEvent("pronouns_filter", { pronouns: e.target.value, page: "companion" });
              }}
            >
              {PRONOUNS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(p.label)}
                </option>
              ))}
            </select>
          </label>
          {(anyDrawn || style !== "any") && (
            <label>
              <span className="sr-only">{t("Style")}</span>
              <select
                value={style}
                onChange={(e) => {
                  setStyle(e.target.value as Style);
                  // How people want them drawn (lib/tag-demand.ts artStyleDemand).
                  if (e.target.value !== "any") queueEvent("style_filter", { style: e.target.value, page: "companion" });
                }}
              >
                {STYLES.map((st) => (
                  <option key={st.id} value={st.id}>
                    {t(st.label)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {typesShown.length > 1 && (
            <label>
              <span className="sr-only">{t("Type")}</span>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {typesShown.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.icon ? `${tag.icon} ` : ""}
                    {t(tag.label)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {lovesShown.length > 2 && (
            <label>
              <span className="sr-only">{t("Love life")}</span>
              <select value={love} onChange={(e) => setLove(e.target.value)}>
                {lovesShown.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.icon ? `${l.icon} ` : ""}
                    {t(l.label)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span className="sr-only">{t("Sort")}</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {t("Sort: {how}", { how: t(s.label) })}
                </option>
              ))}
            </select>
          </label>
          {filtered && (
            <button type="button" className="button-ghost small" onClick={clear}>
              {t("Clear filters")}
            </button>
          )}
        </div>
      </div>

      <section aria-labelledby="companion-cast">
        <h2 id="companion-cast">{threads.length ? t("Someone new") : t("Who you could talk with")}</h2>
        <p className="muted small" aria-live="polite">
          {filtered ? t("{n} of {total}", { n: shown.length, total: others.length }) : t("{n} to choose from", { n: others.length })}
        </p>
        {shown.length ? (
          <>
            <ul className="companion-grid">
              {shown.slice(0, limit).map((c) => (
                <Tile key={c.id} c={c} signIn={signIn} />
              ))}
            </ul>
            {shown.length > limit && (
              <p className="companion-more">
                <button type="button" className="button secondary" onClick={() => setPaging({ key: filterKey, limit: limit + COMPANIONS_PAGE })}>
                  {t("Show {n} more", { n: Math.min(COMPANIONS_PAGE, shown.length - limit) })}
                </button>{" "}
                <span className="muted small">
                  {t("{n} of {total} shown", { n: limit, total: shown.length })}
                </span>
              </p>
            )}
          </>
        ) : (
          <EmptyState
            emoji="🔎"
            title={others.length ? t("Nobody matches that") : t("Nobody to talk with just now")}
            action={
              others.length ? (
                <button type="button" className="button small" onClick={clear}>
                  {t("Clear filters")}
                </button>
              ) : undefined
            }
            secondary={{ href: "/watch", label: t("Watch the show") }}
          />
        )}
      </section>
    </>
  );
}
