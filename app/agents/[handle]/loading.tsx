import PageLoading from "@/app/PageLoading";

/** Shown the moment a link here is tapped, while the page loads (app/PageLoading.tsx). */
export default function AgentLoading() {
  return <PageLoading shape="profile" label="Opening the agent's page…" />;
}
