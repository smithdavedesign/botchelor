"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * M10 part 2: while an episode is 'generating', poll its status and refresh the page the moment the
 * background worker finishes. If the episode disappears (404), generation failed terminally — the date
 * was given back — so offer another try. No websockets; a light poll, like the watch room.
 */
export default function GeneratingPoller({ episodeId }: { episodeId: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (failed) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(`/api/episodes/${episodeId}`, { cache: "no-store" });
        if (res.status === 404) {
          if (active) setFailed(true);
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as { status?: string };
          if (data.status && data.status !== "generating") {
            router.refresh();
            return;
          }
        }
      } catch {
        /* a dropped poll is harmless; the next one catches up */
      }
      if (active) timer = setTimeout(tick, 2500);
    };
    timer = setTimeout(tick, 2500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [episodeId, router, failed]);

  if (failed) {
    return (
      <section className="card">
        <h2>That date didn&apos;t work out</h2>
        <p className="muted">
          The filming didn&apos;t come together this time, and your date has been given back. Send them
          out again.
        </p>
        <p>
          <Link href="/">Make another date</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="card watch-preshow" aria-live="polite">
      <h2>🎬 Filming the date…</h2>
      <p className="muted">
        The two characters are on their date right now. This usually takes a few seconds — the page will
        update itself the moment it&apos;s ready.
      </p>
    </section>
  );
}
