import AgentForm from "./form";

export const dynamic = "force-dynamic";

export default function Home() {
  return <AgentForm existingPal={Boolean(process.env.TAVUS_PAL_ID?.trim())} />;
}
