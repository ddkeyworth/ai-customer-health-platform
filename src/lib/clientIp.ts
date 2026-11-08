import "server-only";
import { headers } from "next/headers";

// The visitor's address as the hosting platform reports it. Vercel sets
// x-forwarded-for itself, so the first entry is the real client. If it is
// missing (local development) every visitor shares one bucket, which only
// makes the limits stricter, never looser.
export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return (forwarded ? forwarded.split(",")[0].trim() : h.get("x-real-ip")) || "unknown";
}
