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

# 3) Copy the rest of the repo
COPY . .

# We were in /app earlier; copy the repo already done above.
# Make sure we are inside the web app now:
WORKDIR /app/web

# Ensure prisma directory exists in the image (explicit copy is harmless)
# (If this Dockerfile lives inside /web, this COPY is redundant but safe)
COPY prisma ./prisma

# Make production env available to Next *during build*
ENV NODE_ENV=production
RUN cp -f .env.production .env || true

# Build Next.js (bakes NEXT_PUBLIC_* envs)
RUN npm run build

# ---- Runtime ----
ENV PORT=8080
EXPOSE 8080
WORKDIR /app/web
CMD sh -c ': "${DATABASE_URL:=$DB_URL}"; npx prisma migrate deploy --schema=./prisma/schema.prisma && node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "${PORT:-8080}"'
