# Aiven Runtime turns every ENV line into an env var and requires unique keys:
# build-time settings are ARGs, runtime settings appear exactly once below.

# --- deps + build ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- runtime ---
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# standalone output does not include public/ (logo)
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
# DB migrations run inside server startup (src/instrumentation.ts): Runtime has no pre-deploy step.
CMD ["node", "server.js"]
