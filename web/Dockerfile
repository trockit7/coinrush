# web/Dockerfile
FROM node:20-alpine

RUN apk add --no-cache libc6-compat

WORKDIR /app

# 1) Install deps (skip lifecycle scripts so postinstall doesn't run yet)
COPY package*.json ./
RUN npm ci --ignore-scripts

# 2) Copy Prisma schema and generate client (now schema exists)
COPY prisma ./prisma
RUN npx prisma generate

# 3) Copy the rest and build Next
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000

# Fallback: if DATABASE_URL is unset, use DB_URL (we'll add DB_URL too)
CMD sh -c ': "${DATABASE_URL:=$DB_URL}"; echo ">> DATABASE_URL=${DATABASE_URL}"; npx prisma migrate deploy && npm run start'
