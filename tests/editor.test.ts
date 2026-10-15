import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The editor is a client component that routes after saving; a static render only needs a stub router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
const { default: CreateWizard } = await import("@/app/create/CreateWizard");

const initial = {
  name: "Ira Fenn",
  age: 26,
  bio: "Runs a 24-hour library for insomniac poets.",
  traits: ["bookish", "warm", "stubborn"],
  want: "Someone who reads the last page first",
  dealbreaker: "Dog-earing a page",
  pronouns: "she/her",
  voice: null,
  appearance: null,
  hue: 230,
  soul: null,
  openToDates: false,
  extras: {},
  imageTrained: false,
};

const render = (portrait: string | null) =>
  renderToStaticMarkup(createElement(CreateWizard, { edit: { id: "char-ira-1", initial: { ...initial, portrait } } }));

describe("the editor shows the character as their card does", () => {
  it("uses their generated portrait in the preview", () => {
    const html = render("/api/assets/portrait-123");
    expect(html).toContain('src="/api/assets/portrait-123"');
    expect(html).toContain('alt="Ira Fenn portrait"');
  });

  it("without a portrait, draws the same avatar as the card (seeded by the character's id, not the name)", () => {
    const html = render(null);
    expect(html).not.toContain("/api/assets/");
    expect(html).toContain('id="av-charira1');
  });
});
