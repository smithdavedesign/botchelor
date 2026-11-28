import Link from "next/link";
import Icon from "@/app/Icon";
import { ART_STYLE_LABEL, ART_STYLES } from "@/lib/art-style";
import { DECK_MADE_BY, DECK_MADE_BY_LABEL, deckFilterPairs, type DeckFilters } from "@/lib/deck-filters";
import { KINDS } from "@/lib/kinds";
import { byDemand, tagsIn } from "@/lib/tags";
import { english, type T } from "@/lib/i18n/translate";

/**
 * The deck's filters (lib/deck-filters.ts, David 2026-11-19): who made them, the art style, what they are and their type,
 * the words /characters filters by. A plain form that reads the page again, so it works before any script and a
 * filtered deck is a link. Twice on the page: in the intro on a wide screen ("intro"), behind an icon in the phone's
 * slim bar ("bar"); each is hidden where the other shows (globals.css: the intro and the bar never show together).
 */
export default function DeckFilterForm({ characterId, filters, variant, t = english }: { characterId: string; filters: DeckFilters; variant: "intro" | "bar"; t?: T }) {
  const set = deckFilterPairs(filters).length;
  const id = (k: string) => `deck-${variant}-${k}`;
  const types = byDemand(tagsIn("type"), "sfw");
  return (
    <details className={`deck-filters deck-filters-${variant}`} open={variant === "intro" && set > 0 ? true : undefined}>
      {variant === "bar" ? (
        <summary className="swipe-topbar-btn" aria-label={set ? t("Filters, {n} on", { n: set }) : t("Filters")}>
          <Icon name="filter" />
          {set > 0 && <span className="nav-count">{set}</span>}
        </summary>
      ) : (
        <summary className="deck-filters-summary">
          <Icon name="filter" /> {set ? t("Filters ({n} on)", { n: set }) : t("Filters")}
        </summary>
      )}
      <form className="deck-filters-form" action="/swipe" method="get">
        <input type="hidden" name="character" value={characterId} />
        <label className="sr-only" htmlFor={id("made")}>
          {t("Made by")}
        </label>
        <select id={id("made")} name="made_by" defaultValue={filters.made_by ?? ""}>
          <option value="">{t("Made by anyone")}</option>
          {DECK_MADE_BY.map((m) => (
            <option key={m} value={m}>
              {DECK_MADE_BY_LABEL[m]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={id("style")}>
          {t("Style")}
        </label>
        <select id={id("style")} name="style" defaultValue={filters.style ?? ""}>
          <option value="">{t("Any style")}</option>
          {ART_STYLES.map((s) => (
            <option key={s} value={s}>
              {ART_STYLE_LABEL[s]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={id("kind")}>
          {t("Kind")}
        </label>
        <select id={id("kind")} name="kind" defaultValue={filters.kind ?? ""}>
          <option value="">{t("Any kind")}</option>
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.emoji} {k.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={id("type")}>
          {t("Type")}
        </label>
        <select id={id("type")} name="type" defaultValue={filters.type ?? ""}>
          <option value="">{t("Any type")}</option>
          {types.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.icon} {tag.label}
            </option>
          ))}
        </select>
        <button type="submit" className="button secondary">
          {t("Show")}
        </button>
        {set > 0 && <Link href={`/swipe?character=${encodeURIComponent(characterId)}`}>{t("Clear")}</Link>}
      </form>
    </details>
  );
}
