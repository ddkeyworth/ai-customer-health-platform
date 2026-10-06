import { acceptAgentAction, dismissAgentAction } from "@/lib/agentActionReview";

// Two tiny forms, not a client component - consistent with every other
// write action in this app (Settings' Remove buttons, Segments' delete).
// Shown on every AI-recommendation card; once accepted or dismissed the
// card's own "proposed"-only query drops it, so there's nothing further to
// render here - see src/lib/agentActionReview.ts.
export default function AgentActionReview({ id }: { id: string }) {
  return (
    <div className="flex items-center gap-3 mt-2 pt-2 border-t border-[#378ADD]/10">
      <form action={acceptAgentAction.bind(null, id)}>
        <button type="submit" className="text-xs text-green-700 hover:underline">
          Accept
        </button>
      </form>
      <form action={dismissAgentAction.bind(null, id)}>
        <button type="submit" className="text-xs text-red-700 hover:underline">
          Dismiss
        </button>
      </form>
    </div>
  );
}
