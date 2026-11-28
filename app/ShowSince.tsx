"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon from "@/app/Icon";
import When from "./When";
import { fillNodes } from "./fillNodes";
import { useT } from "./I18nProvider";
import { clientMsg } from "@/lib/i18n/translate";
import type { ShowSince as ShowSinceData } from "@/lib/show-since";

const DISMISSED = "bz-show-since-dismissed";

/** Where a couple stands (lib/relationship-stages.ts STAGE_LABELS, kept free of imports for the browser), marked here for the catalogs' browser half. */
const STAGE_WORDS: readonly string[] = [
  clientMsg("👋 Just met"),
  clientMsg("✨ Sparks"),
  clientMsg("💞 Dating"),
  clientMsg("💍 Going steady"),
  clientMsg("🤝 Friends"),
  clientMsg("💔 Exes"),
  clientMsg("🔥 Bad blood"),
  clientMsg("🤷 Didn't click"),
  clientMsg("🌙 Keeping it casual"),
  clientMsg("💑 Official"),
  clientMsg("🏡 Moved in together"),
  clientMsg("💎 Engaged"),
  clientMsg("💒 Married"),
  clientMsg("💔 Broke up"),
  clientMsg("🔁 Back together"),
  clientMsg("📄 Divorced"),
];

/** How many lines of the show's news home shows inside "Since you were here"; the rest are on /watch. */
export const SINCE_INSIDE_SHOWN = 3;

/**
 * The show's news since your last visit, as a list (lib/show-since.ts). `limit`: home's part of "Since you were here"
 * shows the first few and links to the rest on /watch, which has the whole card (the 2026-11-22 audit: home repeated
 * /watch's news word for word and ran seven phone screens). In the page's language (docs/i18n.md): each line is one
 * sentence with `{slots}` for its names and links (app/fillNodes.tsx), so a language keeps its own word order.
 */
function Items({ card, limit }: { card: ShowSinceData; limit?: number }) {
  const t = useT();
  const n = (count: number, one: string, many: string) => (count === 1 ? t(one) : t(many, { n: count }));
  const rows = [
    card.season && (
      <li key="season">
        <Icon name="clapper" />{" "}
        {fillNodes(t("Season {number} ({label}) is over: {recap}", { number: card.season.number, label: card.season.label }), {
          recap: <Link href={card.season.path}>{t("watch the recap")}</Link>,
        })}
      </li>
    ),
    card.aired > 0 && (
      <li key="aired">
        <span aria-hidden="true">📺</span> <Link href="/watch#latest">{card.aired === 1 ? t("1 date aired") : t("{n} dates aired", { n: card.aired })}</Link>
      </li>
    ),
    card.twist && (
      <li key="twist">
        <span aria-hidden="true">📣</span>{" "}
        {fillNodes(t("This week on Botchelor: {twist} — {link}"), {
          twist: <strong>{card.twist.label}</strong>,
          link: (
            <Link href="/watch#this-week" data-track="since-this-week">
              {t("see what's on")}
            </Link>
          ),
        })}
      </li>
    ),
    card.story && (
      <li key="story">
        <span aria-hidden="true">🎬</span> {card.story.previously} <strong>{card.story.tonight}</strong>{" "}
        {card.story.vote && (
          <Link href="/vote" data-track="since-story">
            {t("Vote")}
          </Link>
        )}
      </li>
    ),
    card.chat && (
      <li key="chat">
        <span aria-hidden="true">📱</span>{" "}
        {fillNodes(t("Leaked from the cast group chat: {name} {text}"), { name: <strong>{card.chat.name}</strong>, text: <em>“{card.chat.text}”</em> })}{" "}
        <Link href="/reunion#cast-chat" data-track="cast-chat" data-track-where="since">
          {card.chat.more > 0 ? t("read the other {n}", { n: card.chat.more }) : t("read it")}
        </Link>
      </li>
    ),
    card.house && (
      <li key="house">
        <span aria-hidden="true">🏠</span>{" "}
        {fillNodes(t("In the house, {who}: {name} {text}", { who: card.house.who }), { name: <strong>{card.house.name}</strong>, text: <em>“{card.house.text}”</em> })}{" "}
        <Link href={card.house.path} data-track="house-scene" data-track-where="since">
          {t("hear the rest")}
        </Link>
      </li>
    ),
    card.situation && (
      <li key="situation">
        <span aria-hidden="true">{card.situation.icon}</span>{" "}
        {fillNodes(t("The viewers picked {title}: {link}"), {
          title: <strong>{card.situation.title}</strong>,
          link: <Link href={card.situation.room_path}>{t("watch how it went")}</Link>,
        })}
      </li>
    ),
    card.diary && (
      <li key="diary">
        <span aria-hidden="true">📹</span>{" "}
        {fillNodes(t("{name}, after the date with {partner}: {line}", { name: card.diary.name, partner: card.diary.partner }), { line: <em>“{card.diary.line}”</em> })}{" "}
        <Link href={card.diary.episode_path}>{t("watch it")}</Link>
      </li>
    ),
    card.secret && (
      <li key="secret">
        <span aria-hidden="true">🤫</span>{" "}
        {fillNodes(t("A secret came out: {name} {secret} ({index} of {total}).", { name: card.secret.name, index: card.secret.index, total: card.secret.total }), {
          secret: <em>{card.secret.secret.charAt(0).toLowerCase() + card.secret.secret.slice(1)}</em>,
        })}{" "}
        {card.secret.own ? (
          <Link href={card.secret.own.episode_path}>{t("See the date")}</Link>
        ) : (
          <Link href={`/characters/${card.secret.character_id}#secrets`}>{t("See their secrets")}</Link>
        )}
      </li>
    ),
    ...card.moves.map((m) => (
      <li key={`${m.lo}-${m.hi}`}>
        <span aria-hidden="true">💫</span>{" "}
        {fillNodes(t("{couple} are now {label}", { label: STAGE_WORDS.includes(m.label) ? t(m.label) : m.label }), {
          couple: (
            <Link href={`/couples/${m.lo}/${m.hi}`}>
              {m.a} &amp; {m.b}
            </Link>
          ),
        })}
        {m.following && <span className="chip">{t("You follow")}</span>}
      </li>
    )),
    ...(card.overnights ?? []).map((o) => (
      <li key={o.episode_path}>
        <span aria-hidden="true">🌙</span>{" "}
        {fillNodes(t("{couple} left their overnight date together: {link}"), {
          couple: (
            <Link href={`/couples/${o.lo}/${o.hi}`}>
              {o.a} &amp; {o.b}
            </Link>
          ),
          link: <Link href={o.episode_path}>{t("watch it")}</Link>,
        })}
      </li>
    )),
    card.followed > 0 && (
      <li key="followed">
        <span aria-hidden="true">👀</span> {n(card.followed, "Couples you follow went on 1 date", "Couples you follow went on {n} dates")}
      </li>
    ),
    card.backing && (
      <li key="backing">
        <span aria-hidden="true">🏅</span>{" "}
        {fillNodes(
          card.backing.aired === 1 ? t("Your cast pick {name} went on 1 date") : t("Your cast pick {name} went on {n} dates", { n: card.backing.aired }),
          { name: <Link href={`/characters/${card.backing.character_id}`}>{card.backing.name}</Link> },
        )}
      </li>
    ),
    card.shift && (
      <li key="shift">
        <span aria-hidden="true">{card.shift.shift > 0 ? "🔥" : "🧊"}</span>{" "}
        {fillNodes(t("Biggest chemistry shift this week: {couple} {shift}"), {
          couple: (
            <Link href={`/couples/${card.shift.lo}/${card.shift.hi}`}>
              {card.shift.a} &amp; {card.shift.b}
            </Link>
          ),
          shift: `${card.shift.shift > 0 ? "+" : "−"}${Math.abs(card.shift.shift)}`,
        })}
      </li>
    ),
    card.calls && (
      <li key="calls">
        <span aria-hidden="true">🔮</span> {t("You called {right} of {called} right", { right: card.calls.right, called: card.calls.called })}
        {card.calls.streak >= 2 ? `: ${t("{n} in a row", { n: card.calls.streak })} 🔥` : ""}
      </li>
    ),
  ].filter(Boolean);
  const more = limit !== undefined ? rows.length - limit : 0;
  return (
    <>
      <ul className="show-since-list">{more > 0 ? rows.slice(0, limit) : rows}</ul>
      {more > 0 && (
        <p className="show-since-more small">
          <Link href="/watch" data-track="since-more">
            {t("{n} more from the show on Watch", { n: more })} →
          </Link>
        </p>
      )}
    </>
  );
}

/**
 * What happened on the show since your last visit (lib/show-since.ts). `inside`: a part of home's "Since you were here"
 * card for someone with characters (app/page.tsx). Otherwise its own card, at the top of home for a spectator and of
 * /watch for everyone, with "Got it" to hide it for this visit (it remembers which visit, so the next return shows anew).
 */
export default function ShowSince({ card, inside = false }: { card: ShowSinceData; inside?: boolean }) {
  const t = useT();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (inside) return;
    try {
      if (window.localStorage.getItem(DISMISSED) === card.since) setHidden(true);
    } catch {
      // Storage blocked: the card just stays.
    }
  }, [card.since, inside]);
  if (inside) {
    return (
      <div className="show-since-inside">
        <h3>{t("On the show")}</h3>
        <Items card={card} limit={SINCE_INSIDE_SHOWN} />
      </div>
    );
  }
  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(DISMISSED, card.since);
    } catch {
      // Storage blocked: hidden for this page only.
    }
  };
  return (
    <section className="card show-since" aria-labelledby="show-since-head">
      <div className="show-since-top">
        <h2 id="show-since-head">
          {t("Since you were here")} <span className="muted show-since-when">(<When iso={card.since} />)</span>
        </h2>
        <button type="button" className="button-ghost small" onClick={dismiss}>
          {t("Got it")}
        </button>
      </div>
      <Items card={card} />
    </section>
  );
}
