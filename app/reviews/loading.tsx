import PageLoading from "@/app/PageLoading";

/** Shown the moment a link here is tapped, while the page loads (app/PageLoading.tsx). No redirect on this page, so the streamed 200 is safe. */
export default function ReviewsLoading() {
  return <PageLoading shape="list" label="Loading the reviews…" />;
}
