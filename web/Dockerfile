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

# ... keep everything above (npm ci --ignore-scripts, prisma generate, build) ...

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# 1) run migrations
# 2) log the host:port
# 3) start Next via npm script (which includes -H 0.0.0.0)
CMD sh -c ': "${DATABASE_URL:=$DB_URL}"; \
  npx prisma migrate deploy && \
  echo ">>> Starting Next on 0.0.0.0:${PORT:-3000}" && \
  exec npm run start'
