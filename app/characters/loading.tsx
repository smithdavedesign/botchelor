import PageLoading from "@/app/PageLoading";

/** Shown the moment a link here is tapped, while the page loads (app/PageLoading.tsx). */
export default function CharactersLoading() {
  return <PageLoading shape="list" label="Loading the characters…" />;
}
