import Loading from "@/app/Loading";

/** Shown at once while Matches loads (2026-11-04: a tap on Matches, or on one of your characters, seemed to do nothing). */
export default function MatchesLoading() {
  return (
    <article className="matches-page page-loading">
      <h1>Matches</h1>
      <Loading size="lg" label="Loading your matches" status />
    </article>
  );
}
