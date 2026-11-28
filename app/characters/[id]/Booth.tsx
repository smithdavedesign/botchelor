"use client";

import Link from "next/link";
import { useState } from "react";
import { showSetPath } from "@/lib/show-sets";

type Line = { line: string; episode_id: string | null; at: string };

/** "00:14:32:08": a timecode for the frame, steady per line so a re-render doesn't tick it. */
function timecode(seed: string): string {
  const h = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const two = (n: number) => String(n).padStart(2, "0");
  return `00:${two(h % 60)}:${two((h >> 6) % 60)}:${two((h >> 12) % 24)}`;
}

/**
 * The confessional booth on a character's page (2026-11-28, Dave: "the confessional shot framed as a camera, with lines
 * as captions"). Their confessional shot (or the empty confessional set) inside a camera's viewfinder: corner marks, a
 * REC light, a timecode, and what they've said to camera as the caption, one line at a time. The lines come from
 * lib/booth.ts, which only reads ones already public.
 */
export function Booth({ name, shot, lines }: { name: string; shot: string | null; lines: Line[] }) {
  const [i, setI] = useState(0);
  // A shot that won't load leaves the booth's own set showing behind the line, never a black box (2026-11-28 review).
  const [broken, setBroken] = useState(false);
  const at = lines.length ? i % lines.length : 0;
  const now = lines[at];
  return (
    <section className="card booth" aria-labelledby="booth-title">
      <h2 id="booth-title">In the confessional</h2>
      <figure className="booth-frame" style={{ backgroundImage: `url(${showSetPath("confessional")})` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a PG shot or a set file, already small */}
        <img
          className="booth-shot"
          src={shot && !broken ? shot : showSetPath("confessional")}
          alt={shot && !broken ? `${name} in the confessional` : ""}
          loading="lazy"
          onError={() => setBroken(true)}
        />
        <span className="booth-marks" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
        <span className="booth-rec" aria-hidden="true">
          <span className="booth-rec-dot" /> REC
        </span>
        <span className="booth-tc" aria-hidden="true">
          {timecode(now ? now.at : name)}
        </span>
        <figcaption className="booth-caption" aria-live="polite">
          {now ? (
            <span key={at} className="booth-line">
              <span className="booth-speaker">{name}:</span> {now.line}
            </span>
          ) : (
            <span className="booth-line is-quiet">{`${name} hasn't said anything to camera yet.`}</span>
          )}
        </figcaption>
      </figure>
      {lines.length > 0 && (
        <p className="booth-foot muted small">
          {now?.episode_id && (
            <>
              <Link href={`/episodes/${now.episode_id}`}>From this date</Link>
              {" · "}
            </>
          )}
          {lines.length > 1 && (
            <button type="button" className="booth-next" onClick={() => setI((n) => n + 1)}>
              Next line ({at + 1} of {lines.length})
            </button>
          )}
        </p>
      )}
    </section>
  );
}
