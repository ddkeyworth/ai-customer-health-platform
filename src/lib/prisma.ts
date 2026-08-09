// Standard Next.js singleton pattern - avoids exhausting connections to
// Neon during dev hot-reload, where every file edit would otherwise spin
// up a fresh PrismaClient.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
