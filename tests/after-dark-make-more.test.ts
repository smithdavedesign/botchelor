import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AfterDarkTheater from "@/app/after-dark/[a]/[b]/AfterDarkTheater";
import type { CharacterRef } from "@/lib/game";

// Make more (lib/adult/rollout.ts make_more; the design kit's MakeMore, admins only until it's opened): everything that
// makes more of a night in one priced menu, in place of the separate buttons, with ⋯ keeping the writer and the steps.
const chars: [CharacterRef, CharacterRef] = [
  { id: "a", name: "Ada Vale", house: false, hue: 300, portrait: null },
  { id: "b", name: "Bo Reyes", house: false, hue: 200, portrait: null },
];
const scene = { lines: [{ who: "a" as const, text: "*smiles* Hi." }, { who: "b" as const, text: "Hello." }], place: null, stage: 0, dateVenue: null };
const steps = { canRewind: true, redoTitle: "Redo", canReset: true, onRewind() {}, onRedo() {}, onReset() {} };
const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(AfterDarkTheater, {
      scene,
      characters: chars,
      onExit: () => {},
      onWrite: async () => {},
      onSetScene: async () => {},
      onMakeVideo: async () => {},
      onPictureNow: async () => {},
      moveTokens: 1,
      steps,
      pageTabs: [{ id: "gallery", label: "🖼 Gallery (3)" }],
      onPageTab: () => {},
      ...props,
    }),
  );
const between = (html: string, from: string, to: string) => {
  const i = html.indexOf(from);
  return i < 0 ? "" : html.slice(i, html.indexOf(to, i) < 0 ? undefined : html.indexOf(to, i));
};

describe("Make more on a night", () => {
  it("off (everyone, until it's opened): the separate buttons as before, and no menu", () => {
    const html = render({});
    expect(html).not.toContain("data-make-more");
    expect(html).toContain("Video of the night");
    expect(between(html, "ad-tools-items", "Exit")).toContain("Bring them to life");
    // The row's 📷 stays an icon.
    expect(html).not.toContain("A picture or clip of this moment");
  });

  it("on: one menu holds the video, bringing them to life, a new place at its price, their Studio, and Keep going / Fix", () => {
    const html = render({ makeMore: true, studios: [{ id: "a", name: "Ada Vale" }] });
    const menu = between(html, "data-make-more", "ad-tools-more");
    expect(menu).toContain("Make more");
    expect(menu).toContain("Video of the night");
    expect(menu).toContain("Bring them to life");
    expect(menu).toContain("A picture or clip of this moment");
    expect(menu).toMatch(/📍 Take them somewhere else · (<!-- -->)?<span class="token-price">/);
    expect(menu).toContain('href="/after-dark/studio/a"');
    expect(menu).toContain("Ada&#x27;s Studio");
    expect(menu).toContain("▶▶ Keep going · 🩹 Fix");
    // ⋯ keeps the steps, and nothing that makes more.
    const more = between(html, "ad-tools-items", "Exit");
    expect(more).toContain("↺ Rewind");
    expect(more).toContain("End the night");
    expect(more).not.toContain("Bring them to life");
    // Scene & roleplay and the story stay in the row.
    expect(html).toContain("Scene &amp; roleplay");
    expect(html).toContain("theater-icon-word\">Story");
  });

  it("no Keep going / Fix without the Gallery to open, and no Studio that isn't theirs", () => {
    const html = render({ makeMore: true, pageTabs: undefined, onPageTab: undefined });
    expect(html).not.toContain("Keep going · 🩹 Fix");
    expect(html).not.toContain("/after-dark/studio/");
  });

  it("a replay (no writing) has no Make more", () => {
    expect(render({ makeMore: true, onWrite: undefined, onSetScene: undefined, steps: null })).not.toContain("Take them somewhere else");
  });
});
