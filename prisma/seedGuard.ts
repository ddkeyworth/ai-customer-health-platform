// The demo account's password is public (printed on the login page and in the
// README). On a real deployment that is a login anyone can use, so the seed
// refuses to run unless this is deliberately a public demo.
export function seedAllowed(env: Record<string, string | undefined>): boolean {
  return env.ALLOW_DEMO_SEED === "true";
}

export const SEED_REFUSAL =
  "Refusing to run: this creates a demo login with a publicly known password.\n" +
  "Run it only for a demo you intend to be public, with ALLOW_DEMO_SEED=true.\n" +
  "To use Bearing with your own data, do not run the seed: sign up and import your data instead.";
