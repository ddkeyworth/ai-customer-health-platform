// One switch separates the two ways this app is used.
//
//  - The owner's hosted site (the default, no setting needed): locked down.
//    It is a demonstration site: nothing a visitor does is saved, so signup is
//    CLOSED. The shared demo cannot spend the owner's AI key or be changed,
//    and uploads have caps.
//  - Someone's own copy, on their own servers with their own keys: set
//    SELF_HOSTED=true and none of that applies. No trial, no demo lock, no
//    hosted-site caps. They do what they like with their own data and costs.
//
// The default is the locked-down mode on purpose: a deployment where the
// setting is missing or mistyped stays safe, and only the exact value "true"
// opens it up.
export function isSelfHosted(): boolean {
  return process.env.SELF_HOSTED === "true";
}

// Who may create a workspace.
//
//   ALLOW_SIGNUP="true"   open: an explicit opt-in (used by tests and local
//                         journeys, or by a copy that really wants open signup)
//   ALLOW_SIGNUP="false"  closed
//   anything else         (unset, or mistyped such as TRUE or yes) falls back to
//                         the default for the kind of deployment:
//       hosted site       closed: no workspaces are ever created on the owner's
//                         servers by default
//       self-hosted copy  open only while there are no users at all, so the
//                         owner can create the first account, and closed after
//                         that so a stranger who finds the address cannot
//                         create workspaces on a private copy
//
// Only the exact values "true" and "false" count, so a typo never opens signup.
export type SignupMode = "open" | "closed" | "first_account_only";

export function signupMode(): SignupMode {
  const setting = process.env.ALLOW_SIGNUP;
  if (setting === "true") return "open";
  if (setting === "false") return "closed";
  return isSelfHosted() ? "first_account_only" : "closed";
}

// userCount is how many user accounts exist now; it only matters for the
// self-hosted default.
export function signupAllowed(userCount: number): boolean {
  const mode = signupMode();
  return mode === "open" || (mode === "first_account_only" && userCount === 0);
}
