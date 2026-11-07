import PageLoading from "@/app/PageLoading";

/** Shown the moment a link here is tapped, while the page loads (app/PageLoading.tsx). */
export default function ThreadLoading() {
  return <PageLoading shape="couple" label="Opening the texts…" />;
}
