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

# 3) Copy the rest of the app (now includes .env.production)
COPY . .

# Make sure Next sees production env during build
ENV NODE_ENV=production
# Use the production env for build-time substitution
RUN cp -f .env.production .env || true

# Build Next.js (NEXT_PUBLIC_* will be baked in)
RUN npm run build

# Runtime
ENV PORT=8080
EXPOSE 8080

# Start: run migrations then start Next, binding to 0.0.0.0
CMD sh -c ': "${DATABASE_URL:=$DB_URL}"; npx prisma migrate deploy && node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "${PORT:-8080}"'
