# root-level Dockerfile that builds the Next.js app inside ./web
FROM node:20-alpine

RUN apk add --no-cache libc6-compat
ENV PRISMA_SKIP_POSTINSTALL=1

WORKDIR /app

# 1) Install deps (skip lifecycle scripts!)
COPY web/package*.json ./web/
RUN cd web && npm ci --ignore-scripts   # <-- CHANGED

# 2) Copy Prisma schema and generate client
COPY web/prisma ./web/prisma
RUN cd web && npx prisma generate       # <-- generate AFTER schema is present

# 3) Copy the rest and build Next
COPY web ./web
WORKDIR /app/web
RUN npm run build

# 4) Runtime
ENV NODE_ENV=production
ENV PORT=3000

# Print DATABASE_URL at runtime, then migrate + start
CMD sh -c 'echo ">> DATABASE_URL=${DATABASE_URL}" && env | sort | grep -E "DATABASE_URL|RAILWAY" || true && npx prisma migrate deploy && npm run start'
