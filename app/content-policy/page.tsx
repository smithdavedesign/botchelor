import type { Metadata } from "next";
import Link from "next/link";
import { REPORT_RESPONSE } from "@/lib/legal-entity";
import { Contact, LAST_UPDATED, OnThisPage, PolicyLinks } from "../legal/sections";

export const metadata: Metadata = {
  title: "Content policy · Botchelor",
  description: "What Botchelor's characters, dates and After Dark scenes may and may not contain, what we check automatically, and how to report.",
};
// Rendered per request, so a CONTACT_EMAIL added after the build shows without a redeploy.
export const dynamic = "force-dynamic";

const HEADINGS = [
  { id: "everywhere", title: "The lines that hold everywhere" },
  { id: "show", title: "The main show" },
  { id: "after-dark", title: "After Dark" },
  { id: "checks", title: "What we check automatically" },
  { id: "refused", title: "What happens to what's refused" },
  { id: "report", title: "Reporting and appeals" },
  { id: "contact", title: "Contact" },
] as const;

/**
 * The content rules in full (the Terms' "Content rules" in short): what card processors and the card networks ask a
 * site to publish (docs/after-dark-legal-review.md "Content lines"), and an honest account of what the code checks
 * (lib/safety.ts, lib/adult/check.ts) and what it leaves to reports and review.
 */
export default function ContentPolicyPage() {
  return (
    <article className="legal-page">
      <h1>Content policy</h1>
      <p className="muted">{LAST_UPDATED}</p>
      <p>
        Everything on Botchelor is fiction made with AI: characters people and agents create, and the dates, texts and
        pictures the show makes for them. This page says what that fiction may and may not contain. It applies to
        everything anyone puts in (character sheets, steers, texts, nudges, scene requests) and to everything the show
        makes from it.
      </p>
      <OnThisPage headings={HEADINGS} />

      <h2 id="everywhere">The lines that hold everywhere</h2>
      <p>On the main show and in After Dark, as fiction or roleplay, in words or in pictures, never:</p>
      <ul>
        <li>
          <strong>Minors, or anything that suggests one.</strong> Every character is 18 or older and reads as an adult: no
          childlike looks or behaviour, no ages under 18 &ldquo;in the past&rdquo;, no school settings, no school uniforms.
        </li>
        <li>
          <strong>Real people.</strong> No celebrities, public figures, or anyone you know, by name, by description or by
          likeness. No deepfakes.
        </li>
        <li>
          <strong>Sex without consent.</strong> No rape, force or coercion, and no one drugged, drunk past saying yes,
          asleep or otherwise unable to agree. Not as fantasy, not as roleplay.
        </li>
        <li>
          <strong>Incest,</strong> by blood or by marriage, including step-family, and family roleplay.
        </li>
        <li>
          <strong>Bestiality,</strong> or sex involving animals.
        </li>
        <li>
          <strong>Sexual violence or gore:</strong> mutilation, serious injury, blood or death in a sexual context.
        </li>
        <li>
          <strong>Teacher and student,</strong> or any school setting, in a romantic or sexual context.
        </li>
        <li>
          <strong>Age-play</strong> of any kind.
        </li>
        <li>
          Hate, harassment or threats against real groups or people, someone&apos;s private information, and anything
          illegal.
        </li>
      </ul>

      <h2 id="show">The main show</h2>
      <p>
        The show is romance and flirting between fictional adults: at most a kiss, nothing sexual, no innuendo in the
        sheets. Dates can be awkward, sad or a disaster; they can&apos;t be explicit.
      </p>

      <h2 id="after-dark">After Dark</h2>
      <p>
        After Dark is a separate, adults-only (18+) paid tier, in private testing and not open yet. It allows explicit
        text, and in some places pictures, video and voiced lines, between consenting fictional adults, always inside the
        lines above. Each owner opts each of their own characters in; nobody can take someone else&apos;s character there.
        It isn&apos;t offered where the law asks for an age check we don&apos;t offer, and it&apos;s text only in the UK
        (see the <Link href="/terms#where">terms</Link>).
      </p>

      <h2 id="checks">What we check automatically</h2>
      <ul>
        <li>
          <strong>Text filters.</strong> Every character sheet and every line a date&apos;s writers produce goes through a
          content filter before it&apos;s saved or shown. On the show it refuses sexual words, innuendo, anything
          suggesting a minor (including an age under 18 in passing) and well-known real people. In After Dark it refuses
          anything suggesting a minor, family and step-family roleplay, incest, teacher and student, school settings,
          age-play, non-consent (force, drugging, someone asleep, or a game of it), bestiality, sexual violence or gore,
          and real people, in a steer, a line, a scenario or a request.
        </li>
        <li>
          <strong>Every After Dark picture and video</strong> is checked by an automated classifier before
          it&apos;s stored or shown: once for any sign of a child, and once more asking whether everyone in it is clearly an
          adult. Anything but a clear yes is discarded. If the check can&apos;t run, nothing is shown until it has passed. A video starts from a
          picture that already passed, and its frames are checked again.
        </li>
        <li>
          The show&apos;s own pictures (places and character looks) are checked the same way before they&apos;re kept, and
          must not be explicit.
        </li>
        <li>
          Nobody can upload pictures or video: everything shown is made by the show, from text that passed the filters.
        </li>
        <li>
          Filters are a first line of defence, not a guarantee: no word filter catches every phrasing. So the lines also
          rest on the model&apos;s own instructions, which repeat them, on your reports, and on our review.
        </li>
      </ul>

      <h2 id="refused">What happens to what&apos;s refused</h2>
      <ul>
        <li>A refused character sheet or steer isn&apos;t saved, and you&apos;re told which part to change.</li>
        <li>A refused line is rewritten or dropped; a refused picture or video is thrown away, never stored.</li>
        <li>
          Breaking these rules on purpose, or trying to get around the filters, can get content removed and an account or
          agent suspended or closed (see the <Link href="/terms#acceptable-use">terms</Link>).
        </li>
      </ul>

      <h2 id="report">Reporting and appeals</h2>
      <p>
        If you see anything that breaks these rules, use the report button on the episode, or the{" "}
        <Link href="/report">report form</Link> for anything else (including an intimate image of you, or content about a
        real person). We aim to answer within {REPORT_RESPONSE.standard}, and within {REPORT_RESPONSE.urgent} for anything
        about a real person, an intimate image or a possible minor. If you think something of yours was removed by mistake,
        or something about you is shown, email us and a person will look at it.
      </p>

      <Contact />
      <PolicyLinks current="/content-policy" />
    </article>
  );
}
