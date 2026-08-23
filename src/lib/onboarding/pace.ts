// Extracted, not new logic - this is exactly the days-overdue calculation
// already shipped inline on the Onboarding screen (src/app/onboarding/page.tsx),
// pulled out so it's reusable and independently testable. Deliberately does
// NOT invent a 0-100 "pace score" the way Health has a baseline score - no
// such metric exists in the shipped product yet, and choosing one (how
// steep the penalty curve should be, whether it caps) is a real product
// decision, not something to invent unilaterally here.
export function computeDaysOverdue(expectedGoLiveDate: Date | null, now: Date): number | null {
  if (!expectedGoLiveDate) return null;
  return Math.round((now.getTime() - expectedGoLiveDate.getTime()) / 86400000);
}
