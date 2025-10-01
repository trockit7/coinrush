# web/Dockerfile
FROM node:20-alpine

# Prisma/Next need a few basics on alpine
RUN apk add --no-cache libc6-compat

WORKDIR /app

# 1) Install deps first (better cache)
COPY package*.json ./
RUN npm ci

# 2) Prisma client generation needs schema
COPY prisma ./prisma
RUN npx prisma generate

# 3) Copy the rest and build Next
COPY . .
RUN npm run build

# 4) Runtime env
ENV NODE_ENV=production
ENV PORT=3000

# 5) Start: run DB migrations then start Next
CMD sh -c "npx prisma migrate deploy && npm run start"
