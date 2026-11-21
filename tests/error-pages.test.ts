// The site's error pages (app/PageError.tsx): a page that fails to render shows a way to try again and a way back inside
// the site's layout, not Next's bare error page; a failing root layout gets a document of its own (app/global-error.tsx).
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AfterDarkError from "@/app/after-dark/error";
import CoupleError from "@/app/couples/[a]/[b]/error";
import SiteError from "@/app/error";
import GlobalError from "@/app/global-error";
import PageError from "@/app/PageError";

const html = (el: ReactElement) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");
const failed = new Error('relation "secret_table" does not exist');

/** The first element in a rendered tree that `match` picks. */
function find(node: ReactNode, match: (el: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, match);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  if (match(node)) return node;
  return find(node.props.children as ReactNode, match);
}

describe("the error pages", () => {
  it("say what didn't load and offer Try again and the way back, never the error itself", () => {
    const page = html(createElement(SiteError, { error: failed, retry: () => {} }));
    expect(page).toContain('<article class="not-found">');
    expect(page).toContain("<h1>This page didn&#x27;t load</h1>");
    expect(page).toContain('<button type="button" class="button">Try again</button>');
    expect(page).toContain('<a class="button secondary" href="/">Back to the show</a>');
    expect(page).not.toContain("secret_table");
    expect(html(createElement(CoupleError, { error: failed, retry: () => {} }))).toContain("<h1>This couple didn&#x27;t load</h1>");
  });

  it("send After Dark's visitors back to After Dark", () => {
    const page = html(createElement(AfterDarkError, { error: failed, retry: () => {} }));
    expect(page).toContain('<a class="button secondary" href="/after-dark">Back to After Dark</a>');
    expect(page).not.toContain("Back to the show");
  });

  it("try the page again when Try again is pressed", () => {
    const retry = vi.fn();
    const button = find(PageError({ title: "This page didn't load", retry }), (el) => el.type === "button");
    (button?.props.onClick as () => void)();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("bring their own document, title and wordmark when the root layout is what failed", () => {
    const page = html(createElement(GlobalError, { error: failed, retry: () => {} }));
    expect(page).toMatch(/^<html lang="en">/);
    expect(page).toContain("<title>Something went wrong · Botchelor</title>");
    expect(page).toContain('<a href="/" class="logo">Botchelor</a>');
    expect(page).toContain('<main id="main"><article class="not-found">');
    expect(page).toContain("Botchelor didn&#x27;t load");
    expect(page).not.toContain("secret_table");
  });
});
