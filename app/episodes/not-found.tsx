import Link from "next/link";

/**
 * Unknown episodes, private ones (for everyone but their own people), and ones hidden after reports (for everyone but
 * their creators). One level above the episode, so it's also what an unknown id's 404 shows (app/episodes/[id]/layout.tsx
 * answers that before the page runs).
 */
export default function EpisodeNotFound() {
  return (
    <article>
      <h1>Episode not available</h1>
      <p>This episode doesn&apos;t exist, it&apos;s private, or it was hidden after several viewers reported it.</p>
      <p>
        <Link href="/watch">Back to Watch</Link>
      </p>
    </article>
  );
}
