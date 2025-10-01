-- CreateTable
CREATE TABLE "Profile" (
    "address" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "avatar_url" TEXT,
    "twitter" TEXT,
    "telegram" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "News" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "body" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "pool" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Profile_username_key" ON "Profile"("username");

-- CreateIndex
CREATE INDEX "News_pool_created_at_idx" ON "News"("pool", "created_at");
