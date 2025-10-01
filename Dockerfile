# root-level Dockerfile that builds the Next.js app inside ./web
FROM node:20-alpine

RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install deps for web/ using cached package files
COPY web/package*.json ./web/
RUN cd web && npm ci

# Prisma client needs schema at build time
COPY web/prisma ./web/prisma
RUN cd web && npx prisma generate

# Copy the rest of the app and build
COPY web ./web
WORKDIR /app/web
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
# Apply migrations on boot, then start Next
CMD sh -c "npx prisma migrate deploy && npm run start"
