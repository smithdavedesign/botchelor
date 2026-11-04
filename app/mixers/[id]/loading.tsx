import PageLoading from "@/app/PageLoading";

/** Shown the moment a link here is tapped, while the page loads (app/PageLoading.tsx). */
export default function MixerLoading() {
  return <PageLoading shape="date" label="Opening the mixer…" />;
}
