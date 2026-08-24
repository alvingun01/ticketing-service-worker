FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Shared runtime base: production deps + compiled output. Both final images are
# built from this so they share a layer cache; the only difference is the CMD.
FROM node:20-alpine AS runtime-base
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Worker image: no listener, just the reservation-expiry process.
# Build with:  docker build --target worker -t <repo>:worker .
FROM runtime-base AS worker
CMD ["node", "dist/reservation-worker/main"]

# API image: the HTTP + WebSocket backend. Declared last so a bare
# `docker build` defaults to this target.
# Build with:  docker build --target api -t <repo>:api .
FROM runtime-base AS api
EXPOSE 8000
CMD ["node", "dist/main"]
