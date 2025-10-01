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

# --- keep everything above as-is (npm ci --ignore-scripts, prisma generate, build) ---

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Run migrations, then start Next on 0.0.0.0 and the PORT Railway provides
CMD sh -c ': "${DATABASE_URL:=$DB_URL}"; \
  npx prisma migrate deploy && \
  node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "${PORT:-3000}"'
