/*
  Warnings:

  - You are about to drop the `News` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `created_at` on the `Profile` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `Profile` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `Profile` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "News_pool_created_at_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "News";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "PoolNews" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pool" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Token" (
    "pool_addr" TEXT NOT NULL PRIMARY KEY,
    "token_addr" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "image_url" TEXT,
    "description" TEXT,
    "website" TEXT,
    "telegram" TEXT,
    "twitter" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "price_bnb" REAL,
    "pct_change_24h" REAL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Profile" (
    "address" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "avatar_url" TEXT,
    "twitter" TEXT,
    "telegram" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Profile" ("address", "avatar_url", "telegram", "twitter", "username") SELECT "address", "avatar_url", "telegram", "twitter", "username" FROM "Profile";
DROP TABLE "Profile";
ALTER TABLE "new_Profile" RENAME TO "Profile";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PoolNews_pool_createdAt_idx" ON "PoolNews"("pool", "createdAt");

-- CreateIndex
CREATE INDEX "Token_token_addr_idx" ON "Token"("token_addr");
