import Link from "next/link";
import { clampPage, pageWindow } from "@/lib/paging";

type Props = {
  page: number;
  pages: number;
  /** What the pages are of, read out to a screen reader: "Latest episodes pages". */
  label: string;
  /**
   * A page's address (a server-rendered list): every page is a plain link, so it works without JavaScript, crawls,
   * and Back returns to the page you were on. lib/paging.ts pageHref builds one that keeps the other params.
   */
  href?: (page: number) => string;
  /** Or, for a list already in the browser (a client panel): what a press does. */
  onPage?: (page: number) => void;
  /** The step labels: a feed says "Newer" / "Older", anything else "Previous" / "Next". */
  prev?: string;
  next?: string;
  /** Next.js scrolls to the top on a link by default; a list mid-page passes false and a #hash in `href`. */
  scroll?: boolean;
  className?: string;
};

/**
 * The one pager for long lists (lib/paging.ts): Previous, the page numbers, Next. The current page is marked with
 * aria-current, every control is at least 44px square, and it wraps instead of scrolling sideways on a phone (where
 * only the first, current and last numbers show once there are many). Nothing renders for a single page.
 * Pure (no hooks, no client directive): links in a server component, buttons in a client one.
 */
export default function Pager({ page, pages, label, href, onPage, prev = "Previous", next = "Next", scroll, className }: Props) {
  if (pages <= 1) return null;
  const p = clampPage(page, pages);
  const step = (to: number, text: string, rel: "prev" | "next") => {
    const arrow = rel === "prev" ? "←" : "→";
    const body = (
      <>
        {rel === "prev" && <span aria-hidden="true">{arrow}</span>}
        <span className="pager-step-text">{text}</span>
        {rel === "next" && <span aria-hidden="true">{arrow}</span>}
      </>
    );
    const aria = `${text} page`;
    const off = rel === "prev" ? p <= 1 : p >= pages;
    if (off) {
      return (
        <span className="pager-item pager-step is-disabled" aria-disabled="true" aria-label={aria}>
          {body}
        </span>
      );
    }
    return href ? (
      <Link className="pager-item pager-step" href={href(to)} rel={rel} aria-label={aria} scroll={scroll}>
        {body}
      </Link>
    ) : (
      <button type="button" className="pager-item pager-step" aria-label={aria} onClick={() => onPage?.(to)}>
        {body}
      </button>
    );
  };
  const many = pages > 5;
  return (
    <nav className={`pager-nav${className ? ` ${className}` : ""}`} aria-label={label}>
      <ul className="pager-list">
        <li>{step(p - 1, prev, "prev")}</li>
        {pageWindow(p, pages).map((n, i) =>
          n === "gap" ? (
            <li key={`gap-${i}`} className="pager-gap" aria-hidden="true">
              …
            </li>
          ) : (
            // On a phone with many pages, only the first, current and last numbers show (globals.css .pager-near).
            <li key={n} className={many && n !== p && n !== 1 && n !== pages ? "pager-near" : undefined}>
              {n === p ? (
                <span className="pager-item pager-num is-current" aria-current="page" aria-label={`Page ${n} of ${pages}`}>
                  {n}
                </span>
              ) : href ? (
                <Link className="pager-item pager-num" href={href(n)} aria-label={`Page ${n}`} scroll={scroll}>
                  {n}
                </Link>
              ) : (
                <button type="button" className="pager-item pager-num" aria-label={`Page ${n}`} onClick={() => onPage?.(n)}>
                  {n}
                </button>
              )}
            </li>
          ),
        )}
        <li>{step(p + 1, next, "next")}</li>
      </ul>
    </nav>
  );
}
