# root-level Dockerfile that builds the Next.js app inside ./web
FROM node:20-alpine

# Small runtime deps
RUN apk add --no-cache libc6-compat

# IMPORTANT: prevent prisma from running at npm install time
ENV PRISMA_SKIP_POSTINSTALL=1

WORKDIR /app

# 1) Install deps (cache-friendly)
COPY web/package*.json ./web/
RUN cd web && npm ci

# 2) Copy Prisma schema and generate client
# If your schema is in web/prisma (most likely):
COPY web/prisma ./web/prisma
# (If you also have a generated .prisma folder, this is harmless)
COPY web/.prisma ./web/.prisma 2>/dev/null || true
RUN cd web && npx prisma generate

# 3) Copy the rest and build Next
COPY web ./web
WORKDIR /app/web
RUN npm run build

# 4) Runtime
ENV NODE_ENV=production
ENV PORT=3000
CMD sh -c "npx prisma migrate deploy && npm run start"
