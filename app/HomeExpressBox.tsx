"use client";

import { useRef } from "react";
import { EXPRESS_EXAMPLES, EXPRESS_SAY_KEY, EXPRESS_TEXT_MAX, EXPRESS_TEXT_MIN } from "@/lib/express-create";

/**
 * One-sentence create, on the home page (2026-11-15: 12 visitors opened /create and 4 finished; the box was a click
 * away). One field and a button, under the hero's headline, for a visitor with no character. /create opens its own one
 * box with the sentence and drafts at once (app/create/CreateWizard.tsx `startSaid`): the same route, limits, PG checks
 * and events, with `place: "home"`. The sentence crosses in this browser's sessionStorage, so what someone typed is
 * never in an address (the analytics record addresses, never words); before the page's script has loaded it is a plain
 * form to /create?say=…, which the builder takes out of the address at once. Shown only while one-sentence create is on
 * (lib/home-clip.ts homeExpressBoxOn).
 *
 * Under the field, the builder's own three examples (lib/express-create.ts EXPRESS_EXAMPLES; 2026-11-21: 3 of 53
 * strangers on home in two weeks used the box, while /create's box, which has them, is where most drafts start). A tap
 * fills the field and leaves the button to them, so an example is a start, not a send.
 */
export default function HomeExpressBox() {
  const field = useRef<HTMLInputElement>(null);
  return (
    <form
      className="home-express"
      action="/create"
      method="get"
      onSubmit={(e) => {
        const text = String(new FormData(e.currentTarget).get("say") ?? "").trim();
        if (text.length < EXPRESS_TEXT_MIN) return;
        try {
          sessionStorage.setItem(EXPRESS_SAY_KEY, text.slice(0, EXPRESS_TEXT_MAX));
        } catch {
          return; // no storage: the plain form carries it
        }
        e.preventDefault();
        window.location.assign("/create?said=home");
      }}
    >
      <label htmlFor="home-express-text" className="home-express-label">
        Describe someone in a sentence
      </label>
      <div className="home-express-row">
        <input
          ref={field}
          id="home-express-text"
          name="say"
          type="text"
          required
          minLength={EXPRESS_TEXT_MIN}
          maxLength={EXPRESS_TEXT_MAX}
          autoComplete="off"
          enterKeyHint="go"
          placeholder="A lighthouse keeper who repairs old radios"
        />
        <button type="submit" data-track="home-express">
          Meet them
        </button>
      </div>
      <div className="express-examples home-express-examples" role="group" aria-label="Examples that fill the box">
        <span className="muted small">Try</span>
        {EXPRESS_EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            className="look-chip"
            data-track="home-express-example"
            onClick={() => {
              const input = field.current;
              if (!input) return;
              input.value = ex.text;
              input.focus();
              input.setSelectionRange(ex.text.length, ex.text.length);
            }}
          >
            {ex.label}
          </button>
        ))}
      </div>
    </form>
  );
}
