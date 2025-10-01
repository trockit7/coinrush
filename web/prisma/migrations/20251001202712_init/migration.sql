-- CreateTable
CREATE TABLE "Profile" (
    "address" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatar_url" TEXT,
    "twitter" TEXT,
    "telegram" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "PoolNews" (
    "id" SERIAL NOT NULL,
    "pool" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "PoolNews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "pool_addr" TEXT NOT NULL,
    "token_addr" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "image_url" TEXT,
    "description" TEXT,
    "website" TEXT,
    "telegram" TEXT,
    "twitter" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "price_bnb" DOUBLE PRECISION,
    "pct_change_24h" DOUBLE PRECISION,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("pool_addr")
);

-- CreateIndex
CREATE INDEX "PoolNews_pool_createdAt_idx" ON "PoolNews"("pool", "createdAt");

-- CreateIndex
CREATE INDEX "Token_token_addr_idx" ON "Token"("token_addr");
