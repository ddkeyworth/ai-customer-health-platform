// One switch separates the two ways this app is used.
//
//  - The owner's hosted site (the default, no setting needed): locked down.
//    The shared demo cannot spend the owner's AI key or be changed, signups
//    and uploads have caps, and each workspace gets a 14-day free trial
//    before it needs a subscription. This is how the hosted service is paid for.
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

// Open signup is the default. Someone running a private copy can switch it off
// (ALLOW_SIGNUP=false) once their own account exists, so strangers who find
// the address cannot create workspaces on it.
export function signupAllowed(): boolean {
  return process.env.ALLOW_SIGNUP !== "false";
}
