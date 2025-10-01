// web/scripts/test-main.ts
import { prismaMain } from "../src/lib/db/main";

async function run() {
  const row = await prismaMain.poolNews.create({
    data: { pool: "0xabc...", body: "hello from client-main", author: "0xdef..." }
  });
  console.log("Created:", row);

  const latest = await prismaMain.poolNews.findMany({
    take: 1,
    orderBy: { createdAt: "desc" }
  });
  console.log("Latest:", latest);
}

run().finally(() => prismaMain.$disconnect());
