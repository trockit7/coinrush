// src/lib/db/news.ts  (NEWS DB)
import { PrismaClient as NewsPrisma } from '@prisma/client';

const globalForNews = globalThis as unknown as { newsPrisma?: NewsPrisma };
export const newsDb =
  globalForNews.newsPrisma ?? (globalForNews.newsPrisma = new NewsPrisma());
