import Link from "next/link";

/** Unknown episodes, and episodes hidden after reports (for everyone except their creators). */
export default function EpisodeNotFound() {
  return (
    <article>
      <h1>Episode not available</h1>
      <p>This episode doesn&apos;t exist, or it was hidden after several viewers reported it.</p>
      <p>
        <Link href="/feed">Back to the feed</Link>
      </p>
    </article>
  );
}
