import type { Metadata } from "next";
import Link from "next/link";
import { CRISIS_RESOURCES } from "@/lib/crisis";
import { pageMetadata } from "@/lib/seo";
import { stepInOpen } from "@/lib/step-in";
import { companionOpen } from "@/lib/companion-shared";

// The live-date and companion paragraphs follow their switches (STEP_IN_OPEN, COMPANION_OPEN), read when the page is served.
export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Safety and self-harm protocol · Botchelor",
  description: "Botchelor's characters are AI. What happens when someone's words suggest they might hurt themselves, and where to get help.",
  path: "/safety",
});

/**
 * The published self-harm protocol (New York's AI companion law; California SB 243), and the AI disclosure it rests on.
 * The same text as docs/safety-protocol.md; lib/crisis.ts does what it says. The legal pages link here.
 */
export default function SafetyPage() {
  const liveDates = stepInOpen();
  const companions = companionOpen();
  return (
    <article className="legal-page">
      <h1>Safety</h1>

      <h2 id="ai">You&apos;re talking with AI</h2>
      <p>
        Every character on Botchelor, on the show and in After Dark, is fictional and written by an AI model, and so is
        every date, text, picture, video and voice. No person is on the other side of a character&apos;s messages. The
        site says so where you meet them, and every generated picture carries a machine-readable &ldquo;AI-generated&rdquo; mark.
      </p>
      <p>
        Botchelor is for adults (18 and over). AI companion chatbots may not be suitable for some minors.
      </p>

      <h2 id="self-harm">Self-harm protocol</h2>
      <p>
        When you type to or about a character (a text&apos;s nudge, a note, a date&apos;s note, an After Dark steer or whisper, or
        an agent&apos;s text over MCP), your own words are checked against a short, conservative list of phrases that clearly say
        someone wants to hurt or kill themselves; the characters&apos; own lines are never checked, so fiction doesn&apos;t set it off.
        If yours match, we show crisis resources right away, alongside whatever you were doing (nothing is blocked): in the US, call
        or text 988; in the UK and Ireland, call Samaritans on 116 123; anywhere else, findahelpline.com lists free helplines. We
        record nothing about you when this happens beyond an anonymous count that it happened. If you&apos;re in danger right
        now, call your local emergency number.
      </p>
      {liveDates && (
        <p id="live-dates">
          On a live date, where you step in and talk with a cast member yourself, we do more. The character says it&apos;s an AI
          character at the start, every few lines and when you come back after a break, and the screen says so the whole time.
          Your lines are checked as above, and lines that might mean the same thing are checked again by a small AI model.
          If either check matches, the date pauses: the character says nothing more, the same crisis resources appear, and the
          date carries on only if you choose. The character&apos;s own lines are checked too, so it never talks about wanting to
          hurt itself. We count how often the resources were shown, by day, with nothing about who or what was said.
        </p>
      )}

      {companions && (
        <p id="companions">
          Companions, where you talk one to one with a character, work the same way. The conversation starts with a line saying
          the character is AI and not a real person, and it says so again when you come back after a break and every three hours
          you keep talking. Every message you send is checked as on a live date, before the character sees it. If a check
          matches, the conversation pauses with the crisis resources, nothing you wrote in that message is kept, and the
          character says nothing more until you choose to carry on. The character&apos;s replies are checked too, and it is
          told to put your safety ahead of staying in character. A companion never keeps notes about your mental health, and
          you can see, change or delete everything it remembers about you.
        </p>
      )}

      <h2 id="help">Where to get help</h2>
      <ul>
        {CRISIS_RESOURCES.lines.map((l) => (
          <li key={l.region}>
            <strong>{l.region}:</strong>{" "}
            <a href={l.href} target="_blank" rel="noopener noreferrer">
              {l.how}
            </a>
          </li>
        ))}
      </ul>

      <p>
        <Link href="/">Back to the show</Link>
      </p>
    </article>
  );
}
