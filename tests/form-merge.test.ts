import { describe, expect, it } from "vitest";
import { mergeSaved } from "@/lib/form-merge";

describe("mergeSaved: an instant save keeps what's typed elsewhere in the form", () => {
  const base = { enabled: false, text_model: "deepseek", chapter_tokens: 1, studio: { open_to: "admins" } };

  it("takes the server's copy of what was sent, and keeps an unsaved edit", () => {
    const current = { ...base, enabled: true, text_model: "glm-4.6" }; // ticked, and a model typed but not saved
    const saved = { ...base, enabled: true };
    const out = mergeSaved(current, base, saved, (k) => k === "enabled");
    expect(out).toEqual({ ...base, enabled: true, text_model: "glm-4.6" });
  });

  it("follows the server for anything not edited here, objects too", () => {
    const saved = { ...base, chapter_tokens: 2, studio: { open_to: "everyone" } }; // changed elsewhere meanwhile
    expect(mergeSaved({ ...base }, base, saved, () => false)).toEqual(saved);
  });

  it("a full save takes every field from the server, as it came back", () => {
    const current = { ...base, text_model: "glm-4.6 " };
    const saved = { ...base, text_model: "glm-4.6" }; // trimmed by the server
    expect(mergeSaved(current, base, saved, () => true)).toEqual(saved);
  });
});
