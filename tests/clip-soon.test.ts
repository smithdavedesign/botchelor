import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
const { default: OwnerControls } = await import("@/app/characters/[id]/OwnerControls");

describe("the clip button while clips move to a new video model", () => {
  it("shows, disabled, marked coming soon", () => {
    const html = renderToStaticMarkup(createElement(OwnerControls, { id: "c1", name: "Ira Fenn", openToDates: false }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Generate a clip<\/button>/);
    expect(html).toContain("Coming soon");
    expect(html).toMatch(/<button[^>]*>Generate a portrait<\/button>/); // portraits still work
  });
});
