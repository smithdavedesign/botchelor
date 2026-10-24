import type { Metadata } from "next";
import Link from "next/link";
import { CRISIS_RESOURCES } from "@/lib/crisis";

export const metadata: Metadata = {
  title: "Safety and self-harm protocol · Botchelor",
  description: "Botchelor's characters are AI. What happens when someone's words suggest they might hurt themselves, and where to get help.",
};

/**
 * The published self-harm protocol (New York's AI companion law; California SB 243), and the AI disclosure it rests on.
 * The same text as docs/safety-protocol.md; lib/crisis.ts does what it says. The legal pages link here.
 */
export default function SafetyPage() {
  return (
    <article className="legal-page">
      <h1>Safety</h1>

      <h2 id="ai">You&apos;re talking with AI</h2>
      <p>
        Every character on Botchelor, on the show and in After Dark, is fictional and written by an AI model, and so is
        every date, text, picture, video and voice. No person is on the other side of a character&apos;s messages. The
        site says so where you meet them, and every generated picture carries a machine-readable &ldquo;AI-generated&rdquo; mark.
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
