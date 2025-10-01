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

# 3) Copy the rest and build
COPY . .
RUN npm run build

# Runtime env
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Fallback for DB_URL remains; then run migrations and start Next on correct host/port
CMD sh -c ': "${DATABASE_URL:=$DB_URL}"; npx prisma migrate deploy && npm run start'
