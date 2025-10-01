# root-level Dockerfile that builds the Next.js app inside ./web
FROM node:20-alpine

RUN apk add --no-cache libc6-compat
ENV PRISMA_SKIP_POSTINSTALL=1

WORKDIR /app

# 1) Install deps using cached package files
COPY web/package*.json ./web/
RUN cd web && npm ci

# 2) Copy Prisma schema and generate client
# If your schema is web/prisma (most setups):
COPY web/prisma ./web/prisma
RUN cd web && npx prisma generate

# 3) Copy the rest and build Next
COPY web ./web
WORKDIR /app/web
RUN npm run build

# 4) Runtime
ENV NODE_ENV=production
ENV PORT=3000
CMD sh -c "npx prisma migrate deploy && npm run start"
