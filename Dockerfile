# The reservation-expiry worker.
#
# Shared code (entities, database/redis/stripe modules, reservations) comes from
# the `ticketing-service` git submodule; the three worker files at this repo's
# root are overlaid into src/reservation-worker/ before compiling, so their
# relative imports resolve inside the submodule tree.
#
# Requires the submodule to be checked out first (git submodule update --init),
# or a CI checkout with `submodules: recursive`.

FROM node:20-alpine AS build
WORKDIR /app

COPY ticketing-service/package*.json ./
RUN npm ci

COPY ticketing-service/ ./
COPY expiry-worker.service.ts src/reservation-worker/
COPY main.ts src/reservation-worker/
COPY reservation-worker.module.ts src/reservation-worker/

RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY ticketing-service/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# No listener: just the reservation-expiry process.
CMD ["node", "dist/reservation-worker/main"]
