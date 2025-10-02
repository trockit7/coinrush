# web/Dockerfile
FROM node:20-alpine

RUN apk add --no-cache libc6-compat
WORKDIR /app

# 1) Install deps (skip lifecycle scripts so postinstall doesn't run yet)
COPY package*.json ./
RUN npm ci --ignore-scripts

# 2) Copy Prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# --- you already did deps + prisma earlier ---
# Make sure we are in the app root
WORKDIR /app

# Copy the rest of the repo (includes web/.env.production)
COPY . .

# Build the Next app **inside /app/web**
WORKDIR /app/web

# Make sure Next sees production env during build (bakes NEXT_PUBLIC_* into client)
ENV NODE_ENV=production
RUN cp -f .env.production .env || true

# Build Next.js (now it bakes NEXT_PUBLIC_* correctly)
RUN npm run build

# ---- Runtime ----
ENV PORT=8080
EXPOSE 8080

# Stay in /app/web for runtime too
WORKDIR /app/web
CMD sh -c ': "${DATABASE_URL:=$DB_URL}"; npx prisma migrate deploy && node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "${PORT:-8080}"'
