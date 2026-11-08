import { acceptAgentAction, dismissAgentAction, snoozeAgentAction } from "@/lib/agentActionReview";
import { SNOOZE_DAYS } from "@/lib/agentActionStatus";

// Tiny forms, not a client component - consistent with every other write
// action in this app. Shown on every AI-recommendation card; once accepted
// or dismissed the card's own "proposed"-only query drops it, and a snoozed
// one is hidden until its date passes - see src/lib/agentActionStatus.ts.
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
      <span className="text-xs text-zinc-400">Snooze</span>
      {SNOOZE_DAYS.map((days) => (
        <form key={days} action={snoozeAgentAction.bind(null, id, days)}>
          <button type="submit" className="text-xs text-zinc-600 hover:underline">
            {days}d
          </button>
        </form>
      ))}
    </div>
  );
}
