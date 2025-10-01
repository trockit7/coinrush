// src/lib/db/main.ts

// Load the generated client from prisma/.prisma/client-main
// (3 levels up from src/lib/db/main.ts → ../../../)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require("../../../prisma/.prisma/client-main") as {
  PrismaClient: typeof import("@prisma/client").PrismaClient;
};

// Reuse a single Prisma instance in dev to avoid "too many connections"
const globalForPrisma = globalThis as unknown as {
  prismaMain?: InstanceType<typeof PrismaClient>;
};

export const prismaMain =
  globalForPrisma.prismaMain ?? new PrismaClient();

// ✅ Back-compat alias so imports like `import { mainDb } ...` keep working
export const mainDb = prismaMain;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaMain = prismaMain;
}