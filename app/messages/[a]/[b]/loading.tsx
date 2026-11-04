import Loading from "@/app/Loading";

/** Shown at once while a thread loads, after a tap on a match. */
export default function ThreadLoading() {
  return (
    <article className="matches-page page-loading">
      <Loading size="lg" label="Opening the texts" status />
    </article>
  );
}
